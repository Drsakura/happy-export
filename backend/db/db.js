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

// 性能优化
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

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

module.exports = db;
