/**
 * 系统信息与版本更新检查。
 * 挂载点：/api/system
 */
const express = require('express');
const updater = require('../lib/updater');

const router = express.Router();

// 简易缓存：GitHub 未认证请求每小时只有 60 次配额，连续点「检查更新」不该把额度刷完。
const CACHE_TTL_MS = 30 * 1000;
let cache = { key: '', at: 0, payload: null };

/**
 * GET /api/system/info
 * 当前版本与运行环境。轻量、不发外部请求，设置页打开时就能调。
 */
router.get('/info', (req, res) => {
  try {
    res.json(updater.systemInfo());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/system/check-update?repo=owner/repo&force=1
 * 对比远端仓库版本与本机版本。repo 省略时用默认仓库（Drsakura/happy-export）。
 */
router.get('/check-update', async (req, res) => {
  try {
    const repo = updater.normalizeRepo(req.query.repo) || updater.DEFAULT_REPO;
    const force = String(req.query.force || '') === '1';

    if (!force && cache.payload && cache.key === repo && Date.now() - cache.at < CACHE_TTL_MS) {
      return res.json({ ...cache.payload, cached: true });
    }

    const result = await updater.checkUpdate(repo);
    cache = { key: repo, at: Date.now(), payload: result };
    res.json({ ...result, cached: false });
  } catch (error) {
    // checkUpdate 内部已兜底，走到这里说明是意料之外的问题
    res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;
