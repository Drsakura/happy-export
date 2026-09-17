/**
 * 通用表格解析引擎：把「供应商合同 / 报价单」这类文件认成结构化的行。
 *
 * 设计目标（三条，缺一不可）：
 *
 * 1. **按字符认列，不按行列位置。**
 *    规则只描述「这一列的标题大概长什么样」（关键词 / 正则），不写死「第 3 列是价格」。
 *    同一份表加一列、调一下顺序，识别结果不变。
 *
 * 2. **只采纳「标题对得上、且值确实是数值」的列。**
 *    数值类字段（采购价 / 数量 / 起订量）在认列之后还要过一道**列级体检**：
 *    这一列的非空值里能解析成数字的比例达标，才允许采纳。
 *    这一条是「通用」的关键 —— 它挡住的不是错别字，而是「品名里带个『价』字」
 *    这类只看标题一定会踩的坑。
 *
 * 3. **通用、不绑定行业。**
 *    默认真名词典按「语义」组织（中/英 + 常见缩写），词典里**不允许出现任何行业专有词**
 *    （五金、灯具、化工……一概不写）。换一个行业只是换个文件，不是改代码。
 *    词典本身也写成**数据**：可在 `settings['contract.rules']` 或
 *    `DATA_DIR/contract-rules.json` 里增删关键词、排除词、阈值，覆盖默认值。
 *
 * 表头不在第一行也能认：标题行 / 公司抬头 / 日期这些常常占掉前几行，
 * 所以会**在前若干行里挑「规则命中最多」的那一行当表头**，而不是无脑取第 1 行。
 */

const path = require('path');
const fs = require('fs');

const db = require('../db/db');

let XLSX = null;
try {
  // 读 xlsx/xls 用；放在 try 里，没装也不至于整个服务起不来
  XLSX = require('xlsx');
} catch {
  XLSX = null;
}

const SETTINGS_KEY = 'contract.rules';

const DEFAULT_OPTIONS = {
  /** 表头最多往下找几行 */
  header_search_rows: 12,
  /** 认定「这行是表头」至少要有几个字段命中 */
  header_min_hits: 2,
  /** 认列的最低分（低于此分视为没认出来） */
  min_score: 45,
  /** 数值列体检：能解析成数字的比例下限 */
  min_numeric_ratio: 0.6,
  /** 数值列体检最多抽几行 */
  numeric_sample: 40
};

/* ------------------------------------------------------------------ 词典 */

/**
 * 默认规则。
 *
 * 约定：
 *   type      text / number —— number 的列要过数值体检
 *   keys      命中即得分的关键词（中英混排，不分大小写）
 *   exclude   硬排除：命中就直接判定「这一列不是这个字段」
 *   regex     额外的正则特征（写字符串，用 /.../i 形式）
 *
 * ⚠️ 这里的词必须是**通用词**。加词前先问：换个行业还成立吗？
 */
const DEFAULT_FIELDS = {
  sku: {
    label: '货号',
    type: 'text',
    keys: [
      'sku', 'item code', 'item no', 'item number', 'product code', 'product no', 'product number',
      'part no', 'part number', 'model no', 'model number', 'article no', 'article number',
      'style no', 'style number', 'catalog no', 'cat no', 'ref no', 'reference',
      'code', 'model', 'article', 'product id', 'item id',
      '货号', '产品编号', '产品编码', '产品货号', '商品编号', '物料编号', '物料编码', '物料号',
      '型号', '型号规格', '编号', '款号', '图号', '零件号', '存货编码', '存货编号'
    ],
    exclude: ['数量', '价', 'price', 'cost', 'amount', '名称', 'name', 'qty', 'quantity']
  },
  product_name: {
    label: '品名',
    type: 'text',
    keys: [
      'product name', 'item name', 'goods name', 'commodity', 'product description',
      'item description', 'description', 'product', 'item', 'title', 'goods',
      '品名', '产品名称', '商品名称', '货物名称', '产品描述', '商品描述',
      '品名规格', '名称', '描述', '品名及规格', '产品'
    ],
    exclude: ['货号', '编号', '编码', 'code', 'no.', '数量', '价', 'price', 'amount', 'qty', '规格型号']
  },
  spec: {
    label: '规格',
    type: 'text',
    keys: [
      'spec', 'specification', 'specifications', 'size', 'dimension', 'dimensions',
      'material', 'model spec', 'type',
      '规格', '规格型号', '尺寸', '材质', '参数', '规格参数', '规格描述'
    ],
    exclude: ['货号', '编号', '价', 'price', '数量', 'qty', 'amount', '名称']
  },
  purchase_price: {
    label: '采购价',
    type: 'number',
    keys: [
      'purchase price', 'buying price', 'cost price', 'factory price', 'unit price',
      'net price', 'exw price', 'fob price', 'ex works', 'exw', 'fob', 'cost', 'price',
      '采购价', '采购单价', '采购价格', '供货价', '供货单价', '出厂价', '出厂单价',
      '成本价', '成本单价', '未税价', '不含税价', '含税价', '工厂价', '底价', '单价', '价格', '报价'
    ],
    exclude: [
      '总价', '合计', '金额', '总额', '小计', 'amount', 'total', 'sum',
      '售价', '零售', '建议零售', 'retail', 'msrp', 'selling', 'sell price',
      '折扣', 'discount', '毛利', '利润', 'profit', 'margin', '汇率', 'rate', '税点', '运费', 'freight'
    ]
  },
  currency: {
    label: '币种',
    type: 'text',
    keys: ['currency', 'cur', 'unit', '币种', '货币', '币别', '结算币种', '单价币种', '计价币种'],
    exclude: ['数量', 'qty', '价', 'price', '货号', '编号']
  },
  quantity: {
    label: '数量',
    type: 'number',
    keys: [
      'quantity', 'qty', 'order qty', 'order quantity', 'purchase qty', 'purchase quantity',
      'ordered qty', 'amount of order', 'pcs', 'sets', 'qty(pcs)',
      '数量', '订购量', '订购数量', '采购数量', '采购量', '订货量', '订货数量', '数量(pcs)', '件数', '个数'
    ],
    exclude: ['价', 'price', 'cost', 'amount', '金额', '总', '合计', 'moq', '起订', 'min', '最少']
  },
  moq: {
    label: '起订量',
    type: 'number',
    keys: [
      'moq', 'minimum order quantity', 'min order qty', 'min order', 'minimum qty', 'min qty',
      '起订量', '最小起订量', '起订数量', '最少订量', '最小订量', '最小起订'
    ],
    exclude: ['价', 'price', 'cost', 'amount', '金额']
  }
};

/* -------------------------------------------------------------- 配置读取 */

function readJsonFile(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 用户覆盖文件放哪：与数据库同目录，便于随库一起备份 */
function overrideFile() {
  const dir = process.env.DATA_DIR || path.join(__dirname, '../data');
  return path.join(dir, 'contract-rules.json');
}

function readOverride() {
  /* 优先级：DATA_DIR/contract-rules.json（真正意义的「配置文件」） > settings 表。
     前者适合开源用户直接改文件、连界面都不进；后者留给以后的界面化编辑。 */
  const fromFile = readJsonFile(overrideFile());
  if (fromFile && typeof fromFile === 'object') return { source: 'file', data: fromFile };
  try {
    const raw = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY)?.value;
    if (raw) return { source: 'settings', data: JSON.parse(raw) };
  } catch {
    /* 表还没建或值是脏的，当没有覆盖处理 */
  }
  return { source: null, data: {} };
}

/**
 * 合并默认规则与用户覆盖。
 * 覆盖写法（只写要改的部分即可）：
 *   {
 *     "fields": { "purchase_price": { "add": ["供货价"], "exclude": ["吊牌价"] } },
 *     "options": { "min_numeric_ratio": 0.5 },
 *     "disable": ["spec"]
 *   }
 */
function loadRules() {
  const { source, data } = readOverride();
  const options = { ...DEFAULT_OPTIONS, ...(data.options || {}) };
  const disabled = new Set(Array.isArray(data.disable) ? data.disable : []);
  const fields = {};

  for (const [key, def] of Object.entries(DEFAULT_FIELDS)) {
    if (disabled.has(key)) continue;
    const patch = data.fields?.[key] || {};
    const keys = [...def.keys, ...(Array.isArray(patch.add) ? patch.add : [])]
      .filter(item => !(Array.isArray(patch.remove) && patch.remove.includes(item)));
    const exclude = [...def.exclude, ...(Array.isArray(patch.exclude) ? patch.exclude : [])];
    fields[key] = {
      ...def,
      keys,
      exclude,
      // type 允许被覆盖（有人想把「规格」当数值列 тоже可以）
      type: patch.type || def.type,
      regex: Array.isArray(patch.regex) ? patch.regex : []
    };
  }
  return { fields, options, override_source: source };
}

/* ------------------------------------------------------------ 文本与数字 */

/** 全角 → 半角、统一括号、去零宽字符。中文表格里这三样最常见。 */
function normalizeText(value) {
  return String(value ?? '')
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

/** 表头归一：小写、去空白、去尾部标点，让「采购价 (元)」和「采购价」能对上 */
function normalizeHeader(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[：:、,，.。*＊·\-—]+$/g, '')
    .replace(/[（(].*?[)）]$/g, '');   // 去掉尾部的单位括号
}

const hasCJK = text => /[\u4E00-\u9FFF]/.test(text);

/**
 * 把单元格里的值转成数字。
 * 处理：全角数字、千分位（含欧洲写法 1.234,56）、币种符号、单位后缀、
 *      括号负数（会计写法）、前后空白与不可见字符。
 * 返回 null 表示「这不是一个数字」——调用方据此做列级体检。
 */
function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let text = normalizeText(value).replace(/\s/g, '');
  if (!text) return null;

  // 括号负数：(12.5) → -12.5
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  // 欧洲写法：1.234,56 —— 逗号是小数点、点是千分位。必须先判，否则会被当千分位剥掉
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }

  // 剥掉一切非数字字符（币种符号、单位、文字都在这步掉）
  text = text.replace(/[^0-9.\-+]/g, '');
  if (!text) return null;

  /* 符号只允许出现在最前面。
     ⚠️ 不能「把 - 全省掉」—— 那样「12-15」这种区间会被拼成 1215，
     比留空更糟：它会当成真价继续往产品库里走。区间一律判为非数字。 */
  let sign = 1;
  if (/^[-+]/.test(text)) {
    if (text[0] === '-') sign = -1;
    text = text.slice(1);
  }
  if (/[-+]/.test(text)) return null;
  if (!/^\d*\.?\d+$/.test(text)) return null;

  const num = Number(text) * sign * (negative ? -1 : 1);
  return Number.isFinite(num) ? num : null;
}

/** 从整行的内容里猜币种 —— 没有币种列时用 */
const CURRENCY_HINTS = [
  [/¥|￥|人民币|rmb|cny|元/i, 'CNY'],
  [/\$|usd|美元|美金/i, 'USD'],
  [/€|eur|欧元/i, 'EUR'],
  [/£|gbp|英镑/i, 'GBP'],
  [/jpy|日元|円/i, 'JPY'],
  [/krw|韩元|₩/i, 'KRW'],
  [/aud|澳元/i, 'AUD'],
  [/cad|加元/i, 'CAD'],
  [/hkd|港币|港元/i, 'HKD'],
  [/inr|卢比/i, 'INR'],
  [/vnd|越南盾|đ/i, 'VND'],
  [/thb|泰铢|฿/i, 'THB']
];

function guessCurrency(...texts) {
  const joined = texts.map(item => String(item ?? '')).join(' ');
  if (!joined.trim()) return null;
  for (const [pattern, code] of CURRENCY_HINTS) {
    if (pattern.test(joined)) return code;
  }
  // 三字母代码（USD / CNY…）单独兜一次，避免被上面的贪婪匹配漏掉
  const code = joined.match(/\b([A-Z]{3})\b/);
  return code ? code[1] : null;
}

/* ---------------------------------------------------------------- 列匹配 */

/** 单个「表头 × 字段」打分。返回 0 = 不匹配；exclude 命中直接 0。 */
function scoreHeader(header, field) {
  const head = normalizeHeader(header);
  if (!head) return 0;

  for (const bad of field.exclude) {
    const token = normalizeHeader(bad);
    if (token && head.includes(token)) return 0;
  }

  let best = 0;
  for (const rawKey of field.keys) {
    const key = normalizeHeader(rawKey);
    if (!key) continue;

    if (head === key) return 100;

    if (hasCJK(key)) {
      // 中文：包含即可，但关键词越长越可信（「采购单价」远比「价」可信）
      if (head.includes(key)) best = Math.max(best, 50 + key.length * 8);
    } else {
      // 拉丁：短词（no / moq / ref…）必须落在词边界上，否则 notes 会被当成 no
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const boundary = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
      if (boundary.test(head)) best = Math.max(best, 55 + Math.min(key.length, 12) * 3);
    }
  }

  for (const pattern of field.regex) {
    try {
      const [source, flags] = pattern.split(/\/([a-z]*)$/);
      if (new RegExp(source.replace(/^\//, ''), flags || 'i').test(header)) best = Math.max(best, 85);
    } catch {
      /* 用户写的正则不合法就当没写，不能让一份配置文件把整条解析链路打挂 */
    }
  }
  return best;
}

/**
 * 认列：把「表头行」映射成「字段 → 列号」。
 *
 * 两步走：
 *   ① 每个数值字段先过**列级体检** —— 候选列的数字占比不达标直接淘汰（拦「品名带价字」这类误判）
 *   ② 所有候选按分排序，贪心分配：字段没被占、列也没被占才落座
 *      （贪心而不是「每个字段各取最高分」，是为了避免两列抢同一个字段时出现重复占用）
 */
function matchColumns(headers, dataRows, rules) {
  const { fields, options } = rules;
  const candidates = [];
  const rejected = [];

  for (const [fieldKey, field] of Object.entries(fields)) {
    for (let col = 0; col < headers.length; col += 1) {
      const score = scoreHeader(headers[col], field);
      if (score < options.min_score) continue;

      if (field.type === 'number') {
        const sample = dataRows
          .map(row => row[col])
          .filter(value => String(value ?? '').trim() !== '')
          .slice(0, options.numeric_sample);
        if (!sample.length) {
          rejected.push({ field: fieldKey, col, header: headers[col], reason: '整列为空' });
          continue;
        }
        const ok = sample.filter(value => toNumber(value) !== null).length;
        const ratio = ok / sample.length;
        if (ratio < options.min_numeric_ratio) {
          rejected.push({
            field: fieldKey, col, header: headers[col],
            reason: `数值占比 ${Math.round(ratio * 100)}% 低于 ${Math.round(options.min_numeric_ratio * 100)}%`
          });
          continue;
        }
      }
      candidates.push({ field: fieldKey, col, header: String(headers[col] ?? '').trim(), score });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.col - b.col);
  const usedField = new Set();
  const usedCol = new Set();
  const map = {};
  for (const item of candidates) {
    if (usedField.has(item.field) || usedCol.has(item.col)) continue;
    usedField.add(item.field);
    usedCol.add(item.col);
    map[item.field] = item;
  }
  return { map, rejected };
}

/**
 * 挑表头行。
 * 真实文件里表头常常不在第 1 行（上面还有公司抬头、报价日期、说明……），
 * 所以在前若干行里找「字段命中最多」的那一行，而不是无脑取第 1 行。
 */
function detectHeaderRow(matrix, rules) {
  const limit = Math.min(matrix.length, rules.options.header_search_rows);
  let best = { index: 0, hits: 0, matched: null };
  for (let i = 0; i < limit; i += 1) {
    const row = matrix[i] || [];
    const { map } = matchColumns(row, matrix.slice(i + 1), rules);
    const hits = Object.keys(map).length;
    // 命中更多者胜；打平取靠前的（抬头行通常在上面）
    if (hits > best.hits) best = { index: i, hits, matched: map };
  }
  return best;
}

/* ---------------------------------------------------------------- 读文件 */

/** CSV / TSV / TXT：按首行含不含 Tab 决定分隔符（沿用原有口径） */
function readDelimited(buffer, filename) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const delimiter = /\.tsv$/i.test(filename) || (lines[0] || '').includes('\t') ? '\t'
    : (lines[0] || '').includes(';') && !(lines[0] || '').includes(',') ? ';'
      : ',';
  return lines.map(line => splitDelimited(line, delimiter));
}

/** 按分隔符切一行，但引号里的分隔符不算（"A,B" 是一格） */
function splitDelimited(line, delimiter) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map(cell => cell.trim());
}

/** xlsx / xls：交给 SheetJS；多 sheet 时取「非空单元格最多」的那个（通常就是明细表） */
function readWorkbook(buffer) {
  if (!XLSX) throw new Error('未安装 xlsx 解析库，无法读取 Excel 文件');
  const book = XLSX.read(buffer, { type: 'buffer' });
  let best = { matrix: [], cells: -1, sheet: null };
  for (const name of book.SheetNames || []) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true });
    const cells = matrix.reduce((sum, row) => sum + row.filter(cell => String(cell ?? '').trim() !== '').length, 0);
    if (cells > best.cells) best = { matrix, cells, sheet: name };
  }
  return best;
}

function parseMatrixToRows(matrix, headerIndex, columnMap, fallbackCurrency = null) {
  const fields = Object.keys(columnMap);
  const rows = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const raw = matrix[i] || [];
    const pick = field => {
      const hit = columnMap[field];
      if (!hit) return null;
      const value = normalizeText(raw[hit.col]);
      return value === '' ? null : value;
    };
    const row = {
      // row_no 用「文件里的真实行号」（1 起），方便人回去对着原文件找
      row_no: i + 1,
      raw_text: raw.map(cell => String(cell ?? '').trim()).filter(Boolean).join(' | ').slice(0, 500),
      sku: pick('sku'),
      product_name: pick('product_name'),
      spec: pick('spec'),
      currency: pick('currency'),
      quantity: toNumber(pick('quantity')),
      moq: toNumber(pick('moq')),
      purchase_price: toNumber(pick('purchase_price'))
    };
    /* 币种三级兜底：本行的币种列（上面 pick 过了） → 本行里的符号（¥ / USD / 元）
       → 整份文件的线索（表头常写「单价(元)」「Unit Price(USD)」）。
       只按单行猜会出现「同一列有的行有币种、有的行没有」这种不一致。 */
    if (!row.currency) row.currency = guessCurrency(raw.join(' ')) || fallbackCurrency;
    // 整行该抓的全空 —— 大概率是空行或小计行，丢掉
    const meaningful = [row.sku, row.product_name, row.spec, row.purchase_price, row.quantity, row.moq]
      .some(value => value !== null && value !== undefined && value !== '');
    if (meaningful) rows.push(row);
  }
  return { rows, fields };
}

/**
 * 解析一个上传文件 → { rows, headers, header_row, column_map, rejected, notes }
 * 这是对外的唯一入口。
 */
function parseUpload(file, rules = loadRules()) {
  const filename = String(file.originalname || '');
  const isExcel = /\.(xlsx|xlsm|xls)$/i.test(filename);
  let matrix;
  let sheetName = null;

  if (isExcel) {
    const book = readWorkbook(file.buffer);
    matrix = book.matrix;
    sheetName = book.sheet;
  } else {
    matrix = readDelimited(file.buffer, filename);
  }

  // 去掉整行全空的（xlsx 里尾部常有大量空行）
  matrix = matrix.filter(row => row.some(cell => String(cell ?? '').trim() !== ''));
  if (!matrix.length) {
    return { rows: [], headers: [], header_row: null, column_map: {}, rejected: [], notes: '文件里没有读到任何内容' };
  }

  const header = detectHeaderRow(matrix, rules);
  const headers = matrix[header.index] || [];
  const { map, rejected } = matchColumns(headers, matrix.slice(header.index + 1), rules);
  /* 文件级币种线索：表头 + 表头以上的抬头行（「报价单（美元）」「单价(元)」都在这）
     —— 没有币种列时靠它，保证整列币种一致 */
  const titleRows = matrix.slice(0, header.index).flat();
  const fileCurrency = guessCurrency(headers.join(' '), titleRows.join(' '));
  const { rows } = parseMatrixToRows(matrix, header.index, map, fileCurrency);

  const notes = rows.length
    ? `表头在第 ${header.index + 1} 行，认出 ${Object.keys(map).length} 个字段${sheetName ? `（工作表 ${sheetName}）` : ''}`
    : '表头行没有认出任何字段，建议人工补录或用 AI 解析';

  return {
    rows,
    headers: headers.map(cell => String(cell ?? '').trim()),
    header_row: header.index + 1,
    column_map: map,
    rejected,
    currency: fileCurrency,
    notes
  };
}

/** 读成二维数组（xlsx / csv / tsv / txt 统一入口），AI 解析与规则解析共用 */
function readMatrix(buffer, filename) {
  const isExcel = /\.(xlsx|xlsm|xls)$/i.test(String(filename || ''));
  const matrix = isExcel ? readWorkbook(buffer).matrix : readDelimited(buffer, filename);
  return matrix.filter(row => row.some(cell => String(cell ?? '').trim() !== ''));
}

/** 二维数组 → CSV 文本，喂给模型用 */
function matrixToText(matrix, { maxRows = 200, maxChars = 12000 } = {}) {
  const lines = [];
  let chars = 0;
  for (const row of matrix) {
    const line = row.map(cell => {
      const text = String(cell ?? '').replace(/\s+/g, ' ').trim();
      return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(',').replace(/(?:,)+$/, '');
    if (!line.trim()) continue;
    if (lines.length >= maxRows || chars + line.length > maxChars) {
      lines.push('…（余下内容已截断）');
      break;
    }
    lines.push(line);
    chars += line.length;
  }
  return lines.join('\n');
}

/**
 * 把上传的原件转成「给模型看的文本」。
 * ⚠️ 只做格式转换，不做任何猜测 —— 猜是模型的事，转换是我们的事。
 */
function describeForAi(buffer, filename, options) {
  const matrix = readMatrix(buffer, filename);
  return { text: matrixToText(matrix, options), row_count: matrix.length };
}

/** 给界面用：把认列结果翻译成人能读的一段话 */
function describeMatch(columnMap, rejected = []) {
  const picked = Object.entries(columnMap)
    .map(([field, hit]) => `${DEFAULT_FIELDS[field]?.label || field}←「${hit.header}」(${hit.score}分)`)
    .join('，');
  const miss = rejected.length
    ? `；被否掉：${rejected.map(item => `${item.header}(${item.reason})`).join('，')}`
    : '';
  return (picked || '没有认出任一字段') + miss;
}

module.exports = {
  DEFAULT_FIELDS,
  DEFAULT_OPTIONS,
  loadRules,
  overrideFile,
  parseUpload,
  readMatrix,
  matrixToText,
  describeForAi,
  matchColumns,
  detectHeaderRow,
  describeMatch,
  toNumber,
  normalizeHeader,
  guessCurrency,
  scoreHeader
};
