/**
 * 币种清单（顶栏汇率计算器用）
 *
 * 只是「展示用」的名字与排序。真正有哪些币种、汇率多少，全部以
 * 后端 /api/fx/rates 返回的 rates 为准 —— 接口给了 160+ 币种，
 * 这份清单里没列到的也会照常出现在下拉里（只显示代码）。
 *
 * ORDER 决定下拉里的先后（外贸常用币种在前），未列出的按字母序排在后面。
 */
export const CURRENCY_NAMES = {
  USD: '美元', CNY: '人民币', EUR: '欧元', GBP: '英镑', HKD: '港币', JPY: '日元',
  AUD: '澳元', CAD: '加元', SGD: '新加坡元', CHF: '瑞士法郎', NZD: '新西兰元', KRW: '韩元',
  AED: '阿联酋迪拉姆', SAR: '沙特里亚尔', RUB: '卢布', INR: '印度卢比', BRL: '巴西雷亚尔',
  MXN: '墨西哥比索', THB: '泰铢', VND: '越南盾', MYR: '马来西亚林吉特', IDR: '印尼盾',
  PHP: '菲律宾比索', TRY: '土耳其里拉', ZAR: '南非兰特', PLN: '波兰兹罗提',
  SEK: '瑞典克朗', NOK: '挪威克朗', DKK: '丹麦克朗', EGP: '埃及镑', NGN: '尼日利亚奈拉',
  PKR: '巴基斯坦卢比', BDT: '孟加拉塔卡', KES: '肯尼亚先令', KWD: '科威特第纳尔',
  QAR: '卡塔尔里亚尔', OMR: '阿曼里亚尔', BHD: '巴林第纳尔', ILS: '以色列谢克尔',
  TWD: '新台币', CLP: '智利比索', COP: '哥伦比亚比索', PEN: '秘鲁索尔', ARS: '阿根廷比索',
  UAH: '乌克兰格里夫纳', CZK: '捷克克朗', HUF: '匈牙利福林', RON: '罗马尼亚列伊',
  LKR: '斯里兰卡卢比', NPR: '尼泊尔卢比', MMK: '缅甸元', KHR: '柬埔寨瑞尔',
  TZS: '坦桑尼亚先令', MAD: '摩洛哥迪拉姆', GHS: '加纳塞地', ETB: '埃塞俄比亚比尔',
  UGX: '乌干达先令', ZMW: '赞比亚克瓦查', DZD: '阿尔及利亚第纳尔', TND: '突尼斯第纳尔',
  JOD: '约旦第纳尔', IQD: '伊拉克第纳尔', LBP: '黎巴嫩镑', AZN: '阿塞拜疆马纳特',
  KZT: '哈萨克斯坦坚戈', UZS: '乌兹别克斯坦苏姆', GEL: '格鲁吉亚拉里', AMD: '亚美尼亚德拉姆',
  MNT: '蒙古图格里克', KGS: '吉尔吉斯斯坦索姆', BND: '文莱元', MOP: '澳门元',
  ISK: '冰岛克朗', UYU: '乌拉圭比索', BOB: '玻利维亚诺', PYG: '巴拉圭瓜拉尼',
  CRC: '哥斯达黎加科朗', GTQ: '危地马拉格查尔', DOP: '多米尼加比索', JMD: '牙买加元',
  TTD: '特立尼达和多巴哥元', RSD: '塞尔维亚第纳尔', BGN: '保加利亚列弗',
  HRK: '克罗地亚库纳', ALL: '阿尔巴尼亚列克', MKD: '北马其顿第纳尔'
}

/** 下拉排序权重：外贸结算最常见的排前面。 */
const ORDER = [
  'USD', 'CNY', 'EUR', 'GBP', 'HKD', 'JPY', 'AUD', 'CAD', 'SGD', 'CHF', 'NZD', 'KRW',
  'AED', 'SAR', 'RUB', 'INR', 'BRL', 'MXN', 'THB', 'VND', 'MYR', 'IDR', 'PHP', 'TRY',
  'ZAR', 'PLN', 'SEK', 'NOK', 'DKK', 'TWD', 'EGP', 'NGN', 'PKR', 'BDT', 'KES', 'KWD',
  'QAR', 'OMR', 'BHD', 'ILS', 'CLP', 'COP', 'PEN', 'ARS', 'UAH', 'CZK', 'HUF', 'RON'
]

const RANK = new Map(ORDER.map((code, index) => [code, index]))

/**
 * 把接口返回的 rates 变成下拉选项，按常用度排序。
 * @param {Record<string, number>} rates 以 USD 为基准的汇率表
 * @param {string[]} extra 兜底币种（接口没回来时也要有 USD/CNY 可选）
 */
export function buildCurrencyOptions(rates, extra = ['USD', 'CNY']) {
  const codes = Object.keys(rates || {})
  const merged = Array.from(new Set([...extra, ...codes]))
  return merged
    .map(code => ({ code, name: CURRENCY_NAMES[code] || '' }))
    .sort((a, b) => {
      const ra = RANK.has(a.code) ? RANK.get(a.code) : 999
      const rb = RANK.has(b.code) ? RANK.get(b.code) : 999
      if (ra !== rb) return ra - rb
      return a.code.localeCompare(b.code)
    })
}

/** "USD 美元" / 没中文名时只显示代码 */
export function currencyLabel(code) {
  const name = CURRENCY_NAMES[code]
  return name ? `${code} ${name}` : code
}

/**
 * 交叉汇率：1 from = ? to
 * rates 以 USD 为基准，所以 rates[to] / rates[from] 就是任意两币之间的汇率。
 */
export function crossRate(rates, from, to) {
  if (!rates) return null
  const rf = Number(rates[from])
  const rt = Number(rates[to])
  if (!Number.isFinite(rf) || !Number.isFinite(rt) || rf <= 0) return null
  return rt / rf
}

/**
 * 金额显示：汇率结果的有效位数差别很大
 * （1 CNY ≈ 0.00004 USD，1 USD ≈ 25000 VND），
 * 固定两位小数会让小额变 0、大额全是没意义的零，所以按数量级取精度。
 */
export function formatAmount(value) {
  if (!Number.isFinite(value)) return ''
  const abs = Math.abs(value)
  let digits
  if (abs === 0) digits = 2
  else if (abs >= 1000) digits = 2
  else if (abs >= 1) digits = 4
  else if (abs >= 0.001) digits = 6
  else digits = 8
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

/** 汇率本身用 6 位有效数字展示：0.000131 这种小汇率也能看清。 */
export function formatRate(value) {
  if (!Number.isFinite(value)) return ''
  if (value >= 1000) return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  if (value >= 1) return value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
  return value.toPrecision(4)
}

/** 把输入框里的字符串转成数字；空串、半截输入（"1."）都返回 null 而不是崩掉。 */
export function parseAmount(text) {
  const cleaned = String(text ?? '').replace(/[,\s]/g, '')
  if (!cleaned) return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}
