/**
 * 时区清单（顶栏时钟用）
 *
 * 用 IANA 时区名而不是写死的 UTC 偏移量 —— 偏移量一年会变两次，
 * 伦敦夏天是 UTC+1、冬天是 UTC+0，写死必然算错。交给
 * Intl.DateTimeFormat 的 timeZone 处理，夏令时自动正确。
 *
 * zone / cities 只是给人看的标签，实际取时间只认 key。
 * 排列按 UTC 偏移由西向东，方便顺着找客户所在时区。
 */
export const TIMEZONES = [
  { key: 'Pacific/Honolulu', zone: '西十区', cities: '檀香山' },
  { key: 'America/Anchorage', zone: '西九区', cities: '安克雷奇' },
  { key: 'America/Los_Angeles', zone: '西八区', cities: '洛杉矶，温哥华' },
  { key: 'America/Denver', zone: '西七区', cities: '丹佛' },
  { key: 'America/Chicago', zone: '西六区', cities: '芝加哥，墨西哥城' },
  { key: 'America/New_York', zone: '西五区', cities: '纽约，多伦多' },
  { key: 'America/Halifax', zone: '西四区', cities: '哈利法克斯，圣地亚哥' },
  { key: 'America/Sao_Paulo', zone: '西三区', cities: '圣保罗，布宜诺斯艾利斯' },
  { key: 'Atlantic/Azores', zone: '西一区', cities: '亚速尔群岛' },
  { key: 'Europe/London', zone: '零时区', cities: '伦敦' },
  { key: 'Europe/Paris', zone: '东一区', cities: '巴黎，法兰克福' },
  { key: 'Europe/Athens', zone: '东二区', cities: '雅典，开罗' },
  { key: 'Europe/Moscow', zone: '东三区', cities: '莫斯科，利雅得' },
  { key: 'Asia/Dubai', zone: '东四区', cities: '迪拜' },
  { key: 'Asia/Karachi', zone: '东五区', cities: '卡拉奇，伊斯兰堡' },
  { key: 'Asia/Kolkata', zone: '东五区半', cities: '新德里，孟买' },
  { key: 'Asia/Dhaka', zone: '东六区', cities: '达卡，阿拉木图' },
  { key: 'Asia/Bangkok', zone: '东七区', cities: '曼谷，雅加达，河内' },
  { key: 'Asia/Shanghai', zone: '东八区', cities: '北京，上海' },
  { key: 'Asia/Tokyo', zone: '东九区', cities: '东京，首尔' },
  { key: 'Australia/Sydney', zone: '东十区', cities: '悉尼，墨尔本' },
  { key: 'Pacific/Noumea', zone: '东十一区', cities: '努美阿' },
  { key: 'Pacific/Auckland', zone: '东十二区', cities: '奥克兰' }
]

/** 默认时区：Wayne 在上海，默认看本地时间。 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai'

export const TIMEZONE_STORAGE_KEY = 'happy.clockZone'

/** 按 IANA 时区名找条目；找不到给一个兜底条目，避免界面出现空白。 */
export function findTimeZone(key) {
  return TIMEZONES.find(item => item.key === key) || TIMEZONES.find(item => item.key === DEFAULT_TIMEZONE)
}

export function readStoredTimeZone() {
  try {
    const saved = localStorage.getItem(TIMEZONE_STORAGE_KEY)
    return TIMEZONES.some(item => item.key === saved) ? saved : DEFAULT_TIMEZONE
  } catch {
    return DEFAULT_TIMEZONE
  }
}

/* Intl 的构造有开销，按时区缓存复用；界面每秒重绘一次，不缓存会白白产生垃圾。 */
const timeFormatters = new Map()
const dateFormatters = new Map()
const offsetFormatters = new Map()

function timeFormatter(timeZone) {
  if (!timeFormatters.has(timeZone)) {
    timeFormatters.set(timeZone, new Intl.DateTimeFormat('zh-CN', {
      timeZone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    }))
  }
  return timeFormatters.get(timeZone)
}

function dateFormatter(timeZone) {
  if (!dateFormatters.has(timeZone)) {
    dateFormatters.set(timeZone, new Intl.DateTimeFormat('zh-CN', {
      timeZone, month: 'long', day: 'numeric', weekday: 'short'
    }))
  }
  return dateFormatters.get(timeZone)
}

/** "09:28:57"（某些环境会给 24:00 表示午夜，统一成 00） */
export function formatTimeIn(date, timeZone) {
  return timeFormatter(timeZone).format(date).replace(/^24/, '00')
}

/** "9月10日周三" */
export function formatDateIn(date, timeZone) {
  return dateFormatter(timeZone).format(date)
}

/**
 * "UTC+8" / "UTC+5:30" / "UTC"。
 * 优先用 Intl 的 longOffset（自动含夏令时），环境不支持时退回手算。
 */
export function formatOffsetIn(date, timeZone) {
  try {
    if (!offsetFormatters.has(timeZone)) {
      offsetFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }))
    }
    const part = offsetFormatters.get(timeZone).formatToParts(date).find(item => item.type === 'timeZoneName')
    const raw = part && part.value // "GMT+08:00" / "GMT"
    if (!raw) return ''
    if (raw === 'GMT') return 'UTC'
    const match = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (!match) return raw
    return `UTC${match[1]}${Number(match[2])}${match[3] && match[3] !== '00' ? `:${match[3]}` : ''}`
  } catch {
    return ''
  }
}
