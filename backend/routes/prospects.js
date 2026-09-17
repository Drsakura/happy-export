/**
 * 新客开发的「开发结果管理」。
 * 挂载点：/api/prospects
 *
 * 口径：新客开发页只做两件事 —— ① 用线索池找到新客户；② 管理开发结果。
 * 开发结果就落在 customers.deal_status 上：pending 未成交 / won 已成交 / lost 已流失。
 * 这样「我的客户」和「新客开发」看到的是同一批客户，不会出现两套数据打架。
 *
 * 归属口径（Wayne 2026-09-14）：客户「谁建的谁看得见」，所以本页也按归属过滤，
 * 否则业务员在「新客开发」里能直接看到并标记同事的客户。
 */
const express = require('express');
const db = require('../db/db');
const auth = require('../lib/auth');
const access = require('../lib/customerAccess');

const router = express.Router();
const DEAL_STATUSES = ['pending', 'won', 'lost'];

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
function fail(res, error) {
  const message = error?.message || '请求处理失败';
  const status = error?.statusCode || (/不存在|无效|格式|不能为空/.test(message) ? 400 : 500);
  res.status(status).json({ error: message });
}

function countBy(status, user) {
  const { conditions, params } = access.scopeFilter(user, 'all');
  const where = ["COALESCE(c.deal_status, 'pending') = ?", ...conditions];
  return db.prepare(`SELECT COUNT(*) AS c FROM customers c WHERE ${where.join(' AND ')}`)
    .get(status, ...params).c;
}

/** GET /api/prospects?deal_status=won|lost|pending&q= */
router.get('/', auth.requirePermission('prospect.view'), (req, res) => {
  try {
    const status = String(req.query.deal_status || '').trim();
    const keyword = String(req.query.q || '').trim();
    /* 归属过滤与本页自己的筛选条件合并 —— 归属条件务必放进来，它是硬边界 */
    const scope = access.scopeFilter(req.user, 'all');
    const conditions = [...scope.conditions];
    const params = [...scope.params];

    if (DEAL_STATUSES.includes(status)) {
      conditions.push("COALESCE(c.deal_status, 'pending') = ?");
      params.push(status);
    }
    if (keyword) {
      conditions.push('(c.company LIKE ? OR c.company_en LIKE ? OR c.country LIKE ? OR c.email LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const items = db.prepare(`
      SELECT c.*,
        u.display_name AS owner_name,
        (SELECT COUNT(*) FROM contacts ct WHERE ct.customer_id = c.id) AS contact_count,
        (SELECT COUNT(*) FROM customer_quotations q WHERE q.customer_id = c.id) AS quote_count,
        (SELECT MAX(f.created_at) FROM follow_up_records f WHERE f.customer_id = c.id) AS last_follow_at
      FROM customers c
      LEFT JOIN users u ON c.owner_id = u.id
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY COALESCE(c.updated_at, c.created_at) DESC
      LIMIT 300
    `).all(...params);

    res.json({
      items,
      stats: {
        pending: countBy('pending', req.user),
        won: countBy('won', req.user),
        lost: countBy('lost', req.user)
      }
    });
  } catch (error) {
    fail(res, error);
  }
});

/** PATCH /api/prospects/:id —— 标记成交状态 */
router.patch('/:id', auth.requirePermission('prospect.view'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!customer) throw badRequest('客户不存在');
    /* 标记成交 = 改客户数据，别人的客户不能改 */
    if (!access.canEdit(req.user, customer)) {
      const error = new Error('这条客户不在你名下，请先到客户公海领取');
      error.statusCode = 403;
      throw error;
    }

    const status = String(req.body?.deal_status || '').trim();
    if (!DEAL_STATUSES.includes(status)) throw badRequest('成交状态取值无效');

    db.prepare('UPDATE customers SET deal_status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
    auth.audit({
      username: req.user.username,
      action: 'prospect_deal_status',
      detail: `客户「${customer.company}」标记为 ${status}`,
      req
    });
    res.json({ ok: true, item: db.prepare('SELECT * FROM customers WHERE id = ?').get(id) });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
