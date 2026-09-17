const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const db = require('./db/db');
const updater = require('./lib/updater');
const systemRoutes = require('./routes/system');
const fxRoutes = require('./routes/fx');
const authRoutes = require('./routes/auth');
const accessRoutes = require('./routes/access');
const auth = require('./lib/auth');
const customerAccess = require('./lib/customerAccess');
const aiProviders = require('./lib/aiProviders');

const app = express();
const PORT = process.env.PORT || 4300;
const HOST = '127.0.0.1';

// 中间件
app.use(cors());

// ---------------------------------------------------------------------------
// 登录门（多用户阶段）
// attachUser 只读 cookie 与请求头、不消费请求体，所以可以放在最前面 ——
// 必须早于下面的 SKU 代理，否则 /api/sku/* 与 /product-images 会绕过鉴权。
// 免登录的只有健康检查、登录相关和系统信息（前端要能在登录页拿到版本号）。
// ---------------------------------------------------------------------------
app.use(auth.attachUser);

const PUBLIC_API_PATTERN = /^\/api\/(health|auth\/|system\/)/;
app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATTERN.test(String(req.originalUrl || '').split('?')[0])) return next();
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  next();
});

// ---------------------------------------------------------------------------
// 产品目录（SKU 模块）已并入本服务 —— 原先是把 /api/sku/* 与 /product-images/* 转发给
// 独立的 sku-manager（3300）。现在由 routes/sku.js 在本库直接执行，端口少一个，
// 路径一个字没改（前端零改动）。挂载点见下面「API 路由」段，必须在登录门之后。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 产品目录解析。
// 原先是「先请求 SKU 服务拿实时价、失败回退本地惰性镜像」—— 因为产品数据在另一个库。
// 合并后数据就在本库同一张表，直接查即可，实现见 lib/skuCatalog.js 的 resolveProduct。
// ---------------------------------------------------------------------------
const { resolveProduct } = require('./lib/skuCatalog');
/* 合同清洗：认列规则引擎 + 原件磁盘留存（7 天自动清理） */
const contractParser = require('./lib/contractParser');
const contractFiles = require('./lib/contractFiles');

/** SKU 相关接口的错误出口：找不到 SKU 给 404，其余交给通用错误处理。 */
function skuError(res, error) {
  if (/SKU 不存在|SKU 不能为空/.test(error.message)) return res.status(404).json({ error: error.message });
  return jsonError(res, error);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage(), limits: { files: 20, fileSize: 10 * 1024 * 1024 } });

/**
 * 修正上传文件名的编码。
 *
 * multipart 里的文件名是裸字节，multer/busboy 为了兼容老客户端默认按 latin1 解码，
 * 于是「腾达（扭矩扳手）.xlsx」会变成「è¾¾ï¼ææï¼.xlsx」——
 * UTF-8 的「腾达」= E8 85 BE E8 BE BE，被逐字节当成了 latin1 字符。
 *
 * 这里判断：只要出现 U+0080–U+00FF 区间的字符，就把它按 latin1 取回原始字节、
 * 再用 UTF-8 解一次。纯 ASCII 名不会命中；本来就正确的 UTF-8 中文名也不会命中
 * （汉字在 U+4E00 以上，不在该区间），所以不会误伤。
 * 回转后若出现替换字符 U+FFFD，说明原串并不是「UTF-8 被 latin1 解码」的产物，保持原样。
 */
function decodeOriginalName(name) {
  const raw = String(name || '');
  if (!raw || !/[\u0080-\u00ff]/.test(raw)) return raw;
  const restored = Buffer.from(raw, 'latin1').toString('utf8');
  return restored.includes('\ufffd') ? raw : restored;
}

/** 在任何用到文件名之前把 req.files / req.file 的 originalname 就地修正。 */
function fixUploadFilenames(req, res, next) {
  for (const file of req.files || []) file.originalname = decodeOriginalName(file.originalname);
  if (req.file) req.file.originalname = decodeOriginalName(req.file.originalname);
  next();
}

const nowIso = () => new Date().toISOString();
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const numberOrNull = value => value === undefined || value === null || value === '' ? null : Number(value);
function validPositiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} 必须是大于 0 的数字`);
  return number;
}
function getCustomer(id) {
  const customerId = Number(id);
  if (!Number.isInteger(customerId) || customerId <= 0) return null;
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
}
/**
 * 统一错误响应。
 *
 * 状态码优先取调用方显式给的值（第三个参数，或 error.statusCode）——
 * 早先只靠消息里的中文关键词猜 400/500，一旦新写一句不含「必须/无效/不存在」的
 * 校验提示（例如「单价无法确定」），就会把业务校验错误错报成 500。
 * 关键词判断保留为兜底，别再往这个正则里堆词。
 */
function jsonError(res, error, statusCode) {
  const message = (error && error.message) || '请求处理失败';
  const status = statusCode || (error && error.statusCode)
    || (/必须|不能为空|格式|不存在|无效|没有需要/.test(message) ? 400 : 500);
  return res.status(status).json({ error: message });
}

/** 业务校验错误：明确回 400，不依赖 jsonError 的关键词兜底 */
function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
/* 合同/报价单的认列逻辑已迁到 lib/contractParser.js（通用字符规则引擎）。
   原来这里有个 parseImportText：写死 5 组别名、只支持 CSV/TSV/TXT、认不出就整列丢掉，
   且表头必须正好在第一行。现在换成「关键词/正则 + 权重打分 + 表头行探测 + 数值列体检」，
   并支持 xlsx/xls —— 换行业只需改配置，不用改代码。 */

// 静态文件服务
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// API 路由
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: updater.currentVersion(),
    timestamp: new Date().toISOString()
  });
});

// 系统信息与版本更新检查
app.use('/api/system', systemRoutes);

// 账号、个人资料与改密
app.use('/api', authRoutes);

// 组织与权限组
app.use('/api', accessRoutes);

// 系统日志（审计轨迹）：列表 / 筛选 / 统计 / 导出
// ⚠️ 挂在 /api/logs 而不是 /api/system/logs —— 后者在免登录白名单里，会把全公司的操作记录公开。
app.use('/api', require('./routes/logs'));

// 产品目录（SKU）：检索 / 产品组 / 货号 / 小推车 / 图片 / 供应商
// 必须放在 express.json() 与登录门之后 —— 写操作要记操作人（上传者 / 调价人）。
const skuRoutes = require('./routes/sku');
app.use('/api/sku', skuRoutes.api);
app.use('/product-images', skuRoutes.images);

// 智能配置：多模型接入、连通测试、用途分配
app.use('/api/ai', require('./routes/ai'));

// 新客开发：开发结果管理（已成交 / 未成交 / 已流失）
app.use('/api/prospects', require('./routes/prospects'));

// 汇率（顶栏汇率计算器用）
app.use('/api/fx', fxRoutes);

// 合同清洗中心：解析规则 / AI 兜底解析 / 批量入库 / 原件下载（上传与单条复核仍在下面）
app.use('/api/contracts', require('./routes/contracts'));

// 获取工作台数据
app.get('/api/dashboard', (req, res) => {
  try {
    /* 工作台上的「客户」口径必须和客户模块一致，否则业务员能在这里看到别人的客户名。
       用 'all' 取范围：有 customer.view_all 的管理账号不限归属，其余人只看自己名下。
       待办（todos）不跟着过滤 —— 它允许没有关联客户，套上归属条件会把这类待办整片抹掉。 */
    const custScope = customerAccess.scopeFilter(req.user, 'all');
    const custWhere = custScope.conditions.length ? ' AND ' + custScope.conditions.join(' AND ') : '';

    // 统计数据
    const stats = {
      suppliers: db.prepare('SELECT COUNT(*) as count FROM suppliers').get().count,
      products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
      customers: db.prepare(`SELECT COUNT(*) as count FROM customers c WHERE 1 = 1${custWhere}`).get(...custScope.params).count,
      orders: db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status != 'cancelled'`).get().count,
      activeDeals: db.prepare(`SELECT COUNT(*) as count FROM deals WHERE status = 'open'`).get().count,
      pendingTodos: db.prepare(`SELECT COUNT(*) as count FROM todos WHERE status = 'pending'`).get().count,
      pendingContractJobs: db.prepare(`SELECT COUNT(*) as count FROM contract_import_jobs WHERE status IN ('queued', 'parsing', 'pending_review')`).get().count
    };

    const todayFollowUps = db.prepare(`
      SELECT f.*, c.company AS customer_name
      FROM follow_up_records f JOIN customers c ON c.id = f.customer_id
      WHERE substr(f.next_action_date, 1, 10) = date('now')${custWhere}
      ORDER BY f.next_action_date ASC LIMIT 20
    `).all(...custScope.params);
    const overdueFollowUps = db.prepare(`
      SELECT f.*, c.company AS customer_name
      FROM follow_up_records f JOIN customers c ON c.id = f.customer_id
      WHERE f.next_action_date IS NOT NULL AND substr(f.next_action_date, 1, 10) < date('now')${custWhere}
      ORDER BY f.next_action_date ASC LIMIT 20
    `).all(...custScope.params);
    const recentInquiries = db.prepare(`
      SELECT i.*, c.company AS customer_name FROM inquiries i
      LEFT JOIN customers c ON c.id = i.customer_id ORDER BY i.created_at DESC LIMIT 10
    `).all();
    const recentQuotes = db.prepare(`
      SELECT q.*, c.company AS customer_name FROM customer_quotations q
      LEFT JOIN customers c ON c.id = q.customer_id ORDER BY q.created_at DESC LIMIT 10
    `).all();
    const pendingContractJobs = db.prepare(`
      SELECT * FROM contract_import_jobs WHERE status IN ('queued', 'parsing', 'pending_review')
      ORDER BY created_at DESC LIMIT 10
    `).all();

    // 最近活动
    const recentActivities = db.prepare(`
      SELECT id, activity_type, subject, content, created_at
      FROM activities
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    // 待办事项
    const todos = db.prepare(`
      SELECT t.*, c.company as customer_name
      FROM todos t
      LEFT JOIN customers c ON t.customer_id = c.id
      WHERE t.status = 'pending'
      ORDER BY t.due_date ASC, t.priority DESC
      LIMIT 10
    `).all();

    res.json({
      stats,
      recentActivities,
      todos,
      todayFollowUps,
      overdueFollowUps,
      recentInquiries,
      recentQuotes,
      pendingContractJobs
    });
  } catch (error) {
    console.error('获取工作台数据失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 供应商路由
app.get('/api/suppliers', (req, res) => {
  try {
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/suppliers', auth.requirePermission('supplier.edit'), (req, res) => {
  try {
    const { name, contact_person, phone, email, address, payment_terms, notes } = req.body;
    const result = db.prepare(`
      INSERT INTO suppliers (name, contact_person, phone, email, address, payment_terms, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, contact_person, phone, email, address, payment_terms, notes, new Date().toISOString());

    res.json({ id: result.lastInsertRowid, message: '供应商创建成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 产品路由
app.get('/api/products', (req, res) => {
  try {
    const products = db.prepare(`
      SELECT p.*, s.name as supplier_name, pg.name as group_name
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN product_groups pg ON p.group_id = pg.id
      ORDER BY p.name
    `).all();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 客户路由
/* ---------------------------------------------------------------------------
 * 客户归属与可见性（Wayne 2026-09-14 定）
 *   ① 客户有「所属」：谁建的归谁，默认只有归属人自己看得见；
 *   ② 创建人主动丢进公海后，同组织成员都能看见、都能领取；
 *   ③ 其余情况只有拿到 customer.view_all 的最高级别管理账号能查看。
 * 口径都收在 lib/customerAccess.js，这里只负责拼查询与守卫。
 * ------------------------------------------------------------------------- */

/** 列表用的公共 SELECT —— 归属人与创建人名字都要带出来，前端不用再打一次 */
const CUSTOMER_SELECT = `
  SELECT c.*,
         u.display_name  AS owner_name,
         cb.display_name AS created_by_name
  FROM customers c
  LEFT JOIN users u  ON c.owner_id   = u.id
  LEFT JOIN users cb ON c.created_by = cb.id
`;

app.get('/api/customers', (req, res, next) => {
  /* 公海看的是别人的资源池，权限点跟「我的客户」不同，按 scope 选守卫 */
  const scope = String(req.query.scope || 'mine').trim();
  const key = scope === 'pool' ? 'pool.view' : 'customer.view';
  return auth.requirePermission(key)(req, res, next);
}, (req, res) => {
  try {
    const scope = String(req.query.scope || 'mine').trim();
    if (scope === 'all' && !customerAccess.seesAll(req.user)) {
      return res.status(403).json({ error: '只有最高级别系统管理账号可以查看全部客户' });
    }
    const { conditions, params } = customerAccess.scopeFilter(req.user, scope);
    const customers = db.prepare(`
      ${CUSTOMER_SELECT}
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY c.created_at DESC
    `).all(...params);
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/customers', auth.requirePermission('customer.edit'), (req, res) => {
  try {
    const company = String(req.body?.company || '').trim();
    if (!company) return res.status(400).json({ error: '公司名称不能为空' });
    const { country, industry, website, email, phone, notes, company_en, address, source } = req.body;
    /* 只认 active / inactive；不传时保持建表默认的 active，
       这样老的调用方（客户管理页的简易表单）行为完全不变。 */
    const status = ['active', 'inactive'].includes(req.body?.status) ? req.body.status : 'active';
    /* 归属默认就是创建人自己 —— 「谁建的谁看得见」从建这一条起就成立。
       只有拿到 customer.view_all 的管理账号才允许代别人建档。 */
    const requestedOwner = customerAccess.seesAll(req.user) ? numberOrNull(req.body?.owner_id) : null;
    const ownerId = requestedOwner || (req.user ? req.user.id : null);
    const result = db.prepare(`
      INSERT INTO customers (company, company_en, country, industry, website, address, email, phone, notes,
                             owner_id, created_by, org_id, source, status, pool_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'owned', ?)
    `).run(company, company_en || null, country || null, industry || null, website || null, address || null,
      email || null, phone || null, notes || null, ownerId,
      req.user ? req.user.id : null, req.user ? (req.user.org_id || null) : null,
      source || null, status, nowIso());
    auth.audit({
      username: req.user?.username,
      action: 'customer_create',
      detail: `新建客户「${company}」，归属 ${req.user?.display_name || '—'}`,
      req
    });
    res.status(201).json({
      id: result.lastInsertRowid,
      owner_id: ownerId,
      message: status === 'active' ? '客户已创建并启用' : '客户已保存（未启用）'
    });
  } catch (error) { jsonError(res, error); }
});

// 编辑客户基本信息（客户详情页「基本信息」的编辑按钮）
app.patch('/api/customers/:id', auth.requirePermission('customer.edit'), (req, res) => {
  try {
    const customer = getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: '客户不存在' });
    if (!customerAccess.canEdit(req.user, customer)) {
      return res.status(403).json({ error: '这条客户不在你名下，请先到客户公海领取' });
    }
    const fields = [];
    const values = [];
    for (const key of ['company', 'company_en', 'country', 'industry', 'website', 'address', 'email', 'phone', 'notes', 'source']) {
      if (req.body?.[key] === undefined) continue;
      const value = req.body[key] === null ? '' : String(req.body[key]).trim();
      if (key === 'company' && !value) throw badRequest('公司名称不能为空');
      fields.push(`${key} = ?`);
      values.push(value || null);
    }
    if (req.body?.owner_id !== undefined) {
      /* 改归属 = 把别人的客户划走，只留给最高级别管理账号 */
      if (!customerAccess.seesAll(req.user)) throw badRequest('只有最高级别系统管理账号可以变更客户归属');
      fields.push('owner_id = ?'); values.push(numberOrNull(req.body.owner_id));
    }
    if (req.body?.status !== undefined) {
      /* 与新建保持一致：只认 active / inactive */
      if (!['active', 'inactive'].includes(req.body.status)) throw badRequest('status 只能是 active 或 inactive');
      fields.push('status = ?'); values.push(req.body.status);
    }
    if (!fields.length) throw badRequest('没有需要更新的字段');
    fields.push('updated_at = ?'); values.push(nowIso(), customer.id);
    db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    res.json({ customer: getCustomer(customer.id) });
  } catch (error) { jsonError(res, error); }
});

/* 丢入公海：归属人主动放弃，客户变成组织共享资源 */
app.post('/api/customers/:id/to-pool', auth.requirePermission('customer.edit'), (req, res) => {
  try {
    const customer = getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: '客户不存在' });
    if (!customerAccess.canEdit(req.user, customer)) {
      return res.status(403).json({ error: '只有客户归属人可以把客户丢进公海' });
    }
    if (customer.pool_status === 'public') throw badRequest('该客户已经在公海里了');
    const note = req.body?.note ? String(req.body.note).trim().slice(0, 200) : null;
    const now = nowIso();
    db.prepare('UPDATE customers SET pool_status = ?, pool_at = ?, pool_note = ?, updated_at = ? WHERE id = ?')
      .run('public', now, note, now, customer.id);
    db.prepare(`INSERT INTO activities (customer_id, activity_type, content, created_at) VALUES (?, ?, ?, ?)`)
      .run(customer.id, '丢入公海', `由 ${req.user?.display_name || '—'} 丢入公海${note ? `：${note}` : ''}`, now);
    auth.audit({
      username: req.user?.username,
      action: 'customer_to_pool',
      detail: `客户「${customer.company}」丢入公海${note ? `（${note}）` : ''}`,
      req
    });
    res.json({ ok: true, customer: getCustomer(customer.id) });
  } catch (error) { jsonError(res, error); }
});

/* 从公海领取：谁先领归谁 */
app.post('/api/customers/:id/claim', auth.requirePermission('pool.claim'), (req, res) => {
  try {
    const customer = getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: '客户不存在' });
    if (customer.pool_status !== 'public') throw badRequest('该客户不在公海，无法领取');
    /* 已被列表过滤掉的「别组织的公海客户」，详情接口也要挡住 ——
       否则知道 id 就能直接领走，组织隔离形同虚设 */
    if (!customerAccess.inSameOrg(req.user, customer)) {
      return res.status(403).json({ error: '这条客户属于其他组织的公海，你无法领取' });
    }
    /* 已经在自己名下就别走这条，免得把 pool_at 抹了还以为发生了什么 */
    if (Number(customer.owner_id) === Number(req.user?.id)) throw badRequest('这条客户本来就归你');
    const now = nowIso();
    const claimed = db.prepare(`
      UPDATE customers
         SET owner_id = ?, pool_status = 'owned', pool_at = NULL, pool_note = NULL, updated_at = ?
       WHERE id = ? AND pool_status = 'public'
    `).run(req.user.id, now, customer.id);
    /* 并发下可能已经被别人抢走，changes = 0 就明确回话，不要假装成功 */
    if (!claimed.changes) return res.status(409).json({ error: '这条客户刚被同事领走了，刷新看看' });
    const orgId = req.user.org_id || customer.org_id || null;
    if (orgId && !customer.org_id) db.prepare('UPDATE customers SET org_id = ? WHERE id = ?').run(orgId, customer.id);
    db.prepare(`INSERT INTO activities (customer_id, activity_type, content, created_at) VALUES (?, ?, ?, ?)`)
      .run(customer.id, '公海领取', `由 ${req.user?.display_name || '—'} 从公海领取`, now);
    auth.audit({
      username: req.user?.username,
      action: 'customer_claim',
      detail: `从公海领取客户「${customer.company}」`,
      req
    });
    res.json({ ok: true, customer: getCustomer(customer.id) });
  } catch (error) { jsonError(res, error); }
});

// 客户详情、联系人与跟进
app.get('/api/customers/:id', (req, res) => {
  try {
    const customer = getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: '客户不存在' });
    /* 看不见的客户一律按「不存在」处理：不泄露它是否存在，也省得前端区分两种错 */
    if (!customerAccess.canView(req.user, customer)) return res.status(404).json({ error: '客户不存在' });
    const customerId = customer.id;
    res.json({
      customer,
      contacts: db.prepare('SELECT * FROM contacts WHERE customer_id = ? ORDER BY is_primary DESC, created_at DESC').all(customerId),
      activities: db.prepare('SELECT * FROM activities WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100').all(customerId),
      followups: db.prepare(`SELECT f.*, ct.name AS contact_name FROM follow_up_records f LEFT JOIN contacts ct ON ct.id = f.contact_id WHERE f.customer_id = ? ORDER BY f.created_at DESC LIMIT 100`).all(customerId),
      inquiries: db.prepare('SELECT * FROM inquiries WHERE customer_id = ? ORDER BY created_at DESC').all(customerId),
      quoteOverview: db.prepare(`SELECT COUNT(*) AS count, COALESCE((SELECT SUM(qi.total_price) FROM quotation_items qi JOIN customer_quotations q2 ON q2.id = qi.quotation_id WHERE q2.customer_id = ?), 0) AS total_amount FROM customer_quotations WHERE customer_id = ?`).get(customerId, customerId),
      orderOverview: db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total_amount FROM orders WHERE customer_id = ? AND status != 'cancelled'`).get(customerId),
      quoteItems: db.prepare(`SELECT q.id, q.quote_no, q.quote_date, q.valid_until, q.currency, q.status, COALESCE((SELECT SUM(qi.total_price) FROM quotation_items qi WHERE qi.quotation_id = q.id), 0) AS total_amount FROM customer_quotations q WHERE q.customer_id = ? ORDER BY q.created_at DESC LIMIT 50`).all(customerId),
      orderItems: db.prepare(`SELECT o.id, o.order_no, o.order_date, o.delivery_date, o.currency, o.status, o.total_amount FROM orders o WHERE o.customer_id = ? AND o.status != 'cancelled' ORDER BY o.order_date DESC LIMIT 50`).all(customerId)
    });
  } catch (error) { jsonError(res, error); }
});

app.post('/api/customers/:id/contacts', auth.requirePermission('customer.edit'), (req, res) => {
  try {
    const customer = getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: '客户不存在' });
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: '联系人姓名不能为空' });
    const fields = ['customer_id', 'name', 'name_en', 'position', 'department', 'email', 'phone', 'whatsapp', 'wechat', 'is_primary', 'notes', 'created_at'];
    const values = [customer.id, name, req.body.name_en || null, req.body.position || null, req.body.department || null, req.body.email || null, req.body.phone || null, req.body.whatsapp || null, req.body.wechat || null, req.body.is_primary ? 1 : 0, req.body.notes || null, nowIso()];
    const result = db.prepare(`INSERT INTO contacts (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...values);
    res.status(201).json({ id: result.lastInsertRowid, contact: db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid) });
  } catch (error) { jsonError(res, error); }
});

// 编辑联系人（客户详情页「联系人」卡片上的编辑按钮）
app.patch('/api/customers/:id/contacts/:contactId', auth.requirePermission('customer.edit'), (req, res) => {
  try {
    const customer = getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: '客户不存在' });
    if (!customerAccess.canEdit(req.user, customer)) {
      return res.status(403).json({ error: '这条客户不在你名下，请先到客户公海领取' });
    }
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND customer_id = ?').get(Number(req.params.contactId), customer.id);
    if (!contact) return res.status(404).json({ error: '联系人不存在' });
    const fields = [];
    const values = [];
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) throw badRequest('联系人姓名不能为空');
      fields.push('name = ?'); values.push(name);
    }
    for (const key of ['name_en', 'position', 'department', 'email', 'phone', 'whatsapp', 'wechat', 'notes']) {
      if (req.body?.[key] === undefined) continue;
      const value = req.body[key] === null ? '' : String(req.body[key]).trim();
      fields.push(`${key} = ?`); values.push(value || null);
    }
    if (req.body?.is_primary !== undefined) { fields.push('is_primary = ?'); values.push(req.body.is_primary ? 1 : 0); }
    if (!fields.length) throw badRequest('没有需要更新的字段');
    db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`).run(...values, contact.id);
    /* 设为主要联系人时把同客户的其他联系人降级，保证「主要」唯一 */
    if (req.body?.is_primary) {
      db.prepare('UPDATE contacts SET is_primary = 0 WHERE customer_id = ? AND id != ?').run(customer.id, contact.id);
    }
    res.json({ contact: db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id) });
  } catch (error) { jsonError(res, error); }
});

app.get('/api/customers/:id/follow-ups', (req, res) => {
  try {
    const customer = getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: '客户不存在' });
    if (!customerAccess.canView(req.user, customer)) return res.status(404).json({ error: '客户不存在' });
    res.json(db.prepare(`SELECT f.*, ct.name AS contact_name FROM follow_up_records f LEFT JOIN contacts ct ON ct.id = f.contact_id WHERE f.customer_id = ? ORDER BY COALESCE(f.next_action_date, f.created_at) DESC`).all(Number(req.params.id)));
  } catch (error) { jsonError(res, error); }
});

app.post('/api/customers/:id/follow-ups', auth.requirePermission('customer.edit'), (req, res) => {
  try {
    const customer = getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: '客户不存在' });
    if (!customerAccess.canEdit(req.user, customer)) {
      return res.status(403).json({ error: '这条客户不在你名下，请先到客户公海领取' });
    }
    const activityType = String(req.body?.activity_type || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!activityType || !content) return res.status(400).json({ error: 'activity_type 和 content 不能为空' });
    const nextDate = req.body.next_action_date ? String(req.body.next_action_date).slice(0, 10) : null;
    if (nextDate && !isDate(nextDate)) return res.status(400).json({ error: 'next_action_date 格式应为 YYYY-MM-DD' });
    const contactId = numberOrNull(req.body.contact_id);
    if (contactId && !db.prepare('SELECT id FROM contacts WHERE id = ? AND customer_id = ?').get(contactId, customer.id)) return res.status(400).json({ error: '联系人不属于该客户' });
    const inquiryId = numberOrNull(req.body.inquiry_id);
    if (inquiryId && !db.prepare('SELECT id FROM inquiries WHERE id = ? AND customer_id = ?').get(inquiryId, customer.id)) return res.status(400).json({ error: '询盘不属于该客户' });
    const now = nowIso();
    const result = db.prepare(`INSERT INTO follow_up_records (customer_id, activity_type, content, next_action, next_action_date, contact_id, inquiry_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(customer.id, activityType, content, req.body.next_action || null, nextDate, contactId, inquiryId, now, now);
    db.prepare(`INSERT INTO activities (customer_id, activity_type, content, next_action, next_action_date, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(customer.id, activityType, content, req.body.next_action || null, nextDate, now);
    db.prepare('UPDATE customers SET last_contact_at = ?, updated_at = ? WHERE id = ?').run(now, now, customer.id);
    res.status(201).json({ id: result.lastInsertRowid, followUp: db.prepare('SELECT * FROM follow_up_records WHERE id = ?').get(result.lastInsertRowid) });
  } catch (error) { jsonError(res, error); }
});

// 编辑跟进记录（时间线上每条记录的编辑按钮）
app.patch('/api/customers/:id/follow-ups/:followUpId', auth.requirePermission('customer.edit'), (req, res) => {
  try {
    const customer = getCustomer(req.params.id);
    if (!customer) return res.status(404).json({ error: '客户不存在' });
    const record = db.prepare('SELECT * FROM follow_up_records WHERE id = ? AND customer_id = ?').get(Number(req.params.followUpId), customer.id);
    if (!record) return res.status(404).json({ error: '跟进记录不存在' });
    const fields = [];
    const values = [];
    if (req.body?.activity_type !== undefined) {
      const type = String(req.body.activity_type || '').trim();
      if (!type) throw badRequest('activity_type 不能为空');
      fields.push('activity_type = ?'); values.push(type);
    }
    if (req.body?.content !== undefined) {
      const content = String(req.body.content || '').trim();
      if (!content) throw badRequest('content 不能为空');
      fields.push('content = ?'); values.push(content);
    }
    if (req.body?.next_action !== undefined) {
      fields.push('next_action = ?'); values.push(req.body.next_action ? String(req.body.next_action).trim() : null);
    }
    if (req.body?.next_action_date !== undefined) {
      const nextDate = req.body.next_action_date ? String(req.body.next_action_date).slice(0, 10) : null;
      if (nextDate && !isDate(nextDate)) throw badRequest('next_action_date 格式应为 YYYY-MM-DD');
      fields.push('next_action_date = ?'); values.push(nextDate);
    }
    if (req.body?.contact_id !== undefined) {
      const contactId = numberOrNull(req.body.contact_id);
      if (contactId && !db.prepare('SELECT id FROM contacts WHERE id = ? AND customer_id = ?').get(contactId, customer.id)) throw badRequest('联系人不属于该客户');
      fields.push('contact_id = ?'); values.push(contactId);
    }
    if (req.body?.inquiry_id !== undefined) {
      const inquiryId = numberOrNull(req.body.inquiry_id);
      if (inquiryId && !db.prepare('SELECT id FROM inquiries WHERE id = ? AND customer_id = ?').get(inquiryId, customer.id)) throw badRequest('询盘不属于该客户');
      fields.push('inquiry_id = ?'); values.push(inquiryId);
    }
    if (!fields.length) throw badRequest('没有需要更新的字段');
    fields.push('updated_at = ?'); values.push(nowIso(), record.id);
    db.prepare(`UPDATE follow_up_records SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    /* activities 是当时的流水快照，编辑跟进不回写它，历史记录保持原样 */
    res.json({
      followUp: db.prepare(`SELECT f.*, ct.name AS contact_name FROM follow_up_records f LEFT JOIN contacts ct ON ct.id = f.contact_id WHERE f.id = ?`).get(record.id)
    });
  } catch (error) { jsonError(res, error); }
});

// 询盘与报价计算
function inquiryNo() {
  return `INQ-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 900 + 100)}`;
}
function calculateInquiryItem(body, product, packaging, existing) {
  const purchasePrice = body.purchase_price !== undefined ? validPositiveNumber(body.purchase_price, '采购价') : Number(existing?.purchase_price ?? product.price);
  const exchangeRate = body.exchange_rate !== undefined ? validPositiveNumber(body.exchange_rate, '汇率') : Number(existing?.exchange_rate ?? 1);
  const quantity = body.quantity !== undefined ? Number(body.quantity) : Number(existing?.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('数量必须是大于 0 的整数');
  const currency = String(body.currency !== undefined ? body.currency : (existing?.currency || product.currency || 'CNY')).trim();
  if (!currency) throw new Error('币种不能为空');
  let exw;
  let markupRate;
  if (body.manual_exw !== undefined && body.manual_exw !== null && body.manual_exw !== '') {
    exw = validPositiveNumber(body.manual_exw, 'EXW');
    markupRate = exw / (purchasePrice / exchangeRate) - 1;
    if (!Number.isFinite(markupRate) || markupRate < -1) throw new Error('手动 EXW 反算出的加价率无效');
  } else {
    markupRate = body.markup_rate !== undefined ? Number(body.markup_rate) : Number(existing?.markup_rate ?? 0);
    if (!Number.isFinite(markupRate) || markupRate < -1) throw new Error('加价率必须是大于等于 -1 的数字');
    exw = purchasePrice / exchangeRate * (1 + markupRate);
  }
  if (!Number.isFinite(exw) || exw <= 0) throw new Error('EXW 计算结果无效');
  return { purchasePrice, exchangeRate, quantity, currency, markupRate, markupFactor: 1 + markupRate, exw,
    packagingSnapshot: JSON.stringify(packaging || null), productSnapshot: JSON.stringify(product), supplierId: product.supplier_id || null, supplierName: product.supplier_name || null };
}

app.get('/api/inquiries', (req, res) => {
  try {
    const conditions = [];
    const params = [];
    if (req.query.customer_id !== undefined) { const id = Number(req.query.customer_id); if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'customer_id 无效' }); conditions.push('i.customer_id = ?'); params.push(id); }
    if (req.query.status) { conditions.push('i.status = ?'); params.push(String(req.query.status)); }
    const rows = db.prepare(`SELECT i.*, c.company AS customer_name, COUNT(ii.id) AS item_count FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN inquiry_items ii ON ii.inquiry_id = i.id ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} GROUP BY i.id ORDER BY i.created_at DESC`).all(...params);
    res.json(rows);
  } catch (error) { jsonError(res, error); }
});

app.post('/api/inquiries', auth.requirePermission('inquiry.edit'), (req, res) => {
  try {
    const customerId = Number(req.body?.customer_id);
    if (!Number.isInteger(customerId) || customerId <= 0 || !getCustomer(customerId)) return res.status(400).json({ error: 'customer_id 无效' });
    const now = nowIso();
    const result = db.prepare(`INSERT INTO inquiries (inquiry_no, customer_id, inquiry_date, title, status, currency, source, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(inquiryNo(), customerId, isDate(req.body.inquiry_date) ? req.body.inquiry_date : now.slice(0, 10), req.body.title || null, req.body.status || 'draft', req.body.currency || 'USD', req.body.source || null, req.body.notes || null, now, now);
    res.status(201).json({ inquiry: db.prepare('SELECT * FROM inquiries WHERE id = ?').get(result.lastInsertRowid) });
  } catch (error) { jsonError(res, error); }
});

app.get('/api/inquiries/:id', (req, res) => {
  try {
    const inquiry = db.prepare(`SELECT i.*, c.company AS customer_name FROM inquiries i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`).get(Number(req.params.id));
    if (!inquiry) return res.status(404).json({ error: '询盘不存在' });
    res.json({ inquiry, items: db.prepare('SELECT * FROM inquiry_items WHERE inquiry_id = ? ORDER BY id').all(inquiry.id) });
  } catch (error) { jsonError(res, error); }
});

app.patch('/api/inquiries/:id', auth.requirePermission('inquiry.edit'), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM inquiries WHERE id = ?').get(id)) return res.status(404).json({ error: '询盘不存在' });
    const allowed = ['title', 'status', 'currency', 'source', 'notes', 'inquiry_date'];
    const fields = []; const params = [];
    for (const field of allowed) if (req.body[field] !== undefined) { if (field === 'inquiry_date' && !isDate(req.body[field])) return res.status(400).json({ error: 'inquiry_date 格式应为 YYYY-MM-DD' }); fields.push(`${field} = ?`); params.push(req.body[field]); }
    if (!fields.length) return res.status(400).json({ error: '没有需要更新的字段' });
    fields.push('updated_at = ?'); params.push(nowIso(), id);
    db.prepare(`UPDATE inquiries SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    res.json({ inquiry: db.prepare('SELECT * FROM inquiries WHERE id = ?').get(id) });
  } catch (error) { jsonError(res, error); }
});

app.post('/api/inquiries/:id/items', auth.requirePermission('inquiry.edit'), async (req, res) => {
  try {
    const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(Number(req.params.id));
    if (!inquiry) return res.status(404).json({ error: '询盘不存在' });
    const { product, packaging } = await resolveProduct(req.body?.sku);
    const values = calculateInquiryItem(req.body || {}, product, packaging);
    const now = nowIso();
    const result = db.prepare(`INSERT INTO inquiry_items (inquiry_id, sku, product_name, supplier_id, supplier_name, purchase_price, currency, exchange_rate, markup_rate, markup_factor, exw, quantity, packaging_snapshot, product_snapshot, quoted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(inquiry.id, product.sku, product.name || product.name_en || product.sku, values.supplierId, values.supplierName, values.purchasePrice, values.currency, values.exchangeRate, values.markupRate, values.markupFactor, values.exw, values.quantity, values.packagingSnapshot, values.productSnapshot, now, now, now);
    res.status(201).json({ item: db.prepare('SELECT * FROM inquiry_items WHERE id = ?').get(result.lastInsertRowid) });
  } catch (error) { skuError(res, error); }
});

app.patch('/api/inquiry-items/:id', auth.requirePermission('inquiry.edit'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM inquiry_items WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '询盘明细不存在' });
    const { product, packaging } = await resolveProduct(req.body?.sku || existing.sku);
    const values = calculateInquiryItem(req.body || {}, product, packaging, existing);
    const now = nowIso();
    db.prepare(`UPDATE inquiry_items SET sku = ?, product_name = ?, supplier_id = ?, supplier_name = ?, purchase_price = ?, currency = ?, exchange_rate = ?, markup_rate = ?, markup_factor = ?, exw = ?, quantity = ?, packaging_snapshot = ?, product_snapshot = ?, quoted_at = ?, updated_at = ? WHERE id = ?`).run(product.sku, product.name || product.name_en || product.sku, values.supplierId, values.supplierName, values.purchasePrice, values.currency, values.exchangeRate, values.markupRate, values.markupFactor, values.exw, values.quantity, values.packagingSnapshot, values.productSnapshot, now, now, id);
    res.json({ item: db.prepare('SELECT * FROM inquiry_items WHERE id = ?').get(id) });
  } catch (error) { skuError(res, error); }
});

app.delete('/api/inquiry-items/:id', auth.requirePermission('inquiry.edit'), (req, res) => {
  try {
    const result = db.prepare('DELETE FROM inquiry_items WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: '询盘明细不存在' });
    res.json({ message: '明细已删除' });
  } catch (error) { jsonError(res, error); }
});

// 产品包装
// 先用 resolveProduct 解析一次：既校验 SKU 真实存在，也拿回规范化后的货号 ——
// product_packaging.sku → products.sku 这条外键要求两边写法完全一致。
app.get('/api/products/:sku/packaging', async (req, res) => {
  try {
    const { product } = await resolveProduct(req.params.sku);
    res.json(db.prepare('SELECT * FROM product_packaging WHERE sku = ?').get(product.sku) || { sku: product.sku });
  } catch (error) { skuError(res, error); }
});

app.put('/api/products/:sku/packaging', auth.requirePermission('product.edit'), async (req, res) => {
  try {
    const { product } = await resolveProduct(req.params.sku);
    const sku = product.sku;
    const allowed = ['inner_pack_qty', 'carton_qty', 'carton_length', 'carton_width', 'carton_height', 'carton_weight', 'unit_length', 'unit_width', 'unit_height', 'unit_weight', 'packaging_material', 'notes'];
    const values = allowed.map(field => req.body[field] === undefined ? null : (['packaging_material', 'notes'].includes(field) ? String(req.body[field]).trim() || null : numberOrNull(req.body[field])));
    if (values.some((value, index) => value !== null && !['packaging_material', 'notes'].includes(allowed[index]) && !Number.isFinite(value))) return res.status(400).json({ error: '包装数值字段必须是数字' });
    const now = nowIso();
    db.prepare(`INSERT INTO product_packaging (sku, ${allowed.join(', ')}, created_at, updated_at) VALUES (?, ${allowed.map(() => '?').join(', ')}, ?, ?) ON CONFLICT(sku) DO UPDATE SET ${allowed.map(field => `${field} = excluded.${field}`).join(', ')}, updated_at = excluded.updated_at`).run(sku, ...values, now, now);
    res.json({ packaging: db.prepare('SELECT * FROM product_packaging WHERE sku = ?').get(sku) });
  } catch (error) { skuError(res, error); }
});

// 订单路由
app.get('/api/orders', (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT o.*, c.company as customer_name
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      ORDER BY o.order_date DESC
    `).all();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 商机路由
app.get('/api/deals', (req, res) => {
  try {
    const deals = db.prepare(`
      SELECT d.*, c.company as customer_name
      FROM deals d
      LEFT JOIN customers c ON d.customer_id = c.id
      WHERE d.status = 'open'
      ORDER BY d.expected_close_date
    `).all();
    res.json(deals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Assistant read layer: every query is explicit and read-only unless a future
// command is added to the allowlist below.
function getAssistantContext(user) {
  /* 助手读的也是同一份客户口径 —— 否则业务员绕一句「列出最近客户」就能问出别人的名单 */
  const custScope = customerAccess.scopeFilter(user, 'all');
  const custWhere = custScope.conditions.length ? ' WHERE ' + custScope.conditions.join(' AND ') : '';
  const stats = {
    suppliers: db.prepare('SELECT COUNT(*) as count FROM suppliers').get().count,
    products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
    customers: db.prepare(`SELECT COUNT(*) as count FROM customers c${custWhere}`).get(...custScope.params).count,
    orders: db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status != 'cancelled'`).get().count,
    deals: db.prepare(`SELECT COUNT(*) as count FROM deals WHERE status = 'open'`).get().count,
    todos: db.prepare(`SELECT COUNT(*) as count FROM todos WHERE status = 'pending'`).get().count
  };
  return {
    generatedAt: new Date().toISOString(),
    stats,
    recent: {
      suppliers: db.prepare('SELECT id, name, contact_person, phone FROM suppliers ORDER BY created_at DESC LIMIT 8').all(),
      products: db.prepare('SELECT sku, sku as id, name, brand, supplier_id, confidence as status FROM products ORDER BY created_at DESC LIMIT 8').all(),
      customers: db.prepare(`SELECT id, company, country, industry, status, last_contact_at FROM customers c${custWhere} ORDER BY created_at DESC LIMIT 8`).all(...custScope.params),
      orders: db.prepare('SELECT id, order_no, customer_id, order_date, total_amount, currency, status FROM orders ORDER BY order_date DESC LIMIT 8').all(),
      deals: db.prepare(`SELECT id, title, customer_id, amount, currency, stage, expected_close_date FROM deals WHERE status = 'open' ORDER BY expected_close_date LIMIT 8`).all(),
      todos: db.prepare(`SELECT id, title, due_date, priority, status, customer_id FROM todos WHERE status = 'pending' ORDER BY due_date ASC LIMIT 8`).all(),
      activities: db.prepare('SELECT id, activity_type, subject, content, created_at FROM activities ORDER BY created_at DESC LIMIT 8').all()
    },
    capabilities: [
      { id: 'read.dashboard', label: '读取工作台概览' },
      { id: 'read.suppliers', label: '检索供应商与联系人' },
      { id: 'read.products', label: '检索产品与 SKU' },
      { id: 'read.customers', label: '检索客户与跟进状态' },
      { id: 'read.orders', label: '查询订单与状态' },
      { id: 'read.deals', label: '查询商机与预计成交' },
      { id: 'read.todos', label: '查询待办与截止日期' },
      { id: 'write.confirmed', label: '执行已确认的业务写操作' }
    ]
  };
}

app.get('/api/assistant/context', (req, res) => {
  try {
    res.json(getAssistantContext(req.user));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 本地规则答复（零配置兜底）。
 * 没接任何模型时小皮也得能干活，所以这套意图识别一直保留。
 */
function localAssistantReply(prompt, context) {
  const { stats } = context;
  let reply = `已读取系统数据：${stats.customers} 个客户、${stats.products} 个产品、${stats.orders} 笔进行中订单、${stats.deals} 个开放商机、${stats.todos} 项待办。`;
  let meta = 'READ_ONLY_CONTEXT';
  if (/待办|任务|日程/.test(prompt)) {
    const items = context.recent.todos.slice(0, 5).map(item => item.title).join('、');
    reply = items ? `当前有 ${stats.todos} 项待办：${items}。` : '当前没有待处理的待办事项。';
  } else if (/客户/.test(prompt)) {
    const items = context.recent.customers.slice(0, 5).map(item => item.company).join('、');
    reply = items ? `我找到 ${stats.customers} 个客户，最近记录包括：${items}。` : '当前还没有客户数据。';
  } else if (/产品|SKU/.test(prompt)) {
    const items = context.recent.products.slice(0, 5).map(item => item.name || item.sku).join('、');
    reply = items ? `当前有 ${stats.products} 个产品，最近记录包括：${items}。` : '当前还没有产品数据。';
  } else if (/供应商/.test(prompt)) {
    const items = context.recent.suppliers.slice(0, 5).map(item => item.name).join('、');
    reply = items ? `当前有 ${stats.suppliers} 个供应商，最近记录包括：${items}。` : '当前还没有供应商数据。';
  } else if (/订单/.test(prompt)) {
    reply = stats.orders ? `当前有 ${stats.orders} 笔进行中订单，最近订单状态已同步到系统上下文。` : '当前没有进行中的订单。';
  } else if (/新建|新增|创建|修改|更新|删除|完成|标记/.test(prompt)) {
    meta = 'CONFIRMATION_REQUIRED';
    reply = '我已经识别到这是一个可能改变系统数据的操作。当前入口已连接系统能力层，但在真正写入前需要确认具体对象、字段和目标；请先说明要操作的业务对象。';
  }
  return { reply, meta };
}

/** 把系统上下文压成一段给大模型看的简报 —— 只带聚合数与最近几条，不外传全库 */
function assistantSystemPrompt(context) {
  const { stats, recent } = context;
  const line = (label, list, pick) => {
    if (!list?.length) return `${label}：暂无`;
    return `${label}：${list.slice(0, 8).map(pick).join('、')}`;
  };
  return [
    '你是「小皮」，外贸出口业务的系统助理，回答简洁、务实、中文优先。',
    '你只能依据下面这份系统快照回答；快照里没有的信息要如实说没有，不要编造。',
    '涉及写操作（新建/修改/删除）时，先复述你要改的对象与字段，等用户确认。',
    '',
    `客户 ${stats.customers} 个 · 产品 ${stats.products} 个 · 供应商 ${stats.suppliers} 个 · 进行中订单 ${stats.orders} 笔 · 开放商机 ${stats.deals} 个 · 待办 ${stats.todos} 项`,
    line('最近客户', recent.customers, item => item.company),
    line('最近产品', recent.products, item => item.name || item.sku),
    line('最近供应商', recent.suppliers, item => item.name),
    line('最近待办', recent.todos, item => item.title)
  ].join('\n');
}

app.post('/api/assistant/command', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: '请输入指令' });
    const context = getAssistantContext(req.user);

    /* 本地规则先算好：模型没配、或模型挂了，都能立刻回一句有用的话 */
    const local = localAssistantReply(prompt, context);

    /* 配了「智能助手对话」用途的模型就真调模型 —— 这才是智能配置的落点 */
    let modelResult = null;
    try {
      modelResult = await aiProviders.chatByPurpose('assistant_chat', [
        { role: 'system', content: assistantSystemPrompt(context) },
        { role: 'user', content: prompt }
      ], { maxTokens: 900, temperature: 0.3, timeoutMs: 60000 });
    } catch (error) {
      modelResult = { ok: false, error: error.message, model: '(未记录)' };
    }

    if (modelResult?.ok && modelResult.text) {
      return res.json({
        reply: modelResult.text,
        meta: 'MODEL',
        context,
        model: {
          provider: modelResult.provider,
          model: modelResult.model,
          latency_ms: modelResult.latency_ms
        }
      });
    }

    if (modelResult && !modelResult.ok) {
      /* 模型失败不静默：把原因带出来，用户才知道该去设置里查 */
      return res.json({
        reply: `${local.reply}\n\n（模型调用失败：${modelResult.error}。以上是本地数据直答，可在「设置 → 智能配置」检查连通性。）`,
        meta: 'RULE_FALLBACK',
        context,
        model_error: modelResult.error
      });
    }

    res.json({ reply: local.reply, meta: local.meta, context });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// 全局搜索：仅索引业务表的非敏感字段，查询参数使用绑定变量。
const SEARCH_SOURCES = [
  { table: 'suppliers', type: 'supplier', typeLabel: '供应商', title: ['name', 'short_name'], detail: ['contact_person', 'phone', 'email', 'address', 'website', 'payment_terms', 'main_categories', 'notes'], path: '/suppliers' },
  { table: 'product_groups', type: 'product', typeLabel: '产品分组', title: ['name', 'group_key'], detail: ['brand', 'category', 'notes'], path: '/products' },
  { table: 'products', type: 'product', typeLabel: '产品', title: ['name', 'sku'], detail: ['display_sku', 'name_en', 'brand', 'category', 'spec', 'price', 'currency', 'moq', 'description', 'parse_method', 'source_contract', 'confidence'], path: '/products' },
  { table: 'item_attributes', type: 'product', typeLabel: '产品参数', title: ['item_sku', 'key'], detail: ['value'], path: '/products' },
  { table: 'tier_prices', type: 'product', typeLabel: '阶梯价格', title: ['sku'], detail: ['moq_from', 'moq_to', 'price', 'currency', 'valid_from', 'valid_until', 'notes'], path: '/products' },
  { table: 'supplier_quotes', type: 'supplier', typeLabel: '供应商报价', title: ['quote_no'], detail: ['quote_date', 'valid_until', 'currency', 'payment_terms', 'notes', 'status'], path: '/suppliers' },
  { table: 'price_history', type: 'product', typeLabel: '价格历史', title: ['sku'], detail: ['old_price', 'new_price', 'old_moq', 'new_moq', 'currency', 'source_contract', 'confidence', 'changed_at'], path: '/products' },
  { table: 'customers', type: 'customer', typeLabel: '客户', title: ['company', 'company_en'], detail: ['country', 'industry', 'website', 'address', 'phone', 'email', 'rating', 'status', 'source', 'tags', 'notes', 'last_contact_at'], path: '/customers' },
  { table: 'contacts', type: 'customer', typeLabel: '客户联系人', title: ['name', 'name_en'], detail: ['position', 'department', 'email', 'phone', 'whatsapp', 'wechat', 'notes'], path: '/customers' },
  { table: 'orders', type: 'order', typeLabel: '订单', title: ['order_no'], detail: ['order_date', 'delivery_date', 'payment_terms', 'total_amount', 'currency', 'status', 'notes'], path: '/orders' },
  { table: 'order_items', type: 'order', typeLabel: '订单明细', title: ['product_name', 'sku'], detail: ['qty', 'unit_price', 'amount', 'notes'], path: '/orders' },
  { table: 'deals', type: 'deal', typeLabel: '商机', title: ['title'], detail: ['amount', 'currency', 'stage', 'probability', 'expected_close_date', 'actual_close_date', 'products', 'status', 'notes'], path: '/prospects' },
  { table: 'todos', type: 'todo', typeLabel: '待办', title: ['title'], detail: ['description', 'due_date', 'priority', 'status'], path: '/' },
  { table: 'activities', type: 'activity', typeLabel: '活动', title: ['subject'], detail: ['activity_type', 'content', 'next_action', 'next_action_date'], path: '/' }
];

function existingColumns(table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

app.get('/api/search', (req, res) => {
  try {
    const term = String(req.query.q || '').trim().slice(0, 100);
    if (!term) return res.json({ results: [] });
    const pattern = `%${term}%`;
    const results = [];
    for (const source of SEARCH_SOURCES) {
      const columns = existingColumns(source.table);
      const searchable = [...source.title, ...source.detail].filter(column => columns.has(column));
      if (!searchable.length) continue;
      const where = searchable.map(column => `CAST(${column} AS TEXT) LIKE ?`).join(' OR ');
      const selected = ['rowid AS _search_id', ...searchable].join(', ');
      const rows = db.prepare(`SELECT ${selected} FROM ${source.table} WHERE ${where} LIMIT 8`).all(...searchable.map(() => pattern));
      rows.forEach(row => {
        const title = source.title.map(column => row[column]).filter(Boolean).join(' · ') || source.typeLabel;
        const detail = source.detail.map(column => row[column]).filter(value => value !== undefined && value !== null && value !== '').join(' · ');
        results.push({ id: row._search_id, type: source.type, typeLabel: source.typeLabel, title, detail: detail || '匹配到业务记录', path: source.path });
      });
    }
    res.json({ results: results.slice(0, 30) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// 日程 / 待办（工作日历用）
// 日历按可见网格的日期范围取数，包含已完成项，便于区分状态。
// ---------------------------------------------------------------------------
const PRIORITIES = ['high', 'medium', 'low'];

// list=schedule（默认）按 due_date 取日历日程；list=memo 取备忘录待办（无日期）
app.get('/api/todos', (req, res) => {
  try {
    const list = req.query.list === 'memo' ? 'memo' : 'schedule';
    const conditions = ['t.list = ?'];
    const params = [list];

    if (list === 'schedule') {
      const from = String(req.query.from || '').slice(0, 10);
      const to = String(req.query.to || '').slice(0, 10);
      conditions.push('t.due_date IS NOT NULL');
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { conditions.push('substr(t.due_date, 1, 10) >= ?'); params.push(from); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { conditions.push('substr(t.due_date, 1, 10) <= ?'); params.push(to); }
    }

    const order = list === 'memo'
      ? `CASE t.status WHEN 'completed' THEN 1 ELSE 0 END ASC, t.created_at ASC`
      : `t.due_date ASC, CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`;

    const todos = db.prepare(`
      SELECT t.id, t.title, t.description, t.due_date, t.priority, t.status, t.customer_id,
             t.created_at, t.completed_at, c.company AS customer_name
      FROM todos t
      LEFT JOIN customers c ON t.customer_id = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${order}
      LIMIT 500
    `).all(...params);

    res.json(todos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/todos', (req, res) => {
  try {
    const list = req.body?.list === 'memo' ? 'memo' : 'schedule';
    const title = String(req.body?.title || '').trim().slice(0, 200);
    if (!title) return res.status(400).json({ error: list === 'memo' ? '请填写待办内容' : '请填写日程标题' });

    // 备忘录不带日期；日程必须落在某一天
    let dueDate = null;
    if (list === 'schedule') {
      const rawDueDate = String(req.body?.due_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDueDate)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
      dueDate = rawDueDate;
    }

    const description = String(req.body?.description || '').trim().slice(0, 1000) || null;
    const priority = PRIORITIES.includes(req.body?.priority) ? req.body.priority : 'medium';
    const now = new Date().toISOString();

    const result = db.prepare(`
      INSERT INTO todos (title, description, due_date, priority, status, list, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(title, description, dueDate, priority, list, now);

    // 活动流；activities 表缺失或字段约束变化时不影响主流程
    try {
      db.prepare(`
        INSERT INTO activities (activity_type, subject, content, created_at)
        VALUES ('todo', ?, ?, ?)
      `).run(list === 'memo' ? '新建待办' : '新建日程', list === 'memo' ? title : `${dueDate} ${title}`, now);
    } catch (activityError) {
      console.warn('写入活动流失败（已忽略）:', activityError.message);
    }

    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(result.lastInsertRowid);
    res.json({ id: result.lastInsertRowid, todo, message: list === 'memo' ? '待办已添加' : '日程已添加' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 勾选完成 / 取消完成 / 改标题等，局部更新
app.patch('/api/todos/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: '待办不存在' });

    const fields = [];
    const params = [];
    const body = req.body || {};

    if (body.status !== undefined) {
      const status = body.status === 'completed' ? 'completed' : 'pending';
      fields.push('status = ?', 'completed_at = ?');
      params.push(status, status === 'completed' ? new Date().toISOString() : null);
    } else if (body.completed === true || body.completed === false) {
      fields.push('status = ?', 'completed_at = ?');
      params.push(body.completed ? 'completed' : 'pending', body.completed ? new Date().toISOString() : null);
    }

    if (body.title !== undefined) {
      const title = String(body.title).trim().slice(0, 200);
      if (!title) return res.status(400).json({ error: '标题不能为空' });
      fields.push('title = ?');
      params.push(title);
    }

    if (body.priority !== undefined) {
      fields.push('priority = ?');
      params.push(PRIORITIES.includes(body.priority) ? body.priority : 'medium');
    }

    if (body.description !== undefined) {
      fields.push('description = ?');
      params.push(String(body.description).trim().slice(0, 1000) || null);
    }

    if (!fields.length) return res.status(400).json({ error: '没有需要更新的字段' });

    params.push(id);
    db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const todo = db.prepare('SELECT * FROM todos WHERE id = ?').get(id);
    res.json({ todo, message: todo.status === 'completed' ? '已标记完成' : '已更新' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/todos/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM todos WHERE id = ?').run(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: '待办不存在' });
    res.json({ message: '已删除' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 合同导入：认列交给通用字符规则引擎（lib/contractParser.js），不按行列位置。
// 原件落磁盘保留 7 天（lib/contractFiles.js）；解析结果才是长期数据。
app.post('/api/contracts/import', auth.requirePermission('cleanup.view'), upload.array('files', 20), fixUploadFilenames, (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: '请上传至少一个合同文件，字段名为 files' });
    const now = nowIso();
    const rules = contractParser.loadRules();
    const jobNo = `CIMP-${now.replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 900 + 100)}`;
    const ruleVersion = `${Object.keys(rules.fields).length}字段词典${rules.override_source ? '+自定义' : ''}`;
    const jobResult = db.prepare(
      `INSERT INTO contract_import_jobs (job_no, status, file_count, source_files, parse_method, rule_version,
                                          column_map, parse_source, created_at, updated_at)
       VALUES (?, 'parsing', ?, ?, 'rules', ?, NULL, 'rules', ?, ?)`
    ).run(jobNo, files.length, JSON.stringify(files.map(file => file.originalname)), ruleVersion, now, now);

    const insertItem = db.prepare(
      `INSERT INTO contract_import_items (job_id, filename, row_no, raw_text, sku, product_name, spec,
                                          purchase_price, currency, quantity, moq, status, review_note,
                                          parse_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, 'rules', ?, ?)`
    );
    /* 分批提交：每批 BATCH_SIZE 行一个事务。
     *
     * 为什么不是「一个文件一个事务」：大 CSV（几千行）会让 SQLite 的写锁一次持有数秒，
     * 而写锁是全库唯一的 —— 这期间其他人的每一次写操作都得排队干等。
     * 切成 400 行一批后，单次锁持有约 1–5ms，既保住批量写入的速度
     * （不必每插一条就 fsync 一次），也不会拖住任何人。
     *
     * 代价是失去「整文件原子性」：中途失败时先落的批次会留在库里。
     * 但它们都带着文件名和行号、状态是 pending_review，在待复核队列里看得见也改得动 ——
     * 比整批回滚更实用（用户至少能保住已解析的部分）。job 仍会被标成 parse_failed。
     *
     * ⚠️ 当前规模下单文件很少超过几百行，这是防御性改造，不是救火。 */
    const BATCH_SIZE = 400;
    const intOrNull = value => (value === null || value === undefined ? null : Math.round(value));
    const matched = {};
    const report = [];
    let parsedFiles = 0;

    const addFile = file => {
      /* 原件先落盘（保留 7 天）。保存失败不抛 —— 原件只是辅助材料，
         不能因为磁盘满/没权限就把整次导入判失败。 */
      contractFiles.saveOriginal(jobNo, file);
      const result = contractParser.parseUpload(file, rules);
      report.push(`${file.originalname}：表头第 ${result.header_row ?? '—'} 行，认出 ${Object.keys(result.column_map).length} 个字段，${result.rows.length} 行`);
      for (const [field, hit] of Object.entries(result.column_map)) matched[field] = hit;

      if (!result.rows.length) {
        insertItem.run(jobResult.lastInsertRowid, file.originalname, null, null, null, null, null,
          null, null, null, null, result.notes || '没有认出表头，需人工复核', now, now);
        return;
      }
      parsedFiles += 1;
      for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
        const batch = result.rows.slice(i, i + BATCH_SIZE);
        db.transaction(() => {
          for (const row of batch) {
            insertItem.run(jobResult.lastInsertRowid, file.originalname, row.row_no, row.raw_text,
              row.sku, row.product_name, row.spec, row.purchase_price, row.currency,
              intOrNull(row.quantity), intOrNull(row.moq), '规则解析结果，提交前请复核', now, now);
          }
        })();
      }
    };
    // 解析中途抛错必须把任务落成失败态。否则 job 永远停在 'parsing'，
    // 工作台的「待复核合同」会一直把它算成待处理项，用户点进去还看不出哪儿错了。
    try {
      files.forEach(addFile);
      /* column_map 把「认了哪几列、多少分」存下来 —— 这是规则引擎唯一能自证的现场，
         认错了列时用户能看到是哪一列抢了位置，再照着加排除词。 */
      const noteText = Object.keys(matched).length
        ? contractParser.describeMatch(matched)
        : '没有认出任何字段，建议人工补录或用 AI 解析';
      db.prepare(`UPDATE contract_import_jobs SET status = 'pending_review', column_map = ?, notes = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(matched), `${noteText}｜${report.join('；')}`.slice(0, 1200), now, jobResult.lastInsertRowid);
    } catch (parseError) {
      db.prepare(`UPDATE contract_import_jobs SET status = 'parse_failed', notes = ?, updated_at = ? WHERE id = ?`)
        .run(`解析中断：${parseError.message}`.slice(0, 500), now, jobResult.lastInsertRowid);
      throw parseError;
    }

    const rowCount = db.prepare('SELECT COUNT(*) AS count FROM contract_import_items WHERE job_id = ?')
      .get(jobResult.lastInsertRowid).count;
    auth.audit({
      username: req.user?.username,
      action: 'contract_import',
      detail: `导入合同 ${files.length} 个文件（任务 ${jobNo}），解析出 ${rowCount} 行，认列：${Object.keys(matched).length} 个字段`,
      req
    });
    res.status(201).json({
      job: db.prepare('SELECT * FROM contract_import_jobs WHERE id = ?').get(jobResult.lastInsertRowid),
      message: parsedFiles
        ? '已按字符规则解析，进入待复核队列'
        : '文件已收下，但规则没认出头：可点「AI 解析」或直接人工补录'
    });
  } catch (error) { jsonError(res, error); }
});

app.get('/api/contracts/import-jobs', (req, res) => {
  try { res.json(db.prepare('SELECT * FROM contract_import_jobs ORDER BY created_at DESC LIMIT 100').all()); } catch (error) { jsonError(res, error); }
});

app.get('/api/contracts/import-jobs/:id', (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM contract_import_jobs WHERE id = ?').get(Number(req.params.id));
    if (!job) return res.status(404).json({ error: '导入任务不存在' });
    res.json({ job, items: db.prepare('SELECT * FROM contract_import_items WHERE job_id = ? ORDER BY filename, row_no, id').all(job.id) });
  } catch (error) { jsonError(res, error); }
});

app.patch('/api/contracts/import-items/:id/review', auth.requirePermission('cleanup.view'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = db.prepare('SELECT * FROM contract_import_items WHERE id = ?').get(id);
    if (!item) return res.status(404).json({ error: '导入明细不存在' });
    const status = ['approved', 'rejected', 'pending_review'].includes(req.body?.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ error: 'status 必须是 approved、rejected 或 pending_review' });
    const now = nowIso();
    db.prepare(`UPDATE contract_import_items SET status = ?, review_note = ?, sku = ?, product_name = ?, purchase_price = ?, currency = ?, quantity = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`).run(status, req.body.review_note || null, req.body.sku ?? item.sku, req.body.product_name ?? item.product_name, req.body.purchase_price === undefined ? item.purchase_price : numberOrNull(req.body.purchase_price), req.body.currency ?? item.currency, req.body.quantity === undefined ? item.quantity : numberOrNull(req.body.quantity), now, now, id);
    const remaining = db.prepare(`SELECT COUNT(*) AS count FROM contract_import_items WHERE job_id = ? AND status = 'pending_review'`).get(item.job_id).count;
    db.prepare('UPDATE contract_import_jobs SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?').run(remaining ? 'pending_review' : 'reviewed', now, remaining ? null : now, item.job_id);
    res.json({ item: db.prepare('SELECT * FROM contract_import_items WHERE id = ?').get(id) });
  } catch (error) { jsonError(res, error); }
});

/* ============================== 客户报价单 ============================== */

/** 报价单合计一律实时从明细汇总 —— 主表不冗余总价，避免两处口径打架 */
const QUOTE_TOTAL_SQL = `COALESCE((SELECT SUM(qi.total_price) FROM quotation_items qi WHERE qi.quotation_id = q.id), 0)`;
const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'];

function roundTo(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(Number(value) * factor) / factor;
}

/** 生成报价单号：QT-YYYYMMDD-NNN，同一天内递增 */
function nextQuoteNo() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `QT-${stamp}-`;
  const last = db.prepare('SELECT quote_no FROM customer_quotations WHERE quote_no LIKE ? ORDER BY quote_no DESC LIMIT 1').get(`${prefix}%`);
  const tail = last ? String(last.quote_no).slice(prefix.length) : '';
  const seq = /^\d+$/.test(tail) ? Number(tail) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

/**
 * 明细行单价：采购价 ÷ 汇率 × (1 + 加价率)。
 * 与询盘报价是同一套口径（inquiry_items 的 exw 就是这么算的），不要在这里另立一套。
 */
function priceFromCost(purchasePrice, exchangeRate, markupRate) {
  const cost = Number(purchasePrice);
  const rate = Number(exchangeRate);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const markup = Number(markupRate);
  return roundTo(cost / rate * (1 + (Number.isFinite(markup) ? markup : 0)), 4);
}

/** 百分比（0-100）；空值返回 null，便于区分「没填」和「填了 0」 */
function percentOrNull(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 100) throw badRequest(`${label}必须在 0 到 100 之间`);
  return roundTo(num, 4);
}

/**
 * 结构化付款条件 → 一句可读文本，写进 payment_terms 列。
 * 报价单列表 / 导出直接展示这一列，所以文本要能独立读懂。
 * T/T + 30% → "T/T 30% 预付款，70% 尾款"；100% → "T/T 100% 预付款（全额预付）"。
 */
function composePaymentTerms(method, deposit, balance) {
  if (!method) return null;
  if (deposit === null) return method;
  if (deposit >= 100) return `${method} 100% 预付款（全额预付）`;
  return `${method} ${deposit}% 预付款，${balance === null ? 100 - deposit : balance}% 尾款`;
}

/** 交货方式 + 地点 → "FOB Shanghai" */
function composeDeliveryTerms(method, port) {
  const text = [method, port].filter(Boolean).join(' ').trim();
  return text || null;
}

app.get('/api/quotes', (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT q.*, c.company AS customer_company, c.country AS customer_country, c.email AS customer_email,
             ${QUOTE_TOTAL_SQL} AS total_amount,
             (SELECT COUNT(*) FROM quotation_items qi WHERE qi.quotation_id = q.id) AS item_count
      FROM customer_quotations q
      LEFT JOIN customers c ON c.id = q.customer_id
      ORDER BY q.created_at DESC LIMIT 200
    `).all());
  } catch (error) { jsonError(res, error); }
});

app.get('/api/quotes/:id', (req, res) => {
  try {
    const quote = db.prepare(`SELECT q.*, c.company AS customer_company FROM customer_quotations q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = ?`).get(Number(req.params.id));
    if (!quote) return res.status(404).json({ error: '报价单不存在' });
    res.json({
      quote,
      customer: quote.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(quote.customer_id) : null,
      contacts: quote.customer_id ? db.prepare('SELECT * FROM contacts WHERE customer_id = ? ORDER BY is_primary DESC, id').all(quote.customer_id) : [],
      items: db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id').all(quote.id)
    });
  } catch (error) { jsonError(res, error); }
});

app.post('/api/quotes', auth.requirePermission('quote.edit'), (req, res) => {
  try {
    const customer = getCustomer(req.body?.customer_id);
    if (!customer) return res.status(400).json({ error: '请选择客户（customer_id 无效）' });

    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rawItems.length) return res.status(400).json({ error: '报价明细不能为空' });

    const currency = String(req.body?.currency || 'USD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ error: '币种必须是 3 位字母代码' });

    const quoteDate = String(req.body?.quote_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    if (!isDate(quoteDate)) return res.status(400).json({ error: 'quote_date 格式应为 YYYY-MM-DD' });
    let validUntil = req.body?.valid_until ? String(req.body.valid_until).slice(0, 10) : null;
    if (validUntil && !isDate(validUntil)) return res.status(400).json({ error: 'valid_until 格式应为 YYYY-MM-DD' });

    /* 有效期天数与截止日期互为兜底：只给天数就自己算日期；两个都给则以日期为准重算天数，避免两处打架 */
    let validityDays = null;
    if (req.body?.validity_days !== undefined && req.body?.validity_days !== null && req.body?.validity_days !== '') {
      const days = Number(req.body.validity_days);
      if (!Number.isInteger(days) || days <= 0) throw badRequest('有效期天数必须是大于 0 的整数');
      validityDays = days;
    }
    if (!validUntil && validityDays) {
      validUntil = new Date(Date.parse(quoteDate) + validityDays * 86400000).toISOString().slice(0, 10);
    } else if (validUntil) {
      validityDays = Math.max(0, Math.round((Date.parse(validUntil) - Date.parse(quoteDate)) / 86400000));
    }
    if (validUntil && validUntil < quoteDate) throw badRequest('有效期不能早于报价日期');

    /* 付款条件：预付 + 尾款必须凑满 100，否则存进去的是一笔算不平的账 */
    const paymentMethod = req.body?.payment_method ? String(req.body.payment_method).trim() : null;
    const depositPercent = percentOrNull(req.body?.deposit_percent, '预付款比例');
    const balancePercent = percentOrNull(req.body?.balance_percent, '尾款比例');
    if (depositPercent !== null && balancePercent !== null && Math.abs(depositPercent + balancePercent - 100) > 0.001) {
      throw badRequest('预付款与尾款比例之和必须是 100%');
    }
    const paymentTermsText = paymentMethod
      ? composePaymentTerms(paymentMethod, depositPercent, balancePercent)
      : (req.body?.payment_terms ? String(req.body.payment_terms).trim() : null);

    const deliveryMethod = req.body?.delivery_method ? String(req.body.delivery_method).trim() : null;
    const deliveryPort = req.body?.delivery_port ? String(req.body.delivery_port).trim() : null;
    const deliveryTermsText = (deliveryMethod || deliveryPort)
      ? composeDeliveryTerms(deliveryMethod, deliveryPort)
      : (req.body?.delivery_terms ? String(req.body.delivery_terms).trim() : null);

    const status = QUOTE_STATUSES.includes(req.body?.status) ? req.body.status : 'draft';

    /* 每条明细先校验干净再进事务 —— 不让半截数据落库 */
    const items = rawItems.map((raw, index) => {
      const label = `第 ${index + 1} 行`;
      const sku = String(raw?.sku || '').trim();
      if (!sku) throw badRequest(`${label}缺少货号`);
      const qty = Number(raw?.qty);
      if (!Number.isInteger(qty) || qty <= 0) throw badRequest(`${label}的数量必须是大于 0 的整数`);

      const pick = key => {
        const value = raw?.[key];
        if (value === undefined || value === null || value === '') return null;
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
      };
      const purchasePrice = pick('purchase_price');
      const exchangeRate = pick('exchange_rate');
      const markupRate = pick('markup_rate');

      const provided = pick('unit_price');
      // 前端为了即时预览会自己算一次并传上来；没传就按同一口径在后端补算，兜住
      const unitPrice = provided !== null ? provided : priceFromCost(purchasePrice, exchangeRate, markupRate);
      if (unitPrice === null || unitPrice < 0) {
        throw badRequest(`${label}的单价无法确定：请填单价，或同时填齐采购价 / 汇率 / 加价率`);
      }

      return {
        sku,
        productName: String(raw?.product_name || sku).trim(),
        productNameEn: raw?.product_name_en ? String(raw.product_name_en).trim() : null,
        spec: raw?.spec ? String(raw.spec).trim() : null,
        qty,
        unitPrice: roundTo(unitPrice, 4),
        totalPrice: roundTo(unitPrice * qty, 2),
        currency,
        purchasePrice, exchangeRate, markupRate,
        notes: raw?.notes ? String(raw.notes).trim() : null
      };
    });

    const now = nowIso();
    const create = db.transaction(() => {
      const quoteNo = nextQuoteNo();
      const result = db.prepare(`INSERT INTO customer_quotations (quote_no, customer_id, quote_date, valid_until, validity_days, currency, pi_no, payment_method, deposit_percent, balance_percent, payment_terms, delivery_method, delivery_port, delivery_terms, status, notes, internal_notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(quoteNo, customer.id, quoteDate, validUntil, validityDays, currency,
          req.body?.pi_no ? String(req.body.pi_no).trim() : null,
          paymentMethod, depositPercent, balancePercent, paymentTermsText,
          deliveryMethod, deliveryPort, deliveryTermsText,
          status,
          req.body?.notes ? String(req.body.notes).trim() : null,
          req.body?.internal_notes ? String(req.body.internal_notes).trim() : null,
          now, now);
      const quotationId = result.lastInsertRowid;
      const insertItem = db.prepare(`INSERT INTO quotation_items (quotation_id, sku, product_name, product_name_en, spec, qty, unit_price, total_price, currency, purchase_price, exchange_rate, markup_rate, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const item of items) {
        insertItem.run(quotationId, item.sku, item.productName, item.productNameEn, item.spec, item.qty, item.unitPrice, item.totalPrice, item.currency, item.purchasePrice, item.exchangeRate, item.markupRate, item.notes, now);
      }
      return quotationId;
    });

    const quotationId = create();
    res.status(201).json({
      id: quotationId,
      quote: db.prepare('SELECT * FROM customer_quotations WHERE id = ?').get(quotationId),
      items: db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id').all(quotationId)
    });
  } catch (error) { jsonError(res, error); }
});

app.patch('/api/quotes/:id', auth.requirePermission('quote.edit'), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM customer_quotations WHERE id = ?').get(id)) return res.status(404).json({ error: '报价单不存在' });
    const fields = [];
    const values = [];
    if (req.body?.status !== undefined) {
      if (!QUOTE_STATUSES.includes(req.body.status)) return res.status(400).json({ error: `status 必须是 ${QUOTE_STATUSES.join(' / ')}` });
      fields.push('status = ?'); values.push(req.body.status);
    }
    /* 有效期：天数与日期互为兜底，和 POST 保持同一套口径 */
    if (req.body?.valid_until !== undefined || req.body?.validity_days !== undefined) {
      const current = db.prepare('SELECT quote_date FROM customer_quotations WHERE id = ?').get(id);
      let validUntil = req.body?.valid_until ? String(req.body.valid_until).slice(0, 10) : null;
      if (validUntil && !isDate(validUntil)) throw badRequest('valid_until 格式应为 YYYY-MM-DD');
      let days = null;
      if (req.body?.validity_days !== undefined && req.body?.validity_days !== null && req.body?.validity_days !== '') {
        const n = Number(req.body.validity_days);
        if (!Number.isInteger(n) || n <= 0) throw badRequest('有效期天数必须是大于 0 的整数');
        days = n;
      }
      const base = current?.quote_date || new Date().toISOString().slice(0, 10);
      if (!validUntil && days) validUntil = new Date(Date.parse(base) + days * 86400000).toISOString().slice(0, 10);
      else if (validUntil) days = Math.max(0, Math.round((Date.parse(validUntil) - Date.parse(base)) / 86400000));
      fields.push('valid_until = ?'); values.push(validUntil);
      fields.push('validity_days = ?'); values.push(days);
    }
    /* 付款条件整组重拼：只传了部分字段（例如只改比例）时用库里的现值补齐，不能顺手清空 */
    if (req.body?.payment_method !== undefined || req.body?.deposit_percent !== undefined || req.body?.balance_percent !== undefined) {
      const existing = db.prepare('SELECT payment_method, deposit_percent, balance_percent FROM customer_quotations WHERE id = ?').get(id);
      const method = req.body?.payment_method !== undefined
        ? (req.body.payment_method ? String(req.body.payment_method).trim() : null)
        : (existing?.payment_method || null);
      const deposit = req.body?.deposit_percent !== undefined
        ? percentOrNull(req.body.deposit_percent, '预付款比例')
        : (existing?.deposit_percent ?? null);
      const balance = req.body?.balance_percent !== undefined
        ? percentOrNull(req.body.balance_percent, '尾款比例')
        : (existing?.balance_percent ?? null);
      if (deposit !== null && balance !== null && Math.abs(deposit + balance - 100) > 0.001) throw badRequest('预付款与尾款比例之和必须是 100%');
      fields.push('payment_method = ?'); values.push(method);
      fields.push('deposit_percent = ?'); values.push(deposit);
      fields.push('balance_percent = ?'); values.push(balance);
      fields.push('payment_terms = ?'); values.push(composePaymentTerms(method, deposit, balance));
    }
    /* 交货条件同上：方式或地点任一变了就重拼 delivery_terms */
    if (req.body?.delivery_method !== undefined || req.body?.delivery_port !== undefined) {
      const existing = db.prepare('SELECT delivery_method, delivery_port FROM customer_quotations WHERE id = ?').get(id);
      const method = req.body?.delivery_method !== undefined
        ? (req.body.delivery_method ? String(req.body.delivery_method).trim() : null)
        : (existing?.delivery_method || null);
      const port = req.body?.delivery_port !== undefined
        ? (req.body.delivery_port ? String(req.body.delivery_port).trim() : null)
        : (existing?.delivery_port || null);
      fields.push('delivery_method = ?'); values.push(method);
      fields.push('delivery_port = ?'); values.push(port);
      fields.push('delivery_terms = ?'); values.push(composeDeliveryTerms(method, port));
    }
    for (const key of ['pi_no', 'notes', 'internal_notes']) {
      if (req.body?.[key] !== undefined) {
        const value = req.body[key] === null ? '' : String(req.body[key]).trim();
        fields.push(`${key} = ?`); values.push(value || null);
      }
    }
    if (!fields.length) return res.status(400).json({ error: '没有需要更新的字段' });
    fields.push('updated_at = ?'); values.push(nowIso(), id);
    db.prepare(`UPDATE customer_quotations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    res.json({ quote: db.prepare('SELECT * FROM customer_quotations WHERE id = ?').get(id) });
  } catch (error) { jsonError(res, error); }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('API 请求失败:', error);
  jsonError(res, error);
});

// SPA fallback - 所有未匹配的路由返回 index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// 启动服务器
app.listen(PORT, HOST, () => {
  console.log('========================================');
  console.log('  外贸供应链管理系统');
  console.log('========================================');
  console.log(`  服务器地址: http://${HOST}:${PORT}`);
  console.log(`  启动时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log('========================================');
  /* 合同原件只留 7 天：启动清一次，之后每 6 小时一次（见 lib/contractFiles.js）。
     放这里而不是定时任务里 —— 自建 VPS 上不一定有 cron，服务起来就该自己管好磁盘。 */
  contractFiles.startPurgeSchedule(db);
});

