/**
 * happy 出口通 —— 系统版本检查
 *
 * 与 sku-manager 的 updater 不同，这里**只做检查，不做自动替换**：
 * happy 是整体应用（前端 dist + 后端服务 + 数据库），更新应当走
 * `git pull` + 重新构建 + 重启服务，而不是像 sku-manager 那样下载 zip
 * 换版本目录。所以本模块只负责回答一个问题：
 *   远端仓库的版本号 vs 本机版本号，谁新？
 *
 * 版本来源，按优先级：
 *   1. GitHub Releases 的 latest.tag_name —— 推荐用法（打 tag 并发 Release）
 *   2. 回退到 Tags 列表里最大的版本号 —— 只打了 tag 没发 Release 也能识别
 *
 * 默认仓库 Drsakura/happy-export，可用 HAPPY_UPDATE_REPO 覆盖（接私有仓库需另配 token）。
 */
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_REPO = 'Drsakura/happy-export';
const API_BASE = 'https://api.github.com';
const TIMEOUT_MS = 8000;
const USER_AGENT = 'happy-export-updater';

/* ---------------------------- 版本号处理 ---------------------------- */

/**
 * 把 "v1.2.3" / "1.2.3" / "1.2.3-beta.1" 解析成可比较的结构。
 * 不是合法 semver 就返回 null（宁可不报更新，也不误报）。
 */
function parseVersion(input) {
  const m = String(input == null ? '' : input)
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' };
}

/** 清洗 tag：去掉 v 前缀与空白，返回标准化版本字符串或 null。 */
function normalizeTag(tag) {
  const p = parseVersion(tag);
  return p ? p.nums.join('.') + (p.pre ? '-' + p.pre : '') : null;
}

/**
 * a > b → 1；a < b → -1；相等或无法解析 → 0。
 * 无法解析时返回 0 是刻意的：宁可说「已是最新」，也不要因为格式怪就误报更新。
 */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return 0;

  for (let i = 0; i < 3; i += 1) {
    if (va.nums[i] !== vb.nums[i]) return va.nums[i] > vb.nums[i] ? 1 : -1;
  }
  if (va.pre === vb.pre) return 0;
  // 预发布版低于同号正式版：1.0.0-beta < 1.0.0
  if (!va.pre) return 1;
  if (!vb.pre) return -1;
  return va.pre > vb.pre ? 1 : -1;
}

/** 当前应用版本。取自顶层 package.json —— 与应用清单同一个来源，避免两处版本号打架。 */
function currentVersion() {
  const candidates = [
    path.join(APP_ROOT, 'package.json'),
    path.join(__dirname, '..', 'package.json')
  ];
  for (const file of candidates) {
    try {
      const version = JSON.parse(fs.readFileSync(file, 'utf8')).version;
      if (version) return version;
    } catch {
      /* 读不到就试下一个候选 */
    }
  }
  return '0.0.0';
}

/** 允许用户填 "owner/repo"、完整 URL、或带 .git 的地址；非法则返回 null。 */
function normalizeRepo(repo) {
  const slug = String(repo == null ? '' : repo)
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return /^[^/\s]+\/[^/\s]+$/.test(slug) ? slug : null;
}

/* ---------------------------- 网络请求 ---------------------------- */

function githubError(status) {
  if (status === 404) return '找不到仓库或版本，请检查更新地址是否正确（私有仓库需要额外配置访问令牌）';
  if (status === 401) return '访问令牌无效或已过期';
  if (status === 403) return 'GitHub 接口被限流（403），稍后再试';
  if (status >= 500) return `GitHub 服务异常（${status}），稍后再试`;
  return `GitHub 返回 ${status}`;
}

/** 带超时的 GET。返回 { data } | { missing:true }（404）| { error }。 */
async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: controller.signal
    });
    if (resp.ok) return { data: await resp.json() };
    if (resp.status === 404) return { missing: true };
    return { error: githubError(resp.status) };
  } catch (e) {
    const why = e.name === 'AbortError' ? '请求超时' : e.message;
    return { error: `连不上 GitHub（${why}），请检查网络后重试` };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------- 主流程 ---------------------------- */

/**
 * 检查是否有新版本。
 * 从不抛异常 —— 所有失败都以 { ok:false, error } 形式返回，方便前端直接展示。
 */
async function checkUpdate(repoInput) {
  const repo = normalizeRepo(repoInput) || DEFAULT_REPO;
  const current = currentVersion();
  const base = { repo, current, checkedAt: new Date().toISOString() };

  // 1) 优先看 Releases
  const release = await getJson(`${API_BASE}/repos/${repo}/releases/latest`);
  if (release.error) return { ...base, ok: false, error: release.error };

  if (release.data) {
    const tag = String(release.data.tag_name || '');
    const latest = normalizeTag(tag);
    if (!latest) {
      return { ...base, ok: false, error: `最新 Release 的标签不是版本号：${tag || '(空)'}` };
    }
    return {
      ...base,
      ok: true,
      source: 'release',
      latest,
      tag,
      hasUpdate: compareVersions(latest, current) > 0,
      title: String(release.data.name || '').trim(),
      notes: String(release.data.body || '').slice(0, 2000),
      publishedAt: release.data.published_at || null,
      url: release.data.html_url || null
    };
  }

  // 2) 没有 Release，回退看 Tags（只打 tag 也能识别更新）
  const tags = await getJson(`${API_BASE}/repos/${repo}/tags?per_page=100`);
  if (tags.error) return { ...base, ok: false, error: tags.error };
  if (tags.missing) return { ...base, ok: false, error: githubError(404) };

  const list = Array.isArray(tags.data) ? tags.data : [];
  const versions = list
    .map((t) => normalizeTag(t && t.name))
    .filter(Boolean)
    .sort(compareVersions)
    .reverse();

  if (!versions.length) {
    return {
      ...base,
      ok: true,
      source: 'none',
      latest: current,
      hasUpdate: false,
      note: '远端仓库还没有版本标签（tag）。在 GitHub 上发布 v1.0.1 这类 Release 或 tag 后，这里就能检查到更新。'
    };
  }

  const latest = versions[0];
  return {
    ...base,
    ok: true,
    source: 'tag',
    latest,
    tag: latest,
    hasUpdate: compareVersions(latest, current) > 0,
    title: '',
    notes: '',
    publishedAt: null,
    url: `https://github.com/${repo}/releases/tag/${latest}`
  };
}

/** 本机运行环境摘要，给设置页「系统与更新」展示用。 */
function systemInfo() {
  return {
    name: 'happy 出口通',
    version: currentVersion(),
    repo: process.env.HAPPY_UPDATE_REPO || DEFAULT_REPO,
    node: process.version,
    platform: process.platform === 'win32' ? 'Windows' : process.platform,
    arch: process.arch,
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString()
  };
}

module.exports = {
  checkUpdate,
  currentVersion,
  systemInfo,
  compareVersions,
  normalizeRepo,
  DEFAULT_REPO
};
