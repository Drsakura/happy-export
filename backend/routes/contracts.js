/**
 * 合同清洗中心：解析规则、AI 兜底解析、批量入库、原件下载。
 * 挂载点：/api/contracts（挂在登录门之后，见 server.js）
 *
 * 与 server.js 里那三个基础接口（上传 / 任务列表 / 单条复核）的分工：
 *   那边只管「把文件变成待复核的行」，这边管「行怎么认出来的、怎么进产品库」。
 *
 * 权限口径：仍然沿用 `cleanup.view` —— 系统里目前没有 `cleanup.edit` 这个点，
 * 复核与入库都属于「合同清洗」这一个能力块。等以后要拆细粒度再补点。
 */

const express = require('express');
const path = require('path');

const db = require('../db/db');
const auth = require('../lib/auth');
const catalog = require('../lib/skuCatalog');
const parser = require('../lib/contractParser');
const files = require('../lib/contractFiles');
const aiProviders = require('../lib/aiProviders');

const router = express.Router();

const nowIso = () => new Date().toISOString();
function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}
function fail(res, error) {
  const message = error?.message || '请求处理失败';
  const status = error?.statusCode || (/不存在|无效|格式|不能为空|请先|没有|已过期/.test(message) ? 400 : 500);
  res.status(status).json({ error: message });
}

const getJob = id => db.prepare('SELECT * FROM contract_import_jobs WHERE id = ?').get(Number(id));

/* ============================== 解析规则 ============================== */

/**
 * 当前生效的规则（内置默认 + 用户覆盖）。
 * 写这个接口是为了让「通用性」可验证：用户能一眼看到系统到底认哪些词，
 * 再照着 JSON 覆盖文件去加自己行业的说法。
 */
router.get('/parse-rules', (req, res) => {
  try {
    const rules = parser.loadRules();
    res.json({
      options: rules.options,
      fields: Object.entries(rules.fields).map(([key, field]) => ({
        key,
        label: field.label,
        type: field.type,
        keys: field.keys,
        exclude: field.exclude,
        regex: field.regex || []
      })),
      override_source: rules.override_source,
      override_file: parser.overrideFile,
      hint: '覆盖文件（可选）：在数据目录放 contract-rules.json，或在设置表 settings["contract.rules"] 写同样的 JSON。'
    });
  } catch (error) { fail(res, error); }
});

/** 保存覆盖（存 settings；文件形式的覆盖优先级更高，见 contractParser.readOverride） */
router.put('/parse-rules', auth.requirePermission('cleanup.view'), (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('规则必须是 JSON 对象');
    const allowed = ['fields', 'options', 'disable'];
    if (!Object.keys(body).some(key => allowed.includes(key))) {
      throw badRequest(`规则里至少要有一项：${allowed.join(' / ')}`);
    }
    if (body.fields && (typeof body.fields !== 'object' || Array.isArray(body.fields))) throw badRequest('fields 必须是对象');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('contract.rules', JSON.stringify(body));
    auth.audit({ username: req.user?.username, action: 'contract_rules_update', detail: '更新合同解析规则覆盖', req });
    res.json({ ok: true, rules: parser.loadRules(), message: '规则已保存，下次解析立即生效' });
  } catch (error) { fail(res, error); }
});

/* ============================== AI 解析 ============================== */

/** 从模型返回里把 JSON 数组抠出来：容忍 ```json 代码块、前后废话 */
function extractJsonArray(text) {
  let body = String(text || '').trim();
  body = body.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const AI_FIELDS = ['sku', 'product_name', 'spec', 'purchase_price', 'currency', 'quantity', 'moq'];

const AI_SYSTEM_PROMPT = [
  '你是外贸采购数据抽取引擎。用户会给你一张供应商合同/报价单里的表格（CSV 文本，可能由 Excel 转出，列的顺序与命名都不固定）。',
  '请把每一行商品抽成 JSON。',
  '',
  '硬性要求：',
  '1) 只输出一个 JSON 数组，不要任何解释、不要 markdown 代码块、不要多余字段。',
  '2) purchase_price 必须是数值（采购价/供货价/出厂价/单价/EXW/FOB 都算）；',
  '   金额合计、总价、小计、税额、运费、建议零售价一律**不要**当采购价。',
  '3) quantity 是数量，moq 是最小起订量，两者不要混。',
  '4) currency 用 ISO 三字码（CNY/USD/EUR…），没有线索就 null。',
  `5) 每个对象只允许这些键：${AI_FIELDS.join(', ')}。`,
  '6) 抽不到的字段填 null，**不要编造**。',
  '7) 忽略小计/合计/备注/页脚/公司抬头这类非商品行。'
].join('\n');

/**
 * 用模型重解析一个任务。
 *
 * 为什么用「原件」而不是「已解析的行」：规则解析失败时（正是需要 AI 的场景），
 * 队列里可能只有一行占位记录，把那些行喂给模型等于让它猜一份残缺的表。
 * 所以优先读 7 天内还留着的原件；原件过期了才退回用队列里的原文。
 */
router.post('/import-jobs/:id/ai-parse', auth.requirePermission('cleanup.view'), async (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) throw badRequest('导入任务不存在');

    const resolved = aiProviders.resolveAssignment('contract_parse');
    if (!resolved) {
      throw badRequest('还没有给「合同智能解析」分配模型：请到 设置 → 智能配置 里，把某个接入分配给这个用途');
    }

    // 拼素材：优先原件，其次队列里的 raw_text
    let sourceText = '';
    let sourceLabel = '';
    let sourceNames = [];
    try { sourceNames = JSON.parse(job.source_files || '[]'); } catch { sourceNames = []; }
    for (const name of sourceNames) {
      const original = files.readOriginal(job.job_no, name);
      if (!original) continue;
      const described = parser.describeForAi(original.buffer, original.name, { maxRows: 120, maxChars: 9000 });
      if (!described.text) continue;
      sourceText += `\n### 文件：${original.name}\n${described.text}\n`;
      sourceLabel = original.name;
      if (sourceText.length > 16000) break;
    }
    if (!sourceText) {
      const rows = db.prepare(
        'SELECT row_no, raw_text FROM contract_import_items WHERE job_id = ? AND raw_text IS NOT NULL ORDER BY row_no LIMIT 120'
      ).all(job.id);
      if (rows.length >= 2) {
        sourceText = rows.map(row => row.raw_text).join('\n');
        sourceLabel = '队列内已解析的原文';
      }
    }
    if (!sourceText.trim()) {
      throw badRequest('拿不到可解析的内容：原件已过保留期（7 天）被清理，请把文件重新上传一次');
    }

    const answer = await aiProviders.chatByPurpose('contract_parse', [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      { role: 'user', content: `请抽取下面表格里的商品行：\n\n${sourceText}` }
    ], { maxTokens: 4000, temperature: 0 });

    if (!answer) throw badRequest('没有可用的模型接入');
    if (!answer.ok) throw Object.assign(new Error(`模型调用失败：${answer.error}`), { statusCode: 502 });

    const list = extractJsonArray(answer.text);
    if (!list || !list.length) throw badRequest('模型没有返回可用的 JSON 数组，建议稍后重试或改用手工补录');

    const items = list.map((row, index) => ({
      sku: row?.sku ? String(row.sku).trim().slice(0, 120) : null,
      product_name: row?.product_name ? String(row.product_name).trim().slice(0, 200) : null,
      spec: row?.spec ? String(row.spec).trim().slice(0, 200) : null,
      purchase_price: parser.toNumber(row?.purchase_price),
      currency: row?.currency ? String(row.currency).trim().toUpperCase().slice(0, 8) : null,
      quantity: parser.toNumber(row?.quantity),
      moq: parser.toNumber(row?.moq),
      row_no: index + 1
    })).filter(row => AI_FIELDS.some(key => row[key] !== null));

    if (!items.length) throw badRequest('模型返回的内容里没有可用的字段，建议改用手工补录');

    const now = nowIso();
    let replaced = 0;
    db.transaction(() => {
      /* 只清掉「上一次机器解析出来的、还没被人处理过」的行。
         已经复核过/已入库的行必须留着 —— 用户可能在 AI 之前已经手工修过几条。 */
      const stale = db.prepare(
        `SELECT COUNT(*) AS count FROM contract_import_items
         WHERE job_id = ? AND status = 'pending_review' AND committed_at IS NULL
           AND COALESCE(parse_source, 'rules') = 'rules'`
      ).get(job.id).count;
      db.prepare(
        `DELETE FROM contract_import_items
         WHERE job_id = ? AND status = 'pending_review' AND committed_at IS NULL
           AND COALESCE(parse_source, 'rules') = 'rules'`
      ).run(job.id);
      replaced = stale;

      const ins = db.prepare(
        `INSERT INTO contract_import_items (job_id, filename, row_no, raw_text, sku, product_name, spec,
                                            purchase_price, currency, quantity, moq, status, review_note,
                                            parse_source, created_at, updated_at)
         VALUES (@job_id, @filename, @row_no, @raw_text, @sku, @product_name, @spec,
                 @purchase_price, @currency, @quantity, @moq, 'pending_review', @review_note,
                 'ai', @now, @now)`
      );
      for (const item of items) {
        ins.run({
          job_id: job.id,
          filename: sourceLabel || (sourceNames[0] || 'AI 解析'),
          row_no: item.row_no,
          raw_text: JSON.stringify(item).slice(0, 500),
          sku: item.sku,
          product_name: item.product_name,
          spec: item.spec,
          purchase_price: item.purchase_price,
          currency: item.currency,
          quantity: item.quantity,
          moq: item.moq,
          review_note: 'AI 解析结果，提交前请复核',
          now
        });
      }

      db.prepare(`UPDATE contract_import_jobs SET status = 'pending_review', parse_source = 'ai',
                  notes = ?, updated_at = ? WHERE id = ?`)
        .run(`AI 解析：${answer.provider} / ${answer.model} · 抽出 ${items.length} 行`, now, job.id);
    })();

    auth.audit({
      username: req.user?.username,
      action: 'contract_ai_parse',
      detail: `任务 ${job.job_no} 用 AI 解析出 ${items.length} 行（替换未复核的规则行 ${replaced} 条）`,
      req
    });

    res.json({
      ok: true,
      job: getJob(job.id),
      extracted: items.length,
      replaced,
      provider: answer.provider,
      model: answer.model,
      message: `AI 解析出 ${items.length} 行，已进入待复核队列`
    });
  } catch (error) { fail(res, error); }
});

/* ============================== 入库（批量） ============================== */

/**
 * 把勾选的明细写进产品库。
 *
 * 口径（Wayne 2026-09-16 定）：
 *   - 已存在的货号 → 更新采购价（并写一条价格历史，来源记合同文件名）
 *   - 库里没有的货号 → 新建（沿用产品库原有的「撞号落 -COPY2」规则）
 *   - 入库即视为复核通过，同时补上 reviewed_by / committed_at —— 这两项以前是空的
 *
 * 逐条一个事务：一次勾几百条时不能让写锁一直握着（同上传那里的取舍）。
 */
router.post('/import-items/commit', auth.requirePermission('cleanup.view'), (req, res) => {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [...new Set(rawIds.map(Number).filter(Number.isInteger))].slice(0, 2000);
    if (!ids.length) throw badRequest('请先勾选要入库的明细');

    const actor = req.user?.username || null;
    const orgId = req.user?.org_id ?? null;
    const now = nowIso();
    const summary = { updated: 0, created: 0, skipped: [], jobs: new Set(), contracts: new Set() };

    for (const id of ids) {
      const item = db.prepare('SELECT * FROM contract_import_items WHERE id = ?').get(id);
      if (!item) { summary.skipped.push({ id, reason: '明细不存在' }); continue; }
      if (item.committed_at) {
        summary.skipped.push({ id, sku: item.product_sku, reason: '之前已经入库过了' });
        continue;
      }
      const skuText = String(item.sku || '').trim();
      if (!skuText) { summary.skipped.push({ id, reason: '没有货号，无法入库' }); continue; }
      const price = parser.toNumber(item.purchase_price);
      const moq = parser.toNumber(item.moq);
      const key = catalog.normalizeSku(skuText);
      const existing = db.prepare('SELECT * FROM products WHERE sku = ?').get(key);

      try {
        let productSku = key;
        if (existing) {
          if (price === null) { summary.skipped.push({ id, sku: existing.display_sku || key, reason: '没有采购价，未更新' }); continue; }
          db.transaction(() => {
            /* 只补空字段，不覆盖已有的人工命名 —— 导入是来「补价」的，不是来改名的 */
            db.prepare(
              `UPDATE products SET
                 price = @price,
                 moq = COALESCE(@moq, moq),
                 name = COALESCE(NULLIF(name, ''), @name),
                 spec = COALESCE(NULLIF(spec, ''), @spec),
                 source_contract = @source_contract,
                 parse_method = @parse_method,
                 confidence = 'high',
                 last_updated = @now, updated_at = @now
               WHERE sku = @sku`
            ).run({
              sku: key,
              price,
              moq,
              name: item.product_name?.trim() || null,
              spec: item.spec?.trim() || null,
              source_contract: item.filename,
              parse_method: item.parse_source === 'ai' ? 'ai' : 'rules',
              now
            });
            db.prepare(
              `INSERT INTO price_history (sku, old_price, new_price, old_moq, new_moq, currency,
                                          supplier_id, source_contract, confidence, changed_at, changed_by)
               VALUES (@sku, @old_price, @price, @old_moq, @moq, @currency, @supplier_id, @source, 'high', @now, @actor)`
            ).run({
              sku: key,
              old_price: existing.price,
              price,
              old_moq: existing.moq,
              moq,
              currency: existing.currency || 'CNY',
              supplier_id: existing.supplier_id ?? null,
              // 价格历史里只记合同文件名（不记路径、不记任务号）
              source: item.filename,
              now,
              actor
            });
          })();
          summary.updated += 1;
        } else {
          const created = catalog.insertItem(
            { sku: skuText, name: item.product_name, spec: item.spec, price, moq },
            null, null, actor, orgId,
            {
              sourceContract: item.filename,
              parseMethod: item.parse_source === 'ai' ? 'ai' : 'rules',
              currency: item.currency || 'CNY'
            }
          );
          if (created?.error) { summary.skipped.push({ id, reason: created.error }); continue; }
          productSku = created.sku;
          summary.created += 1;
        }

        db.prepare(
          `UPDATE contract_import_items
             SET status = 'approved', reviewed_by = ?, reviewed_at = ?,
                 updated_at = ?, committed_at = ?, product_sku = ?
           WHERE id = ?`
        ).run(req.user?.id ?? null, now, now, now, productSku, id);

        summary.jobs.add(item.job_id);
        summary.contracts.add(item.filename);
      } catch (error) {
        summary.skipped.push({ id, reason: error.message });
      }
    }

    // 任务的「待复核」可能清空了，状态跟着走（和单条复核同一套派生规则）
    for (const jobId of summary.jobs) {
      const remaining = db.prepare(
        `SELECT COUNT(*) AS count FROM contract_import_items WHERE job_id = ? AND status = 'pending_review'`
      ).get(jobId).count;
      db.prepare('UPDATE contract_import_jobs SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?')
        .run(remaining ? 'pending_review' : 'reviewed', now, remaining ? null : now, jobId);
    }

    auth.audit({
      username: actor,
      action: 'contract_commit',
      detail: `合同入库：更新 ${summary.updated} 条、新建 ${summary.created} 条、跳过 ${summary.skipped.length} 条`
        + (summary.contracts.size ? `（来源：${[...summary.contracts].join('、')}）` : ''),
      req
    });

    res.json({
      ok: true,
      updated: summary.updated,
      created: summary.created,
      skipped: summary.skipped,
      message: `入库完成：更新 ${summary.updated} 条、新建 ${summary.created} 条`
        + (summary.skipped.length ? `、跳过 ${summary.skipped.length} 条` : '')
    });
  } catch (error) { fail(res, error); }
});

/* ============================== 原件（7 天） ============================== */

router.get('/import-jobs/:id/files', (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) throw badRequest('导入任务不存在');
    const list = files.listOriginals(job.job_no);
    const created = Date.parse(job.created_at);
    const expires = Number.isFinite(created)
      ? new Date(created + files.RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : null;
    res.json({
      files: list,
      retention_days: files.RETENTION_DAYS,
      expires_at: expires,
      expired: list.length === 0 && Number.isFinite(created) && Date.now() > created + files.RETENTION_DAYS * 24 * 60 * 60 * 1000
    });
  } catch (error) { fail(res, error); }
});

/** 下载一份原件。过期清理后返回 410，让界面能说清「原件已清理」而不是报一个坏链接。 */
router.get('/import-jobs/:id/file', (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) throw badRequest('导入任务不存在');
    const name = String(req.query.name || '').trim();
    if (!name) throw badRequest('缺少文件名参数 name');
    const file = files.readOriginal(job.job_no, name);
    if (!file) {
      return res.status(410).json({
        error: `原件已过保留期（${files.RETENTION_DAYS} 天）被自动清理，解析结果不受影响`
      });
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="contract"; filename*=UTF-8''${encodeURIComponent(path.basename(file.name))}`
    );
    res.end(file.buffer);
  } catch (error) { fail(res, error); }
});

module.exports = router;
