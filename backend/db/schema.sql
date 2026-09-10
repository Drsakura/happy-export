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
  owner_id INTEGER REFERENCES users(id),
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
  payment_terms TEXT,
  delivery_terms TEXT,
  status TEXT DEFAULT 'draft',
  notes TEXT,
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

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  role TEXT DEFAULT 'user',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
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
