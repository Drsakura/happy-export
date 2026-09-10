/**
 * happy 出口通 —— 汇率取数
 *
 * 目标：给顶栏的汇率计算器提供**任意两种货币之间**的换算汇率。
 *
 * 设计要点：
 *   1. 所有汇率统一以 USD 为基准存取（rates[X] = 1 USD 值多少 X），
 *      任意币种对 (from → to) 用 rates[to] / rates[from] 即可算出交叉汇率。
 *   2. 两个公开数据源按顺序尝试，任一成功即用：
 *        - open.er-api.com  免费无需 key，约 160+ 币种，带更新日期
 *        - frankfurter.app  欧洲央行数据，约 30 币种，权威但覆盖面小
 *   3. 结果写内存 + 落盘（backend/data/fx-cache.json，该目录已 gitignore）。
 *      重启后仍能立刻给出上次的汇率，不必等网络。
 *   4. 网络彻底不可用时回退内置离线汇率表，并在响应里标注 source='offline'，
 *      让前端能明确提示「这是离线参考值」。宁可给一个标清楚来源的估算，
 *      也不要让计算器变成一块空白。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'fx-cache.json');

/** 内存缓存的保鲜期：1 小时后下次访问会去拉新数据。 */
const TTL_MS = 60 * 60 * 1000;
/** 单个数据源的超时。 */
const TIMEOUT_MS = 8000;
const USER_AGENT = 'happy-export-fx';

/* ------------------------------ 数据源 ------------------------------ */

/**
 * 每个数据源负责把自家返回体归一成 { rates, updatedAt }。
 * rates 必须以 USD 为基准，键为大写三位币种码。
 */
const PROVIDERS = [
  {
    id: 'open.er-api.com',
    label: 'ExchangeRate-API',
    url: 'https://open.er-api.com/v6/latest/USD',
    pick(json) {
      if (!json || json.result === 'error' || !json.rates) return null;
      const unix = Number(json.time_last_update_unix);
      return {
        rates: json.rates,
        // 这个源会给到精确到秒的更新时间；没有就退回 next_update 或当前时间
        updatedAt: Number.isFinite(unix) && unix > 0
          ? new Date(unix * 1000).toISOString()
          : new Date().toISOString()
      };
    }
  },
  {
    id: 'frankfurter.app',
    label: 'Frankfurter（欧洲央行）',
    url: 'https://api.frankfurter.app/latest?from=USD',
    pick(json) {
      if (!json || !json.rates) return null;
      return {
        // 这个源不返回基准货币自身，补上 USD: 1
        rates: { USD: 1, ...json.rates },
        updatedAt: json.date ? new Date(`${json.date}T00:00:00Z`).toISOString() : new Date().toISOString()
      };
    }
  }
];

/**
 * 离线兜底汇率（1 USD 值多少目标币）。
 * 仅在两个数据源都拿不到、且本地也没有任何历史缓存时启用。
 * 数值是写这份代码时的市场中间价量级，只适合粗估，响应里会明确标注。
 */
const OFFLINE_RATES = {
  USD: 1,
  CNY: 7.10, HKD: 7.80, TWD: 32.2, JPY: 152, KRW: 1360, SGD: 1.34,
  EUR: 0.92, GBP: 0.78, CHF: 0.88, SEK: 10.5, NOK: 10.7, DKK: 6.88,
  PLN: 3.95, CZK: 23.0, TRY: 34.0, RUB: 92.0,
  AUD: 1.51, NZD: 1.64, CAD: 1.37, MXN: 18.5, BRL: 5.55, ARS: 950, CLP: 930,
  INR: 83.5, PKR: 278, BDT: 118, LKR: 300, NPR: 134, VND: 24800,
  THB: 34.5, MYR: 4.45, IDR: 15600, PHP: 56.5, KHR: 4100, MMK: 2100,
  AED: 3.6725, SAR: 3.75, QAR: 3.64, KWD: 0.307, OMR: 0.385, ILS: 3.72,
  EGP: 48.5, ZAR: 18.2, NGN: 1600, KES: 129, MAD: 9.85, TZS: 2700,
  UAH: 41.0, RON: 4.58, HUF: 360, BGN: 1.80, ISK: 138, GEL: 2.72
};

/* ------------------------------ 工具 ------------------------------ */

/** 只保留「键是 3 位字母、值是正数」的条目，顺手统一成大写。 */
function sanitizeRates(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    const code = String(key).trim().toUpperCase();
    const num = Number(value);
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(num) && num > 0) out[code] = num;
  }
  out.USD = 1;
  return out;
}

function readDiskCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const rates = sanitizeRates(parsed && parsed.rates);
    if (Object.keys(rates).length > 1) {
      return {
        rates,
        updatedAt: parsed.updatedAt || null,
        fetchedAt: Number(parsed.fetchedAt) || 0,
        source: parsed.source || 'cache'
      };
    }
  } catch {
    /* 没有缓存或文件损坏都走正常取数流程 */
  }
  return null;
}

function writeDiskCache(payload) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    /* 写不进去不影响本次换算，只是下次重启享受不到缓存 */
  }
}

/** 带超时的 GET，返回解析后的 JSON 对象或 null。 */
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ 主流程 ------------------------------ */

let memory = readDiskCache();
/** 同一个进程里并发调用只发一次网络请求。 */
let inflight = null;

async function refresh() {
  for (const provider of PROVIDERS) {
    const json = await fetchJson(provider.url);
    const picked = json && provider.pick(json);
    if (!picked) continue;
    const rates = sanitizeRates(picked.rates);
    if (Object.keys(rates).length < 10) continue; // 明显不完整，换下一个源
    const payload = {
      rates,
      updatedAt: picked.updatedAt,
      fetchedAt: Date.now(),
      source: provider.id,
      sourceLabel: provider.label
    };
    memory = payload;
    writeDiskCache(payload);
    return payload;
  }
  return null;
}

/**
 * 取汇率表。永远不抛异常。
 * @param {boolean} force 为 true 时忽略缓存有效期，强制刷新
 */
async function getRates(force = false) {
  const fresh = memory && Date.now() - memory.fetchedAt < TTL_MS;
  if (fresh && !force) return { ...memory, stale: false, cached: true };

  if (!inflight) {
    inflight = refresh().finally(() => { inflight = null; });
  }
  const refreshed = await inflight;
  if (refreshed) return { ...refreshed, stale: false, cached: false };

  // 网络失败：有旧数据就先用旧数据，但要标出来
  if (memory) return { ...memory, stale: true, cached: true, warning: '汇率刷新失败，显示的是上次成功获取的数据' };

  return {
    rates: OFFLINE_RATES,
    updatedAt: null,
    fetchedAt: Date.now(),
    source: 'offline',
    sourceLabel: '内置离线汇率',
    stale: true,
    cached: false,
    warning: '当前无法连接汇率服务，显示的是内置离线参考值'
  };
}

module.exports = { getRates, PROVIDERS, OFFLINE_RATES };
