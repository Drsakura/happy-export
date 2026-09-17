/**
 * 金额英文大写（外贸单证用）
 *
 * 目标格式与信用证 / 发票上的写法一致：
 *   255.36 USD  →  SAY US DOLLARS TWO HUNDRED AND FIFTY-FIVE AND THIRTY-SIX CENTS ONLY
 *   1000 CNY    →  SAY CHINESE YUAN ONE THOUSAND ONLY
 *   0.5 EUR     →  SAY EUROS ZERO AND FIFTY CENTS ONLY
 *
 * 几条实务约定（不是「随便翻译一下」）：
 *   1. 整句以 SAY 开头、以 ONLY 结尾，这是单证上的固定套路。
 *   2. 百位与十位之间用 AND（英式写法），如 TWO HUNDRED AND FIFTY-FIVE。
 *      「组」与「组」之间不重复加 AND，避免 ONE THOUSAND AND TWO HUNDRED AND ... 这种啰嗦写法。
 *   3. 货币名固定用复数形式（US DOLLARS / EUROS），因为这里是货币名称而非计量词，
 *      单证上不写 ONE US DOLLAR。
 *   4. 日元等无小数币种不带辅币段；小数位按币种配置取。
 */

/* 0-19 单独记，20 以上由十位 + 个位拼 */
const ONES = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
  'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
  'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'
]
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']
const SCALES = ['', 'THOUSAND', 'MILLION', 'BILLION', 'TRILLION']

/**
 * 币种配置。
 *   head      —— 大写句里跟在 SAY 后面的货币名（固定复数）
 *   centsHead —— 辅币名（固定复数）
 *   decimals  —— 该币种的小数位（日元等为 0）
 */
const CURRENCY_WORDS = {
  USD: { head: 'US DOLLARS', centsHead: 'CENTS', decimals: 2 },
  CNY: { head: 'CHINESE YUAN', centsHead: 'FEN', decimals: 2 },
  EUR: { head: 'EUROS', centsHead: 'CENTS', decimals: 2 },
  GBP: { head: 'POUNDS STERLING', centsHead: 'PENCE', decimals: 2 },
  HKD: { head: 'HONG KONG DOLLARS', centsHead: 'CENTS', decimals: 2 },
  JPY: { head: 'JAPANESE YEN', centsHead: 'SEN', decimals: 0 },
  AUD: { head: 'AUSTRALIAN DOLLARS', centsHead: 'CENTS', decimals: 2 },
  CAD: { head: 'CANADIAN DOLLARS', centsHead: 'CENTS', decimals: 2 },
  SGD: { head: 'SINGAPORE DOLLARS', centsHead: 'CENTS', decimals: 2 },
  NZD: { head: 'NEW ZEALAND DOLLARS', centsHead: 'CENTS', decimals: 2 },
  CHF: { head: 'SWISS FRANCS', centsHead: 'CENTIMES', decimals: 2 },
  KRW: { head: 'SOUTH KOREAN WON', centsHead: 'JEON', decimals: 0 },
  TWD: { head: 'NEW TAIWAN DOLLARS', centsHead: 'CENTS', decimals: 2 },
  MOP: { head: 'MACAO PATACAS', centsHead: 'AVOS', decimals: 2 },
  AED: { head: 'UAE DIRHAMS', centsHead: 'FILS', decimals: 2 },
  SAR: { head: 'SAUDI RIYALS', centsHead: 'HALALAS', decimals: 2 },
  MYR: { head: 'MALAYSIAN RINGGIT', centsHead: 'SEN', decimals: 2 },
  THB: { head: 'THAI BAHT', centsHead: 'SATANG', decimals: 2 },
  VND: { head: 'VIETNAMESE DONG', centsHead: 'XU', decimals: 0 },
  IDR: { head: 'INDONESIAN RUPIAH', centsHead: 'SEN', decimals: 0 },
  PHP: { head: 'PHILIPPINE PESOS', centsHead: 'CENTAVOS', decimals: 2 },
  INR: { head: 'INDIAN RUPEES', centsHead: 'PAISE', decimals: 2 },
  RUB: { head: 'RUSSIAN RUBLES', centsHead: 'KOPECKS', decimals: 2 },
  BRL: { head: 'BRAZILIAN REALS', centsHead: 'CENTAVOS', decimals: 2 },
  MXN: { head: 'MEXICAN PESOS', centsHead: 'CENTAVOS', decimals: 2 },
  ZAR: { head: 'SOUTH AFRICAN RAND', centsHead: 'CENTS', decimals: 2 },
  TRY: { head: 'TURKISH LIRA', centsHead: 'KURUS', decimals: 2 },
  PLN: { head: 'POLISH ZLOTYS', centsHead: 'GROSZY', decimals: 2 },
  SEK: { head: 'SWEDISH KRONOR', centsHead: 'ORE', decimals: 2 },
  NOK: { head: 'NORWEGIAN KRONER', centsHead: 'ORE', decimals: 2 },
  DKK: { head: 'DANISH KRONER', centsHead: 'ORE', decimals: 2 },
  CZK: { head: 'CZECH KORUNAS', centsHead: 'HALERU', decimals: 2 },
  HUF: { head: 'HUNGARIAN FORINTS', centsHead: 'FILLER', decimals: 2 },
  EGP: { head: 'EGYPTIAN POUNDS', centsHead: 'PIASTRES', decimals: 2 }
}

/** 1–999 转英文。百位后若有非零余数，按英式写法补 AND。 */
function belowThousand(n) {
  const parts = []
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds) parts.push(`${ONES[hundreds]} HUNDRED`)
  if (rest) {
    if (hundreds) parts.push('AND')
    if (rest < 20) parts.push(ONES[rest])
    else {
      const ten = Math.floor(rest / 10)
      const one = rest % 10
      parts.push(one ? `${TENS[ten]}-${ONES[one]}` : TENS[ten])
    }
  }
  return parts.join(' ')
}

/** 非负整数转英文，按千分位分组。 */
function integerToWords(value) {
  if (!Number.isFinite(value) || value <= 0) return 'ZERO'
  const groups = []
  let rest = Math.floor(value)
  let scale = 0
  while (rest > 0) {
    const group = rest % 1000
    if (group) {
      const words = belowThousand(group)
      groups.unshift(SCALES[scale] ? `${words} ${SCALES[scale]}` : words)
    }
    rest = Math.floor(rest / 1000)
    scale += 1
  }
  return groups.join(' ')
}

/** 取币种配置；没登记的币种按 2 位小数 + 代码本身当货币名处理。 */
export function currencyWordsMeta(code) {
  const key = String(code || 'USD').toUpperCase()
  return CURRENCY_WORDS[key] || { head: key, centsHead: 'CENTS', decimals: 2 }
}

/**
 * 金额转英文大写。
 * @param {number|string} amount 金额
 * @param {string} currency 币种代码
 * @returns {string} 形如 "SAY US DOLLARS ... ONLY"；输入无法识别时返回空串
 */
export function amountToWords(amount, currency = 'USD') {
  const num = typeof amount === 'number' ? amount : Number(String(amount ?? '').replace(/[,\s]/g, ''))
  if (!Number.isFinite(num)) return ''

  const meta = currencyWordsMeta(currency)
  const factor = Math.pow(10, meta.decimals)
  /* 先四舍五入到「最小单位」，避免 255.36 这类浮点误差把小数位算成 35.999… */
  const total = Math.round(Math.abs(num) * factor)
  const major = Math.floor(total / factor)
  const minor = total % factor

  const parts = [`SAY ${meta.head}`]
  if (major > 0 || minor === 0) parts.push(integerToWords(major))
  if (minor > 0) {
    // 有辅币时，主币为 0 也要读作 ZERO（单证上不会省略）
    if (major === 0) parts.push('ZERO')
    parts.push('AND')
    parts.push(integerToWords(minor))
    parts.push(meta.centsHead)
  }
  parts.push('ONLY')

  /* 负数在贸易单证里没有位置，但真出现了也别把符号吞掉 */
  return (num < 0 ? 'MINUS ' : '') + parts.join(' ')
}
