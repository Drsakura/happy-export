const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http');
const db = require('./db/db');
const updater = require('./lib/updater');
const systemRoutes = require('./routes/system');

const app = express();
const PORT = process.env.PORT || 4300;
const HOST = '127.0.0.1';

// 中间件
app.use(cors());

// ---------------------------------------------------------------------------
// SKU 服务代理（过渡期）
// 把 /api/sku/* 原样转发给独立的 sku-manager 服务，让前端在正式合并（P1）完成前
// 也能以同源路径访问 SKU 数据。必须放在 express.json() 之前，保持请求体的流式转发。
// 合并完成后可整体移除，并改用本地路由。
// ---------------------------------------------------------------------------
const SKU_ORIGIN = process.env.SKU_ORIGIN || 'http://127.0.0.1:3300';

/**
 * 把请求原样转发到 sku-manager 服务。
 * @param {string} targetPath 转发到 SKU 服务的目标路径
 */
function proxyToSku(targetPath) {
  return (req, res) => {
    let target;
    try {
      target = new URL(SKU_ORIGIN);
    } catch {
      return res.status(500).json({ error: `SKU_ORIGIN 配置无效：${SKU_ORIGIN}` });
    }

    const proxyReq = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: targetPath,
        method: req.method,
        headers: { ...req.headers, host: target.host }
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: `SKU 服务不可用（${SKU_ORIGIN}）：${err.message}` });
      }
    });

    req.pipe(proxyReq);
  };
}

// /api/sku/suppliers -> http://127.0.0.1:3300/api/suppliers
app.use('/api/sku', (req, res) => proxyToSku('/api' + req.url)(req, res));
// /product-images/xxx.jpg -> http://127.0.0.1:3300/product-images/xxx.jpg
app.use('/product-images', (req, res) => proxyToSku('/product-images' + req.url)(req, res));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// 获取工作台数据
app.get('/api/dashboard', (req, res) => {
  try {
    // 统计数据
    const stats = {
      suppliers: db.prepare('SELECT COUNT(*) as count FROM suppliers').get().count,
      products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
      customers: db.prepare('SELECT COUNT(*) as count FROM customers').get().count,
      orders: db.prepare(`SELECT COUNT(*) as count FROM orders WHERE status != 'cancelled'`).get().count,
      activeDeals: db.prepare(`SELECT COUNT(*) as count FROM deals WHERE status = 'open'`).get().count,
      pendingTodos: db.prepare(`SELECT COUNT(*) as count FROM todos WHERE status = 'pending'`).get().count
    };

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
      todos
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

app.post('/api/suppliers', (req, res) => {
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
app.get('/api/customers', (req, res) => {
  try {
    const customers = db.prepare(`
      SELECT c.*, u.display_name as owner_name
      FROM customers c
      LEFT JOIN users u ON c.owner_id = u.id
      ORDER BY c.created_at DESC
    `).all();
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/customers', (req, res) => {
  try {
    const { company, country, industry, website, email, phone, notes, owner_id } = req.body;
    const result = db.prepare(`
      INSERT INTO customers (company, country, industry, website, email, phone, notes, owner_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(company, country, industry, website, email, phone, notes, owner_id, new Date().toISOString());

    res.json({ id: result.lastInsertRowid, message: '客户创建成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
function getAssistantContext() {
  const stats = {
    suppliers: db.prepare('SELECT COUNT(*) as count FROM suppliers').get().count,
    products: db.prepare('SELECT COUNT(*) as count FROM products').get().count,
    customers: db.prepare('SELECT COUNT(*) as count FROM customers').get().count,
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
      customers: db.prepare('SELECT id, company, country, industry, status, last_contact_at FROM customers ORDER BY created_at DESC LIMIT 8').all(),
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
    res.json(getAssistantContext());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/assistant/command', (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: '请输入指令' });
    const context = getAssistantContext();
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
    res.json({ reply, meta, context });
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
});

