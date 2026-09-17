/**
 * 智能配置：多模型接入、连通性测试、模型清单、用途分配。
 * 挂载点：/api/ai
 *
 * 权限：
 *   - 接入配置的读与写都要 `ai.manage`（配置里有 base_url 与密钥打码，属系统管理面）；
 *   - `POST /api/ai/chat` 只要登录 —— 它是给所有用户用的对话能力，不是管理动作。
 *
 * 多模型并行（Wayne 2026-09-15）：
 *   可以同时接多家、每家多个模型，然后按「用途」把不同模型派给不同活 ——
 *   合同解析用长文本强的，图片识别用多模态的，日常对话用便宜的。
 */
const express = require('express');
const auth = require('../lib/auth');
const ai = require('../lib/aiProviders');
const { MODES, PRESETS, PURPOSES, PURPOSE_KEYS } = require('../lib/aiPresets');

const router = express.Router();

function fail(res, error) {
  const message = error?.message || '请求处理失败';
  const status = error?.statusCode
    || (/不能为空|不正确|不存在|无效|格式|只能|超过/.test(message) ? 400 : 500);
  res.status(status).json({ error: message });
}

/** GET /api/ai/config —— 一次拿全：预设、兼容模式、用途、已接入的服务商、用途分配 */
router.get('/config', auth.requirePermission('ai.manage'), (req, res) => {
  try {
    res.json({
      presets: PRESETS,
      modes: MODES,
      purposes: PURPOSES,
      providers: ai.listProviders().map(ai.publicProvider),
      assignments: ai.listAssignments(),
      overview: ai.overview()
    });
  } catch (error) {
    fail(res, error);
  }
});

/** GET /api/ai/status —— 轻量状态：小皮这类普通用户界面用（不含任何配置细节） */
router.get('/status', auth.requireAuth, (req, res) => {
  try {
    const resolved = ai.resolveAssignment('assistant_chat');
    res.json({
      configured: Boolean(resolved),
      assistant: resolved ? { provider: resolved.provider.name, model: resolved.model } : null
    });
  } catch (error) {
    fail(res, error);
  }
});

/** POST /api/ai/providers —— 新增一家模型服务 */
router.post('/providers', auth.requirePermission('ai.manage'), (req, res) => {
  try {
    const provider = ai.upsertProvider(req.body || {});
    auth.audit({
      username: req.user.username,
      action: 'ai_provider_create',
      detail: `接入模型服务「${provider.name}」（${provider.base_url} · ${provider.mode}）`,
      req
    });
    res.status(201).json({ provider: ai.publicProvider(provider) });
  } catch (error) {
    fail(res, error);
  }
});

/** PATCH /api/ai/providers/:id —— 改配置（密钥不回传，省略即保持原值） */
router.patch('/providers/:id', auth.requirePermission('ai.manage'), (req, res) => {
  try {
    const provider = ai.upsertProvider(req.body || {}, req.params.id);
    auth.audit({
      username: req.user.username,
      action: 'ai_provider_update',
      detail: `更新接入「${provider.name}」：${provider.enabled === false ? '停用' : '启用'} · 模型 ${provider.models.length} 个`,
      req
    });
    res.json({ provider: ai.publicProvider(provider) });
  } catch (error) {
    fail(res, error);
  }
});

/** DELETE /api/ai/providers/:id —— 移除接入（顺手清掉指向它的用途分配） */
router.delete('/providers/:id', auth.requirePermission('ai.manage'), (req, res) => {
  try {
    const result = ai.removeProvider(req.params.id);
    auth.audit({
      username: req.user.username,
      action: 'ai_provider_delete',
      detail: `移除接入「${result.removed.name}」${result.cleared_assignments ? `（同时清掉 ${result.cleared_assignments} 处用途分配）` : ''}`,
      req
    });
    res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

/** POST /api/ai/providers/:id/test —— 连通性测试（真发请求） */
router.post('/providers/:id/test', auth.requirePermission('ai.manage'), async (req, res) => {
  try {
    const provider = ai.getProvider(req.params.id);
    if (!provider) throw Object.assign(new Error('该模型接入不存在'), { statusCode: 400 });
    const result = await ai.testProvider(provider);
    ai.rememberTest(provider.id, {
      ok: result.ok,
      at: result.at,
      latency_ms: result.latency_ms,
      detail: result.detail
    });
    auth.audit({
      username: req.user.username,
      action: 'ai_provider_test',
      detail: `连通测试「${provider.name}」：${result.ok ? '通过' : '失败'} · ${result.detail}`,
      req,
      ok: result.ok ? 1 : 0
    });
    res.json({ result, provider: ai.publicProvider(ai.getProvider(provider.id)) });
  } catch (error) {
    fail(res, error);
  }
});

/** POST /api/ai/providers/:id/models —— 拉取可用模型（save=1 时顺便存进该接入） */
router.post('/providers/:id/models', auth.requirePermission('ai.manage'), async (req, res) => {
  try {
    const provider = ai.getProvider(req.params.id);
    if (!provider) throw Object.assign(new Error('该模型接入不存在'), { statusCode: 400 });
    const result = await ai.fetchModels(provider);
    if (!result.ok && !result.models.length) {
      return res.status(400).json({ error: result.error || '未能读取模型清单' });
    }
    let saved = null;
    if (String(req.body?.save || '') === '1' && result.models.length) {
      saved = ai.publicProvider(ai.upsertProvider({ models: result.models }, provider.id));
    }
    res.json({ models: result.models, source: result.source, detail: result.detail, provider: saved });
  } catch (error) {
    fail(res, error);
  }
});

/**
 * PUT /api/ai/assignments —— 保存「用途 → 模型」分配。
 * 传 { assignments: { purpose: { provider_id, model } | null } }，整体替换。
 */
router.put('/assignments', auth.requirePermission('ai.manage'), (req, res) => {
  try {
    const input = req.body?.assignments;
    if (input === undefined || input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw Object.assign(new Error('分配内容格式不正确'), { statusCode: 400 });
    }
    const providers = ai.listProviders();
    const next = {};
    for (const [purpose, value] of Object.entries(input)) {
      if (!PURPOSE_KEYS.includes(purpose)) {
        throw Object.assign(new Error(`未知的用途：${purpose}`), { statusCode: 400 });
      }
      if (value === null || value === undefined || value === '') continue;
      const provider = providers.find(item => item.id === String(value.provider_id));
      if (!provider) throw Object.assign(new Error(`用途「${purpose}」指向的模型接入不存在`), { statusCode: 400 });
      const model = String(value.model || '').trim();
      if (!model) continue;
      next[purpose] = { provider_id: provider.id, model };
    }
    ai.saveAssignments(next);
    auth.audit({
      username: req.user.username,
      action: 'ai_assignment_update',
      detail: `用途分配：${Object.entries(next).map(([k, v]) => `${k}→${v.model}`).join('，') || '（全部清空）'}`,
      req
    });
    res.json({ assignments: next, overview: ai.overview() });
  } catch (error) {
    fail(res, error);
  }
});

/**
 * POST /api/ai/chat —— 按用途发起一次真实对话（试跑 / 小皮内部使用）。
 * body: { prompt | messages, purpose, temperature }
 */
router.post('/chat', auth.requireAuth, async (req, res) => {
  try {
    const purpose = String(req.body?.purpose || 'assistant_chat');
    if (!PURPOSE_KEYS.includes(purpose)) {
      throw Object.assign(new Error(`未知的用途：${purpose}`), { statusCode: 400 });
    }
    const messages = Array.isArray(req.body?.messages) && req.body.messages.length
      ? req.body.messages.map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content || '') }))
      : [{ role: 'user', content: String(req.body?.prompt || '').trim() }];
    if (!messages[0].content) throw Object.assign(new Error('请输入内容'), { statusCode: 400 });

    const result = await ai.chatByPurpose(purpose, messages, {
      temperature: req.body?.temperature
    });
    if (!result) {
      return res.status(409).json({ error: '还没有为这个用途分配模型，请先在「设置 → 智能配置」里接入并分配' });
    }
    if (!result.ok) return res.status(502).json({ error: `${result.provider} 调用失败：${result.error}`, ...result });
    res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
