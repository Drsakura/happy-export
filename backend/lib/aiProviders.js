/**
 * 多模型接入：模型服务商的存取、连通性测试、模型清单拉取与按用途调用。
 *
 * 存储（settings 键值表，跟权限点台账同一张表）：
 *   ai.providers     JSON 数组，一家服务商一条
 *   ai.assignments   JSON 对象，用途 → { provider_id, model }
 *
 * 安全口径：
 *   - api_key 明文存在本机 SQLite 里，**永远不出现在任何 HTTP 响应中**（一律打码）；
 *   - 上游返回的错误文本会先过一遍脱敏，避免把 key 回显给浏览器。
 *
 * 这里只依赖 Node 内置 fetch（Node 18+），不引第三方 SDK —— 各家协议就两种，
 * 引 SDK 反而会让「换个私有网关」变得麻烦。
 */

const db = require('../db/db');
const { PRESET_MAP, PURPOSE_KEYS } = require('./aiPresets');

const KEY_PROVIDERS = 'ai.providers';
const KEY_ASSIGNMENTS = 'ai.assignments';

const TEST_TIMEOUT_MS = 12000;
const CHAT_TIMEOUT_MS = 90000;

/* ------------------------------------------------------------------ 存取 */

function readJson(key, fallback) {
  try {
    const raw = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

function listProviders() {
  const list = readJson(KEY_PROVIDERS, []);
  return Array.isArray(list) ? list : [];
}

function saveProviders(list) {
  writeJson(KEY_PROVIDERS, list);
}

function getProvider(id) {
  return listProviders().find(item => item.id === String(id)) || null;
}

function listAssignments() {
  const map = readJson(KEY_ASSIGNMENTS, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

function saveAssignments(map) {
  writeJson(KEY_ASSIGNMENTS, map);
}

/* ------------------------------------------------------------------ 打码 */

function maskKey(key) {
  const value = String(key || '');
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

/** 把上游报错里的密钥抹掉再往外抛 —— 有些网关会把请求头原样回显 */
function sanitize(text, key) {
  let out = String(text || '');
  if (key) out = out.split(String(key)).join('••••');
  return out.slice(0, 600);
}

/** 对外输出：密钥只给「有没有」和「长什么样」，绝不给原值 */
function publicProvider(provider) {
  const preset = PRESET_MAP.get(provider.preset) || null;
  return {
    id: provider.id,
    name: provider.name,
    preset: provider.preset,
    preset_label: preset?.label || '自定义',
    base_url: provider.base_url,
    mode: provider.mode,
    models: Array.isArray(provider.models) ? provider.models : [],
    enabled: provider.enabled !== false,
    note: provider.note || '',
    has_key: Boolean(provider.api_key),
    key_masked: maskKey(provider.api_key),
    last_test: provider.last_test || null,
    created_at: provider.created_at || null,
    updated_at: provider.updated_at || null
  };
}

/* ------------------------------------------------------------------ 写入 */

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function normalizeBaseUrl(input) {
  const value = String(input || '').trim().replace(/\/+$/, '');
  if (!value) throw badRequest('接口地址不能为空');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('接口地址格式不正确，需要以 http:// 或 https:// 开头');
  }
  if (!/^https?:$/.test(url.protocol)) throw badRequest('接口地址只支持 http 与 https');
  return value;
}

function normalizeMode(input) {
  const value = String(input || 'openai').trim();
  if (!['openai', 'anthropic'].includes(value)) throw badRequest('接口兼容模式只能是 openai 或 anthropic');
  return value;
}

function normalizeModels(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw badRequest('模型清单格式不正确');
  return [...new Set(input.map(item => String(item).trim()).filter(Boolean))].slice(0, 200);
}

/**
 * 新建 / 更新一家服务商。
 * api_key 的三种输入：
 *   省略或传 undefined  → 保持原值（编辑时前端不回传明文）
 *   传空串              → 清空密钥（本地 Ollama 这类不需要密钥）
 *   传新值              → 覆盖
 */
function upsertProvider(input, id) {
  const list = listProviders();
  const now = new Date().toISOString();
  const existing = id ? list.find(item => item.id === String(id)) : null;
  if (id && !existing) throw badRequest('该模型接入不存在');

  const presetKey = String(input.preset || existing?.preset || 'custom').trim();
  const preset = PRESET_MAP.get(presetKey) || null;
  const mode = normalizeMode(input.mode || existing?.mode || preset?.mode || 'openai');
  const baseUrl = input.base_url === undefined && !existing
    ? normalizeBaseUrl(preset?.base_url)
    : normalizeBaseUrl(input.base_url === undefined ? existing.base_url : input.base_url);

  const name = String(input.name ?? existing?.name ?? preset?.label ?? '未命名接入').trim();
  if (!name) throw badRequest('接入名称不能为空');
  if (name.length > 40) throw badRequest('接入名称不能超过 40 个字');

  let apiKey = existing?.api_key || '';
  if (input.api_key !== undefined) {
    const value = String(input.api_key ?? '').trim();
    /* 前端拿到的是打码值，万一被原样回传就当没改 */
    apiKey = value.includes('••••') ? apiKey : value;
  }

  const models = normalizeModels(input.models);

  const next = {
    id: existing?.id || `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    preset: preset?.key || 'custom',
    base_url: baseUrl,
    mode,
    api_key: apiKey,
    models: models === undefined ? (existing?.models || preset?.models || []) : models,
    enabled: input.enabled === undefined ? (existing?.enabled !== false) : Boolean(input.enabled),
    note: String(input.note ?? existing?.note ?? '').trim().slice(0, 200),
    last_test: existing?.last_test || null,
    created_at: existing?.created_at || now,
    updated_at: now
  };

  const nextList = existing
    ? list.map(item => (item.id === existing.id ? next : item))
    : [...list, next];
  saveProviders(nextList);
  return next;
}

function removeProvider(id) {
  const list = listProviders();
  const hit = list.find(item => item.id === String(id));
  if (!hit) throw badRequest('该模型接入不存在');
  saveProviders(list.filter(item => item.id !== hit.id));
  /* 引用它的用途分配一并清掉，避免留下指向空气的配置 */
  const assignments = listAssignments();
  let touched = 0;
  for (const purpose of Object.keys(assignments)) {
    if (assignments[purpose]?.provider_id === hit.id) {
      delete assignments[purpose];
      touched += 1;
    }
  }
  if (touched) saveAssignments(assignments);
  return { removed: publicProvider(hit), cleared_assignments: touched };
}

function rememberTest(id, result) {
  const list = listProviders();
  const next = list.map(item => (item.id === String(id)
    ? { ...item, last_test: result, updated_at: new Date().toISOString() }
    : item));
  saveProviders(next);
}

/* ------------------------------------------------------------------ 调用 */

/** 统一的 HTTP 出口：超时、错误文本脱敏、JSON 解析兜底都在这里 */
async function requestJson(url, { method = 'POST', headers = {}, body, timeoutMs = TEST_TIMEOUT_MS, apiKey = '' } = {}) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError'
      ? `请求超时（${Math.round(timeoutMs / 1000)} 秒）`
      : `无法连接：${sanitize(error?.cause?.code || error?.message || '网络错误', apiKey)}`;
    return { ok: false, status: 0, latencyMs: Date.now() - started, error: reason };
  }

  const latencyMs = Date.now() - started;
  const text = await response.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const upstream = data?.error?.message || data?.message || data?.error || text || `HTTP ${response.status}`;
    return {
      ok: false,
      status: response.status,
      latencyMs,
      error: sanitize(typeof upstream === 'string' ? upstream : JSON.stringify(upstream), apiKey),
      data
    };
  }
  return { ok: true, status: response.status, latencyMs, data, text };
}

function buildHeaders(provider, extra = {}) {
  const headers = { 'content-type': 'application/json', ...extra };
  const key = provider.api_key;
  if (provider.mode === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (key) headers['x-api-key'] = key;
  } else if (key) {
    headers.authorization = `Bearer ${key}`;
  }
  return headers;
}

/** 探测用的最小对话请求：一条 user 消息、只要 1 个 token */
function probeBody(provider, model) {
  if (provider.mode === 'anthropic') {
    return { model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] };
  }
  return { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 16, temperature: 0, stream: false };
}

function chatPath(provider) {
  return provider.mode === 'anthropic'
    ? `${provider.base_url}/messages`
    : `${provider.base_url}/chat/completions`;
}

/** 从各家返回体里把正文抠出来 */
function extractChatText(provider, data) {
  if (!data) return '';
  if (provider.mode === 'anthropic') {
    const blocks = Array.isArray(data.content) ? data.content : [];
    return blocks.filter(block => block?.type === 'text').map(block => block.text).join('').trim();
  }
  const message = data.choices?.[0]?.message;
  if (!message) return '';
  if (typeof message.content === 'string') return message.content.trim();
  /* 有些网关把 content 拆成数组（含 reasoning 之类），这里只取文本段 */
  if (Array.isArray(message.content)) {
    return message.content.filter(part => part?.type === 'text' || typeof part === 'string')
      .map(part => (typeof part === 'string' ? part : part.text)).join('').trim();
  }
  return '';
}

/**
 * 连通性测试。
 * 策略：优先发一条最小对话（最能说明「这个 key 能不能真的用」）；
 * 若该模型不可用再退一步只拉模型清单。
 */
async function testProvider(provider) {
  const model = (provider.models || [])[0];
  if (!model) {
    const models = await fetchModels(provider);
    if (!models.ok) return { ok: false, at: new Date().toISOString(), latency_ms: models.latencyMs, detail: models.error, mode: provider.mode };
    return {
      ok: true,
      at: new Date().toISOString(),
      latency_ms: models.latencyMs,
      detail: `接口可访问，读到 ${models.models.length} 个模型（未配置模型名，跳过对话测试）`,
      mode: provider.mode
    };
  }

  const result = await requestJson(chatPath(provider), {
    method: 'POST',
    headers: buildHeaders(provider),
    body: probeBody(provider, model),
    timeoutMs: TEST_TIMEOUT_MS,
    apiKey: provider.api_key
  });

  if (!result.ok) {
    return {
      ok: false,
      at: new Date().toISOString(),
      latency_ms: result.latencyMs,
      detail: `模型 ${model} 调用失败：${result.error}`,
      mode: provider.mode,
      status: result.status
    };
  }
  const text = extractChatText(provider, result.data);
  return {
    ok: true,
    at: new Date().toISOString(),
    latency_ms: result.latencyMs,
    detail: `模型 ${model} 响应正常${text ? `（返回 ${text.slice(0, 20)}）` : ''}`,
    mode: provider.mode,
    model
  };
}

/** 拉模型清单；协议不支持或没权限时回退到预设里的推荐清单 */
async function fetchModels(provider) {
  const result = await requestJson(`${provider.base_url}/models`, {
    method: 'GET',
    headers: buildHeaders(provider),
    timeoutMs: TEST_TIMEOUT_MS,
    apiKey: provider.api_key
  });

  const preset = PRESET_MAP.get(provider.preset);
  if (!result.ok) {
    const fallback = preset?.models || [];
    if (fallback.length) {
      return {
        ok: true,
        source: 'preset',
        latencyMs: result.latencyMs,
        models: fallback,
        detail: `该服务未开放模型列表接口（${result.error}），已回退到预设推荐清单`
      };
    }
    return { ok: false, source: 'none', latencyMs: result.latencyMs, models: [], error: result.error };
  }

  const rows = Array.isArray(result.data?.data) ? result.data.data
    : Array.isArray(result.data?.models) ? result.data.models
    : Array.isArray(result.data) ? result.data : [];
  const models = [...new Set(rows.map(row => String(row?.id || row?.name || row || '').trim()).filter(Boolean))];
  if (models.length) return { ok: true, source: 'api', latencyMs: result.latencyMs, models, detail: `读取到 ${models.length} 个模型` };

  const fallback = preset?.models || [];
  return {
    ok: fallback.length > 0,
    source: fallback.length ? 'preset' : 'none',
    latencyMs: result.latencyMs,
    models: fallback,
    detail: fallback.length ? '接口未返回模型清单，已回退到预设推荐' : '接口未返回任何模型',
    error: fallback.length ? undefined : '接口未返回任何模型'
  };
}

/** 按用途找「用哪家、哪个模型」 */
function resolveAssignment(purpose) {
  const assignment = listAssignments()[purpose];
  if (!assignment?.provider_id || !assignment?.model) return null;
  const provider = getProvider(assignment.provider_id);
  if (!provider || provider.enabled === false) return null;
  return { provider, model: assignment.model };
}

/**
 * 真正的对话调用（按用途自动选模型）。
 * 未配置时返回 null，调用方据此回退到本地规则逻辑。
 */
async function chatByPurpose(purpose, messages, options = {}) {
  const resolved = resolveAssignment(purpose);
  if (!resolved) return null;
  const { provider, model } = resolved;

  const result = await requestJson(chatPath(provider), {
    method: 'POST',
    headers: buildHeaders(provider),
    body: {
      model,
      messages: provider.mode === 'anthropic'
        ? messages.filter(message => message.role !== 'system')
        : messages,
      ...(provider.mode === 'anthropic'
        ? {
            max_tokens: options.maxTokens || 1024,
            ...(messages.find(message => message.role === 'system')
              ? { system: messages.find(message => message.role === 'system').content }
              : {})
          }
        : {
            max_tokens: options.maxTokens || 1024,
            temperature: options.temperature === undefined ? 0.3 : options.temperature,
            stream: false
          })
    },
    timeoutMs: options.timeoutMs || CHAT_TIMEOUT_MS,
    apiKey: provider.api_key
  });

  if (!result.ok) {
    return {
      ok: false,
      provider: provider.name,
      provider_id: provider.id,
      model,
      error: result.error,
      status: result.status
    };
  }
  return {
    ok: true,
    provider: provider.name,
    provider_id: provider.id,
    model,
    text: extractChatText(provider, result.data),
    latency_ms: result.latencyMs,
    usage: result.data?.usage || null
  };
}

/** 概览：给界面显示「接了几家、分配了几个用途」 */
function overview() {
  const providers = listProviders();
  const assignments = listAssignments();
  const assigned = PURPOSE_KEYS.filter(key => {
    const item = assignments[key];
    return item?.provider_id && item?.model && providers.some(p => p.id === item.provider_id && p.enabled !== false);
  });
  const healthy = providers.filter(p => p.last_test?.ok);
  return {
    provider_count: providers.length,
    enabled_count: providers.filter(p => p.enabled !== false).length,
    healthy_count: healthy.length,
    assigned_purposes: assigned,
    last_test_at: healthy.map(p => p.last_test?.at).sort().pop() || null
  };
}

module.exports = {
  MASK_PLACEHOLDER: '••••',
  listProviders,
  getProvider,
  publicProvider,
  upsertProvider,
  removeProvider,
  listAssignments,
  saveAssignments,
  resolveAssignment,
  testProvider,
  fetchModels,
  chatByPurpose,
  rememberTest,
  maskKey,
  overview,
  PURPOSE_KEYS
};
