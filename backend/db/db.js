const Database = require('better-sqlite3-multiple-ciphers');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const DB_PATH = path.join(DATA_DIR, 'trade.db');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 创建数据库连接
const db = new Database(DB_PATH);

// 启用外键约束
db.pragma('foreign_keys = ON');

/* ---------------------------------------------------------------------------
 * 并发与性能配置 —— 多人共用这套库的命脉，全部显式声明，不依赖驱动默认值。
 *
 * journal_mode=WAL    读写互不阻塞。这是多用户能同时用的前提，
 *                     否则一个写操作会锁住全库所有的读。
 * synchronous=NORMAL  配合 WAL 的平衡点：断电最多丢最后一个事务，
 *                     但不会损坏数据库文件。
 * busy_timeout=5000   写冲突时排队等 5 秒再报错，而不是立刻抛 SQLITE_BUSY。
 *                     ⚠️ 这一项此前一直是 5000，但那是 better-sqlite3 的
 *                     驱动默认值——一旦换驱动、或哪天默认值变了，
 *                     「多人同时保存」就会开始直接报错。必须显式写死。
 *                     单次写事务只需 1–5ms，5 秒足够排完几十人的队列。
 *
 * mmap_size 刻意不设：本库走 SQLCipher 加密路径，内存映射在加密库上
 *   历史有兼容性坑，而库只有几 MB，收益远小于风险。
 * --------------------------------------------------------------------------- */
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// 初始化数据库结构
function initDatabase() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);
  console.log('✓ 数据库初始化完成');
}

// 检查数据库是否已初始化
const tableExists = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
).get();

if (!tableExists) {
  initDatabase();
}

// ---------------------------------------------------------------------------
// 轻量迁移：schema.sql 只对新库生效，老库缺列在这里补。
// todos.list —— 'schedule' 日历日程 / 'memo' 今日待办备忘录（备忘录不带日期）
// ---------------------------------------------------------------------------
function ensureColumns() {
  const todoColumns = db.pragma('table_info(todos)').map(column => column.name);
  if (!todoColumns.includes('list')) {
    db.exec("ALTER TABLE todos ADD COLUMN list TEXT NOT NULL DEFAULT 'schedule'");
    console.log('✓ 迁移：todos.list 列已补齐');
  }

  // 老数据库不会重新执行 schema.sql，这里只补新增表和新增列，不改动已有数据。
  db.exec(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inquiry_no TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      inquiry_date TEXT NOT NULL,
      title TEXT, status TEXT NOT NULL DEFAULT 'draft', currency TEXT DEFAULT 'USD',
      source TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS inquiry_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inquiry_id INTEGER NOT NULL REFERENCES inquiries(id), sku TEXT NOT NULL,
      product_name TEXT, supplier_id INTEGER REFERENCES suppliers(id), supplier_name TEXT,
      purchase_price REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'CNY',
      exchange_rate REAL NOT NULL DEFAULT 1, markup_rate REAL NOT NULL DEFAULT 0,
      markup_factor REAL NOT NULL DEFAULT 1, exw REAL NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1, packaging_snapshot TEXT, product_snapshot TEXT,
      quoted_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS follow_up_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id), activity_type TEXT NOT NULL,
      content TEXT NOT NULL, next_action TEXT, next_action_date TEXT,
      contact_id INTEGER REFERENCES contacts(id), inquiry_id INTEGER REFERENCES inquiries(id),
      created_at TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS product_packaging (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE REFERENCES products(sku), inner_pack_qty INTEGER, carton_qty INTEGER,
      carton_length REAL, carton_width REAL, carton_height REAL, carton_weight REAL,
      unit_length REAL, unit_width REAL, unit_height REAL, unit_weight REAL,
      packaging_material TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS contract_import_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_no TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'queued',
      file_count INTEGER NOT NULL DEFAULT 0, source_files TEXT,
      parse_method TEXT NOT NULL DEFAULT 'rules', rule_version TEXT NOT NULL DEFAULT 'mvp-v1',
      notes TEXT, created_at TEXT NOT NULL, updated_at TEXT, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS contract_import_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES contract_import_jobs(id), filename TEXT NOT NULL,
      row_no INTEGER, raw_text TEXT, sku TEXT, product_name TEXT, purchase_price REAL,
      currency TEXT, quantity INTEGER, status TEXT NOT NULL DEFAULT 'pending_review',
      review_note TEXT, reviewed_by INTEGER REFERENCES users(id), reviewed_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_inquiries_customer ON inquiries(customer_id);
    CREATE INDEX IF NOT EXISTS idx_inquiries_status_date ON inquiries(status, inquiry_date);
    CREATE INDEX IF NOT EXISTS idx_inquiry_items_inquiry ON inquiry_items(inquiry_id);
    CREATE INDEX IF NOT EXISTS idx_inquiry_items_sku ON inquiry_items(sku);
    CREATE INDEX IF NOT EXISTS idx_follow_up_customer_date ON follow_up_records(customer_id, next_action_date);
    CREATE INDEX IF NOT EXISTS idx_follow_up_inquiry ON follow_up_records(inquiry_id);
    CREATE INDEX IF NOT EXISTS idx_product_packaging_sku ON product_packaging(sku);
    CREATE INDEX IF NOT EXISTS idx_contract_import_jobs_status ON contract_import_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_contract_import_items_job ON contract_import_items(job_id, status);

    /* 组织与权限组（多用户阶段）：老库补表。organizations 必须建在 users 补列之前，
       因为下面会给 users 加带外键的 org_id 列。 */
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, code TEXT, description TEXT,
      created_at TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS permission_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE, description TEXT, is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS permission_group_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES permission_groups(id),
      permission_key TEXT NOT NULL, UNIQUE (group_id, permission_key)
    );
    CREATE TABLE IF NOT EXISTS role_permission_groups (
      role TEXT PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES permission_groups(id), updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pg_permissions_group ON permission_group_permissions(group_id);

    /* 产品目录本地化（SKU 模块并入后）：小推车 + 二进制存储。老库补表。
       图片与合同原件单独成表，而不是给 product_images / contracts 加 BLOB 列 ——
       那两张表都用 SELECT * 查，二进制挂在同一行会让每次列表查询都把整张图读进内存。 */
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE, qty INTEGER, note TEXT,
      sort INTEGER DEFAULT 0, added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_image_files (
      image_id INTEGER PRIMARY KEY, bytes BLOB NOT NULL, size INTEGER, stored_at TEXT
    );
    CREATE TABLE IF NOT EXISTS contract_files (
      contract_id INTEGER PRIMARY KEY, filename TEXT, mime TEXT, size INTEGER,
      sha256 TEXT, bytes BLOB NOT NULL, stored_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cart_items_sort ON cart_items(sort);
  `);

  const columnMigrations = {
    inquiries: [
      ['inquiry_no', "TEXT NOT NULL DEFAULT ''"], ['customer_id', 'INTEGER'], ['inquiry_date', "TEXT NOT NULL DEFAULT ''"],
      ['title', 'TEXT'], ['status', "TEXT NOT NULL DEFAULT 'draft'"], ['currency', "TEXT DEFAULT 'USD'"], ['source', 'TEXT'],
      ['notes', 'TEXT'], ['created_at', "TEXT NOT NULL DEFAULT ''"], ['updated_at', 'TEXT']
    ],
    inquiry_items: [
      ['inquiry_id', 'INTEGER'], ['sku', "TEXT NOT NULL DEFAULT ''"], ['product_name', 'TEXT'], ['supplier_id', 'INTEGER'],
      ['supplier_name', 'TEXT'], ['purchase_price', 'REAL NOT NULL DEFAULT 0'], ['currency', "TEXT NOT NULL DEFAULT 'CNY'"],
      ['exchange_rate', 'REAL NOT NULL DEFAULT 1'], ['markup_rate', 'REAL NOT NULL DEFAULT 0'], ['markup_factor', 'REAL NOT NULL DEFAULT 1'],
      ['exw', 'REAL NOT NULL DEFAULT 0'], ['quantity', 'INTEGER NOT NULL DEFAULT 1'], ['packaging_snapshot', 'TEXT'],
      ['product_snapshot', 'TEXT'], ['quoted_at', "TEXT NOT NULL DEFAULT ''"], ['created_at', "TEXT NOT NULL DEFAULT ''"], ['updated_at', 'TEXT']
    ],
    follow_up_records: [
      ['customer_id', 'INTEGER'], ['activity_type', "TEXT NOT NULL DEFAULT 'note'"], ['content', "TEXT NOT NULL DEFAULT ''"],
      ['next_action', 'TEXT'], ['next_action_date', 'TEXT'], ['contact_id', 'INTEGER'], ['inquiry_id', 'INTEGER'],
      ['created_at', "TEXT NOT NULL DEFAULT ''"], ['updated_at', 'TEXT']
    ],
    product_packaging: [
      ['sku', "TEXT NOT NULL DEFAULT ''"], ['inner_pack_qty', 'INTEGER'], ['carton_qty', 'INTEGER'], ['carton_length', 'REAL'],
      ['carton_width', 'REAL'], ['carton_height', 'REAL'], ['carton_weight', 'REAL'], ['unit_length', 'REAL'], ['unit_width', 'REAL'],
      ['unit_height', 'REAL'], ['unit_weight', 'REAL'], ['packaging_material', 'TEXT'], ['notes', 'TEXT'],
      ['created_at', "TEXT NOT NULL DEFAULT ''"], ['updated_at', 'TEXT']
    ],
    contract_import_jobs: [
      ['job_no', "TEXT NOT NULL DEFAULT ''"], ['status', "TEXT NOT NULL DEFAULT 'queued'"], ['file_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['source_files', 'TEXT'], ['parse_method', "TEXT NOT NULL DEFAULT 'rules'"], ['rule_version', "TEXT NOT NULL DEFAULT 'mvp-v1'"],
      // column_map 存本次认列结果（字段→列号/表头/得分）：解析不对时要能自证认了哪几列
      ['column_map', 'TEXT'], ['parse_source', "TEXT DEFAULT 'rules'"],
      ['notes', 'TEXT'], ['created_at', "TEXT NOT NULL DEFAULT ''"], ['updated_at', 'TEXT'], ['completed_at', 'TEXT']
    ],
    contract_import_items: [
      ['job_id', 'INTEGER'], ['filename', "TEXT NOT NULL DEFAULT ''"], ['row_no', 'INTEGER'], ['raw_text', 'TEXT'], ['sku', 'TEXT'],
      ['product_name', 'TEXT'], ['spec', 'TEXT'], ['purchase_price', 'REAL'], ['currency', 'TEXT'], ['quantity', 'INTEGER'],
      ['moq', 'INTEGER'], ['parse_source', "TEXT DEFAULT 'rules'"],
      ['status', "TEXT NOT NULL DEFAULT 'pending_review'"], ['review_note', 'TEXT'], ['reviewed_by', 'INTEGER'], ['reviewed_at', 'TEXT'],
      // 入库留痕：committed_at 记入库时间，product_sku 记实际落库货号（撞号会是 -COPY2）
      ['committed_at', 'TEXT'], ['product_sku', 'TEXT'],
      ['created_at', "TEXT NOT NULL DEFAULT ''"], ['updated_at', 'TEXT']
    ],
    // 报价单明细的成本口径快照（老库补列）
    quotation_items: [
      ['purchase_price', 'REAL'], ['exchange_rate', 'REAL'], ['markup_rate', 'REAL']
    ],
    // 报价单条款结构化字段（老库补列）。payment_terms / delivery_terms 继续存可读文本。
    customer_quotations: [
      ['pi_no', 'TEXT'], ['payment_method', 'TEXT'], ['deposit_percent', 'REAL'], ['balance_percent', 'REAL'],
      ['delivery_method', 'TEXT'], ['delivery_port', 'TEXT'], ['validity_days', 'INTEGER'], ['internal_notes', 'TEXT']
    ],
    // 个人资料与组织归属（老库补列）
    users: [
      ['position', 'TEXT'], ['phone', 'TEXT'], ['address', 'TEXT'], ['avatar', 'TEXT'],
      ['org_id', 'INTEGER'], ['updated_at', 'TEXT']
    ],
    // 产品目录本地化（SKU 模块并入）：上传者 / 归属组织 / 撞号副本来源，以及调价人（老库补列）
    products: [
      ['uploader', 'TEXT'], ['org_id', 'INTEGER'], ['duplicated_from', 'TEXT']
    ],
    price_history: [
      ['changed_by', 'TEXT']
    ],
    // 客户成交状态（新客开发页按 pending / won / lost 分栏）+ 归属与公海（老库补列）
    customers: [
      ['deal_status', "TEXT DEFAULT 'pending'"], ['org_id', 'INTEGER'],
      // created_by 单独记「谁建的」：公海被领取后 owner_id 会换人，创建人这一笔仍要留痕
      ['created_by', 'INTEGER'],
      // pool_status：owned 名下有主 / public 已丢入公海（同组织可见可领）
      ['pool_status', "TEXT DEFAULT 'owned'"], ['pool_at', 'TEXT'], ['pool_note', 'TEXT']
    ]
  };
  for (const [table, columns] of Object.entries(columnMigrations)) {
    const existing = new Set(db.pragma(`table_info(${table})`).map(column => column.name));
    for (const [name, definition] of columns) {
      if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
  /* settings 是键值表，权限点自动补齐的台账记在这里；老库万一没有也兜一下 */
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  /* 依赖「补列之后才存在」的索引，放在这里建 */
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)');
  /* 客户列表现在是「按归属过滤」，owner_id / pool_status 都得有索引 */
  db.exec('CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_customers_pool ON customers(pool_status)');
}

ensureColumns();

// 创建默认管理员账号（如果不存在）
function createDefaultAdmin() {
  const crypto = require('crypto');
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');

  if (!adminExists) {
    // 生成默认密码哈希：admin123
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
    const passwordHash = `scrypt$${salt}$${hash}`;

    db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', passwordHash, '管理员', 'admin', new Date().toISOString());

    console.log('✓ 默认管理员账号已创建');
    console.log('  用户名: admin');
    console.log('  密码: admin123');
    console.log('  请登录后立即修改密码！');
  }
}

createDefaultAdmin();

// ---------------------------------------------------------------------------
// 组织与权限组的开箱数据：只在首次运行写入，之后一律以库里的为准。
// 老库（已有 admin 用户）也会走这里补默认组织与默认权限组。
// ---------------------------------------------------------------------------
function seedAccessControl() {
  const now = new Date().toISOString();
  const { DEFAULT_PERMISSION_GROUPS } = require('../lib/permissions');

  /* 默认组织：让存量用户立刻有归属，「同组织」口径从一开始就成立 */
  let org = db.prepare('SELECT id FROM organizations ORDER BY id LIMIT 1').get();
  if (!org) {
    const result = db.prepare('INSERT INTO organizations (name, code, description, created_at) VALUES (?, ?, ?, ?)')
      .run('happy出口通', 'HAPPY', '默认组织 —— 团队共享的产品/客户资源以此为单位', now);
    org = { id: result.lastInsertRowid };
    console.log('✓ 默认组织已创建：happy出口通');
  }
  db.prepare('UPDATE users SET org_id = ?, updated_at = ? WHERE org_id IS NULL').run(org.id, now);

  /* 默认权限组 + 角色指派 */
  const groupCount = db.prepare('SELECT COUNT(*) AS c FROM permission_groups').get().c;
  if (groupCount === 0) {
    const insertGroup = db.prepare('INSERT INTO permission_groups (name, description, is_system, created_at) VALUES (?, ?, ?, ?)');
    const insertPermission = db.prepare('INSERT OR IGNORE INTO permission_group_permissions (group_id, permission_key) VALUES (?, ?)');
    const assignRole = db.prepare('INSERT OR REPLACE INTO role_permission_groups (role, group_id, updated_at) VALUES (?, ?, ?)');
    for (const group of DEFAULT_PERMISSION_GROUPS) {
      const id = insertGroup.run(group.name, group.description, group.is_system, now).lastInsertRowid;
      for (const key of group.permissions) insertPermission.run(id, key);
      for (const role of group.roles) assignRole.run(role, id, now);
    }
    console.log('✓ 默认权限组与角色指派已创建');
  }

  syncNewPermissions();
  adoptOrphanCustomers(org.id, now);
}

/**
 * 新增权限点的自动补齐。
 *
 * 权限组只在「首次建库」时按 DEFAULT_PERMISSION_GROUPS 灌一遍，之后库里的勾选状态
 * 就是唯一事实 —— 所以后续版本新增的权限点，老库永远不会自动拿到（典型症状：
 * 升级后某个功能对所有人都是「没有权限」）。这里把「全库都不认识的 key」
 * 按默认配置补进对应组，补过就记在 settings 台账里，之后绝不再碰：
 * Wayne 手工取消勾选的动作不会被这段代码在下次启动时倒回去。
 */
function syncNewPermissions() {
  const { DEFAULT_PERMISSION_GROUPS, PERMISSION_KEYS } = require('../lib/permissions');
  const LEDGER = 'perm_autogrant';

  let granted = [];
  try {
    granted = JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(LEDGER)?.value || '[]');
  } catch {
    granted = [];
  }
  const grantedSet = new Set(Array.isArray(granted) ? granted : []);

  const known = new Set(
    db.prepare('SELECT DISTINCT permission_key FROM permission_group_permissions').all()
      .map(row => row.permission_key)
  );
  /* 本版本新增的 = 代码里有、但全库任何组都没拥有过、也没被自动补过 */
  const fresh = PERMISSION_KEYS.filter(key => !known.has(key) && !grantedSet.has(key));
  if (!fresh.length) return;

  const groupByName = db.prepare('SELECT id FROM permission_groups WHERE name = ?');
  const insert = db.prepare('INSERT OR IGNORE INTO permission_group_permissions (group_id, permission_key) VALUES (?, ?)');
  const added = [];
  for (const group of DEFAULT_PERMISSION_GROUPS) {
    const row = groupByName.get(group.name);
    if (!row) continue;
    for (const key of group.permissions) {
      if (!fresh.includes(key)) continue;
      insert.run(row.id, key);
      added.push(`${group.name}:${key}`);
    }
  }
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(LEDGER, JSON.stringify([...grantedSet, ...fresh]));
  if (added.length) console.log(`✓ 新增权限点已补齐：${added.join(', ')}`);
}

/**
 * 存量客户归属回填。
 *
 * 「谁建的谁看得见」这条一旦生效，老库里 owner_id 为空的客户就会变成
 * 「除了最高级别管理账号谁都看不见」—— 升个级把老板的客户弄丢是不可接受的。
 * 所以统一认给最早的系统管理员，org 也一并补上。
 */
function adoptOrphanCustomers(orgId, now) {
  const orphans = db.prepare('SELECT COUNT(*) AS c FROM customers WHERE owner_id IS NULL').get().c;
  if (!orphans) return;
  const owner = db.prepare("SELECT id, org_id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!owner) return;
  db.prepare(`UPDATE customers
                 SET owner_id   = ?,
                     created_by = COALESCE(created_by, ?),
                     org_id     = COALESCE(org_id, ?),
                     updated_at = COALESCE(updated_at, ?)
               WHERE owner_id IS NULL`).run(owner.id, owner.id, owner.org_id || orgId, now);
  console.log(`✓ 存量客户归属回填：${orphans} 条 → 用户 #${owner.id}`);
}

seedAccessControl();

module.exports = db;
