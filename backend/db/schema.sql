-- ========================================
-- 外贸供应链管理系统数据库结构
-- ========================================

-- ================== 供应商与SKU管理 ==================

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  short_name TEXT,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  website TEXT,
  payment_terms TEXT,
  main_categories TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS product_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_key TEXT,
  brand TEXT,
  category TEXT,
  description TEXT,
  supplier_id INTEGER REFERENCES suppliers(id),
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  display_sku TEXT,
  name TEXT,
  name_en TEXT,
  brand TEXT,
  category TEXT,
  spec TEXT,
  price REAL,
  currency TEXT DEFAULT 'CNY',
  moq INTEGER,
  description TEXT,
  supplier_id INTEGER REFERENCES suppliers(id),
  contract_id INTEGER REFERENCES contracts(id),
  group_id INTEGER REFERENCES product_groups(id),
  parse_method TEXT DEFAULT 'rules',
  last_updated TEXT,
  source_contract TEXT,
  confidence TEXT DEFAULT 'high',
  -- 上传者 / 归属组织 / 撞号副本来源：产品库是组织共享的，谁都能传自己那一版，
  -- 「谁传的、复制自谁」必须可追，见 lib/skuCatalog.js 的 insertItem。
  uploader TEXT,
  org_id INTEGER,
  duplicated_from TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- 自定义参数（包装参数、产品规格等）
CREATE TABLE IF NOT EXISTS item_attributes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER REFERENCES product_groups(id),
  sku TEXT,
  name TEXT NOT NULL,
  value TEXT,
  sort INTEGER DEFAULT 0
);

-- 阶梯价格表
CREATE TABLE IF NOT EXISTS tier_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  moq_from INTEGER NOT NULL,
  moq_to INTEGER,
  price REAL NOT NULL,
  currency TEXT DEFAULT 'CNY',
  valid_from TEXT,
  valid_until TEXT,
  quote_id INTEGER REFERENCES supplier_quotes(id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- 供应商报价记录
CREATE TABLE IF NOT EXISTS supplier_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  quote_no TEXT,
  quote_date TEXT NOT NULL,
  valid_until TEXT,
  currency TEXT DEFAULT 'CNY',
  payment_terms TEXT,
  notes TEXT,
  pdf_file TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- 价格历史
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL,
  old_price REAL,
  new_price REAL,
  old_moq INTEGER,
  new_moq INTEGER,
  currency TEXT,
  supplier_id INTEGER REFERENCES suppliers(id),
  source_contract TEXT,
  confidence TEXT,
  -- 谁改的价：报价单里的采购价要能追到出处，和 insertItem 的手工留痕同源
  changed_by TEXT,
  changed_at TEXT NOT NULL
);

-- 合同
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  file_type TEXT,
  source_path TEXT,
  column_report TEXT,
  terms TEXT,
  parse_method TEXT DEFAULT 'rules',
  ai_rejected INTEGER DEFAULT 0,
  processed_at TEXT NOT NULL,
  rows_matched INTEGER DEFAULT 0,
  rows_new INTEGER DEFAULT 0,
  status TEXT,
  notes TEXT
);

-- 产品图片
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT,
  is_primary INTEGER DEFAULT 0,
  group_id INTEGER REFERENCES product_groups(id),
  created_at TEXT NOT NULL
);

/* 小推车：产品页里挑出来的货号暂存区，出报价单前的中转台。
   全局唯一一份（不按用户分车）—— 这是当前口径，改成分人分车要同时动前端。 */
CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  qty INTEGER,
  note TEXT,
  sort INTEGER DEFAULT 0,
  added_at TEXT NOT NULL
);

/* ---------------------------------------------------------------------------
 * 二进制存储：图片与合同原件存进库，不摊在磁盘上。
 * 单独成表而不是给 product_images / contracts 加 BLOB 列 —— 那两张表都用
 * SELECT * 查，把二进制挂在同一行会让每次列表查询都把整张图读进内存。
 * --------------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS product_image_files (
  image_id INTEGER PRIMARY KEY REFERENCES product_images(id),
  bytes BLOB NOT NULL,
  size INTEGER,
  stored_at TEXT
);

CREATE TABLE IF NOT EXISTS contract_files (
  contract_id INTEGER PRIMARY KEY REFERENCES contracts(id),
  filename TEXT,
  mime TEXT,
  size INTEGER,
  sha256 TEXT,
  bytes BLOB NOT NULL,
  stored_at TEXT
);

-- ================== 客户管理（CRM） ==================

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  company_en TEXT,
  country TEXT,
  industry TEXT,
  website TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  rating TEXT,
  status TEXT DEFAULT 'active',
  /* 开发结果：pending 未成交 / won 已成交 / lost 已流失（新客开发页按此分栏） */
  deal_status TEXT DEFAULT 'pending',
  /* 归属：谁建的归谁，默认只有归属人看得见；创建人主动丢进公海才对同组织开放 */
  owner_id INTEGER REFERENCES users(id),
  /* created_by 单独记「谁建的」—— 公海被领取后 owner_id 会换人，创建人这一笔仍要留痕 */
  created_by INTEGER REFERENCES users(id),
  org_id INTEGER REFERENCES organizations(id),
  /* pool_status：owned 名下有主 / public 已丢入公海（同组织可见、可领取） */
  pool_status TEXT DEFAULT 'owned',
  pool_at TEXT,
  pool_note TEXT,
  source TEXT,
  tags TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  last_contact_at TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  name_en TEXT,
  position TEXT,
  department TEXT,
  email TEXT,
  phone TEXT,
  whatsapp TEXT,
  wechat TEXT,
  is_primary INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- 商机
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  title TEXT NOT NULL,
  amount REAL,
  currency TEXT DEFAULT 'USD',
  stage TEXT NOT NULL,
  probability INTEGER,
  expected_close_date TEXT,
  actual_close_date TEXT,
  products TEXT,
  owner_id INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'open',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- 跟进活动
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  deal_id INTEGER REFERENCES deals(id),
  order_id INTEGER REFERENCES orders(id),
  activity_type TEXT NOT NULL,
  subject TEXT,
  content TEXT,
  files TEXT,
  next_action TEXT,
  next_action_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- 待办事项
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'pending',
  list TEXT NOT NULL DEFAULT 'schedule',
  customer_id INTEGER REFERENCES customers(id),
  deal_id INTEGER REFERENCES deals(id),
  order_id INTEGER REFERENCES orders(id),
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

-- ================== 订单管理 ==================

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date TEXT NOT NULL,
  delivery_date TEXT,
  payment_terms TEXT,
  total_amount REAL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'draft',
  owner_id INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  sku TEXT NOT NULL,
  product_name TEXT,
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  total_price REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  notes TEXT,
  created_at TEXT NOT NULL
);

-- ================== 客户报价单 ==================

CREATE TABLE IF NOT EXISTS customer_quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  quote_date TEXT NOT NULL,
  valid_until TEXT,
  currency TEXT DEFAULT 'USD',
  -- 条款结构化字段：payment_terms / delivery_terms 仍保留可读文本，供老页面直接展示
  pi_no TEXT,
  payment_method TEXT,
  deposit_percent REAL,
  balance_percent REAL,
  delivery_method TEXT,
  delivery_port TEXT,
  validity_days INTEGER,
  payment_terms TEXT,
  delivery_terms TEXT,
  status TEXT DEFAULT 'draft',
  notes TEXT,
  -- 系统备注：只给内部看，报价单对外不显示
  internal_notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES customer_quotations(id),
  sku TEXT NOT NULL,
  product_name TEXT,
  product_name_en TEXT,
  spec TEXT,
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  total_price REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  -- 成本口径快照：报价单发出去之后，供应商再调价也不能让这张单的历史毛利变样
  purchase_price REAL,
  exchange_rate REAL,
  markup_rate REAL,
  notes TEXT,
  created_at TEXT NOT NULL
);

-- ================== 自动获客（新客开发） ==================

CREATE TABLE IF NOT EXISTS prospect_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  product_keywords TEXT,
  countries TEXT,
  customer_types TEXT,
  exclude_keywords TEXT,
  sources TEXT,
  result_limit INTEGER DEFAULT 100,
  status TEXT DEFAULT 'draft',
  owner_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS prospect_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES prospect_runs(id),
  company TEXT NOT NULL,
  website TEXT,
  country TEXT,
  business TEXT,
  contact TEXT,
  email TEXT,
  phone TEXT,
  description TEXT,
  icp_score INTEGER,
  confidence INTEGER,
  source TEXT,
  source_url TEXT,
  status TEXT DEFAULT 'new',
  owner_id INTEGER REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id),
  created_at TEXT NOT NULL
);

-- ================== 系统管理 ==================

-- 组织（团队）：产品/客户的归属单位，「同组织的人均可参考」以它为边界。
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  /* role = 权限角色（董事长 / 总经理 / 销售经理 / 销售业务员 …），也是「角色 → 权限组」映射的键 */
  role TEXT DEFAULT 'user',
  /* position = 对外展示的职位称谓，纯文字，与角色解耦 */
  position TEXT,
  phone TEXT,
  address TEXT,
  avatar TEXT,
  org_id INTEGER REFERENCES organizations(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  last_login_at TEXT,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

-- 权限组：一套命名的权限范围。角色被指派进某个组，即获得该组的全部权限点。
CREATE TABLE IF NOT EXISTS permission_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- 权限组 → 权限点（permission_key 由后端 PERMISSIONS 清单定义）
CREATE TABLE IF NOT EXISTS permission_group_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES permission_groups(id),
  permission_key TEXT NOT NULL,
  UNIQUE (group_id, permission_key)
);

-- 角色 → 权限组（一个角色同时只属于一个组，改指派即换组）
CREATE TABLE IF NOT EXISTS role_permission_groups (
  role TEXT PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES permission_groups(id),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  username TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  user_agent TEXT,
  ok INTEGER NOT NULL DEFAULT 1
);

-- ================== 索引 ==================

CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_group ON products(group_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_tier_prices_sku ON tier_prices(sku);
CREATE INDEX IF NOT EXISTS idx_price_history_sku ON price_history(sku);
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(country);
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_deals_customer ON deals(customer_id);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(owner_id);
CREATE INDEX IF NOT EXISTS idx_activities_customer ON activities(customer_id);
CREATE INDEX IF NOT EXISTS idx_activities_deal ON activities(deal_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_quotations_customer ON customer_quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_prospect_leads_run ON prospect_leads(run_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

-- ================== 询盘与报价主链路 ==================
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  inquiry_date TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  currency TEXT DEFAULT 'USD',
  source TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS inquiry_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id),
  sku TEXT NOT NULL,
  product_name TEXT,
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_name TEXT,
  purchase_price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  exchange_rate REAL NOT NULL DEFAULT 1,
  markup_rate REAL NOT NULL DEFAULT 0,
  markup_factor REAL NOT NULL DEFAULT 1,
  exw REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  packaging_snapshot TEXT,
  product_snapshot TEXT,
  quoted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS follow_up_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  activity_type TEXT NOT NULL,
  content TEXT NOT NULL,
  next_action TEXT,
  next_action_date TEXT,
  contact_id INTEGER REFERENCES contacts(id),
  inquiry_id INTEGER REFERENCES inquiries(id),
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS product_packaging (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE REFERENCES products(sku),
  inner_pack_qty INTEGER,
  carton_qty INTEGER,
  carton_length REAL,
  carton_width REAL,
  carton_height REAL,
  carton_weight REAL,
  unit_length REAL,
  unit_width REAL,
  unit_height REAL,
  unit_weight REAL,
  packaging_material TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS contract_import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_no TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  file_count INTEGER NOT NULL DEFAULT 0,
  source_files TEXT,
  parse_method TEXT NOT NULL DEFAULT 'rules',
  rule_version TEXT NOT NULL DEFAULT 'mvp-v1',
  -- column_map：本次认列结果（字段 → 列号/表头/得分），出问题时唯一能自证的现场
  column_map TEXT,
  -- parse_source：这份结果是怎么来的 —— rules（字符规则）/ ai（模型解析）
  parse_source TEXT DEFAULT 'rules',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS contract_import_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES contract_import_jobs(id),
  filename TEXT NOT NULL,
  row_no INTEGER,
  raw_text TEXT,
  sku TEXT,
  product_name TEXT,
  spec TEXT,
  purchase_price REAL,
  currency TEXT,
  quantity INTEGER,
  moq INTEGER,
  status TEXT NOT NULL DEFAULT 'pending_review',
  review_note TEXT,
  parse_source TEXT DEFAULT 'rules',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  -- committed_at / product_sku：入库留痕 —— 什么时候进的库、进成了哪个货号
  -- （撞号时实际落库的是 -COPY2，光看 sku 列看不出来）
  committed_at TEXT,
  product_sku TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
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
