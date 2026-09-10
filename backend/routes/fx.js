/**
 * 汇率接口。
 * 挂载点：/api/fx
 */
const express = require('express');
const fx = require('../lib/fx');

const router = express.Router();

/**
 * GET /api/fx/rates?force=1
 *
 * 返回以 USD 为基准的完整汇率表：
 *   { ok, base: 'USD', rates: { USD:1, CNY:7.1, ... }, updatedAt, source, sourceLabel,
 *     stale, cached, warning? }
 *
 * 前端拿到后自行做交叉汇率：amount * rates[to] / rates[from]。
 * 一次请求覆盖所有币种，切货币不再发请求。
 */
router.get('/rates', async (req, res) => {
  try {
    const force = String(req.query.force || '') === '1';
    const data = await fx.getRates(force);
    res.json({ ok: true, base: 'USD', count: Object.keys(data.rates).length, ...data });
  } catch (error) {
    // getRates 内部已兜底，走到这里属于意料之外
    res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;
