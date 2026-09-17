/**
 * 鉴权与会话（多用户阶段）。
 *
 * 设计取舍：
 *   - 密码哈希沿用 db.js 建默认管理员时的格式 `scrypt$salt$hash`，不引第三方依赖
 *     （本机没有 bcrypt，也不想去碰原生模块编译），Node 内置 crypto.scryptSync 足够。
 *   - 会话复用已有的 sessions 表，浏览器侧只放一个 HttpOnly cookie（happy_sid），
 *     不把用户信息塞进 token，避免改资料后前端还拿着旧值。
 *   - 权限一律「角色 → 权限组 → 权限点」三级推导，用户表不直接存权限。
 */
const crypto = require('crypto');
const db = require('../db/db');
const { PERMISSION_KEYS } = require('./permissions');

const COOKIE_NAME = 'happy_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

/* ---------------------------------------------------------------- 密码 */

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(plain, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  let actual;
  try {
    actual = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ---------------------------------------------------------------- cookie */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const piece of String(header).split(';')) {
    const index = piece.indexOf('=');
    if (index < 0) continue;
    const key = piece.slice(0, index).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(piece.slice(index + 1).trim());
    } catch {
      out[key] = piece.slice(index + 1).trim();
    }
  }
  return out;
}

function setSessionCookie(res, id, maxAgeMs = SESSION_TTL_MS) {
  res.append('Set-Cookie', [
    `${COOKIE_NAME}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ].join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function clientIp(req) {
  const raw = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '';
  return String(raw).split(',')[0].trim().replace(/^::ffff:/, '') || null;
}

/* ---------------------------------------------------------------- 会话 */

function createSession(userId, req) {
  const now = new Date();
  const id = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, userId, now.toISOString(), now.toISOString(),
    new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    String(req?.headers?.['user-agent'] || '').slice(0, 200), clientIp(req)
  );
  /* 顺手清掉这把用户的过期会话，避免 sessions 表无限增长 */
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(userId, now.toISOString());
  return id;
}

function destroySession(sessionId) {
  if (sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/** 从请求里解出当前用户（含 session id），未登录返回 null */
function sessionUser(req) {
  const sessionId = parseCookies(req?.headers?.cookie)[COOKIE_NAME];
  if (!sessionId) return null;
  const row = db.prepare(`
    SELECT u.*, s.id AS sid, s.expires_at AS session_expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(sessionId);
  if (!row) return null;
  if (new Date(row.session_expires_at).getTime() < Date.now()) {
    destroySession(sessionId);
    return null;
  }
  if (!row.is_active) return null;
  return row;
}

function touchSession(sessionId) {
  /* 每小时落一次 last_seen_at 就够，避免每个请求都写库 */
  try {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?')
      .run(new Date().toISOString(), sessionId, new Date(Date.now() - 3600 * 1000).toISOString());
  } catch { /* 非关键路径 */ }
}

/* ---------------------------------------------------------------- 权限 */

function permissionsOfRole(role) {
  if (!role) return [];
  if (role === 'admin') return PERMISSION_KEYS.slice();
  return db.prepare(`
    SELECT p.permission_key AS key
    FROM role_permission_groups r
    JOIN permission_group_permissions p ON p.group_id = r.group_id
    WHERE r.role = ?
  `).all(role).map(row => row.key);
}

function permissionGroupOfRole(role) {
  if (!role) return null;
  return db.prepare(`
    SELECT g.id, g.name, g.description
    FROM role_permission_groups r JOIN permission_groups g ON g.id = r.group_id
    WHERE r.role = ?
  `).get(role) || null;
}

/** 输出给前端的用户对象：绝不带 password_hash */
function publicUser(row) {
  if (!row) return null;
  const org = row.org_id
    ? db.prepare('SELECT id, name, code FROM organizations WHERE id = ?').get(row.org_id)
    : null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    email: row.email || '',
    role: row.role || '',
    position: row.position || '',
    phone: row.phone || '',
    address: row.address || '',
    avatar: row.avatar || '',
    is_active: !!row.is_active,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    org: org || null,
    permission_group: permissionGroupOfRole(row.role),
    permissions: permissionsOfRole(row.role)
  };
}

/* ---------------------------------------------------------------- 中间件 */

function attachUser(req, res, next) {
  const user = sessionUser(req);
  req.user = user;
  if (user) touchSession(user.sid);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  next();
}

function requirePermission(key) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    const granted = req.user.role === 'admin' || permissionsOfRole(req.user.role).includes(key);
    if (!granted) return res.status(403).json({ error: '当前账号没有该操作权限' });
    next();
  };
}

/* ---------------------------------------------------------------- 审计 */

function audit({ username, action, detail, req, ok = 1 }) {
  try {
    db.prepare(`INSERT INTO audit_log (at, username, action, detail, ip, user_agent, ok)
                VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      new Date().toISOString(), username || null, action, detail || null,
      clientIp(req), String(req?.headers?.['user-agent'] || '').slice(0, 200), ok ? 1 : 0
    );
  } catch { /* 审计是旁路，失败不能影响业务 */ }
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  MAX_FAILED,
  LOCK_MS,
  hashPassword,
  verifyPassword,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  clientIp,
  createSession,
  destroySession,
  sessionUser,
  permissionsOfRole,
  permissionGroupOfRole,
  publicUser,
  attachUser,
  requireAuth,
  requirePermission,
  audit
};
