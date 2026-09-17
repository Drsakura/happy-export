/**
 * 账号与个人资料。
 * 挂载点：/api（路由内部自带 /auth/* 与 /me* 前缀）
 *
 * 免登录白名单在 server.js 的 /api 登录门里声明（health / auth\/ / system\/），
 * 所以这里 /auth/login、/auth/logout、/auth/me 都可以在没有会话时访问。
 */
const express = require('express');
const db = require('../db/db');
const auth = require('../lib/auth');
const { ROLES } = require('../lib/permissions');

const router = express.Router();
const ROLE_VALUES = ROLES.map(item => item.value);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
function fail(res, error) {
  const message = error?.message || '请求处理失败';
  const status = error?.statusCode
    || (/必须|不能为空|不正确|不存在|不一致|格式|至少|已停用|已锁定/.test(message) ? 400 : 500);
  res.status(status).json({ error: message });
}

/* ------------------------------------------------------------ 登录相关 */

/** POST /api/auth/login */
router.post('/auth/login', (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username) throw badRequest('请输入用户名');
    if (!password) throw badRequest('请输入密码');

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      auth.audit({ username, action: 'login_failed', detail: '用户名不存在', req, ok: 0 });
      throw badRequest('用户名或密码不正确');
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000));
      auth.audit({ username, action: 'login_blocked', detail: '账号锁定中', req, ok: 0 });
      throw badRequest(`账号已锁定，请 ${minutes} 分钟后再试`);
    }
    if (!user.is_active) {
      auth.audit({ username, action: 'login_blocked', detail: '账号已停用', req, ok: 0 });
      throw badRequest('账号已停用，请联系管理员');
    }
    if (!auth.verifyPassword(password, user.password_hash)) {
      const failed = Number(user.failed_count || 0) + 1;
      const lockedUntil = failed >= auth.MAX_FAILED
        ? new Date(Date.now() + auth.LOCK_MS).toISOString()
        : null;
      db.prepare('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?').run(failed, lockedUntil, user.id);
      auth.audit({ username, action: 'login_failed', detail: `密码错误（第 ${failed} 次）`, req, ok: 0 });
      throw badRequest(lockedUntil
        ? `密码连续错误 ${failed} 次，账号已锁定 15 分钟`
        : '用户名或密码不正确');
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET failed_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now, user.id);
    const sessionId = auth.createSession(user.id, req);
    auth.setSessionCookie(res, sessionId);
    auth.audit({ username: user.username, action: 'login', detail: '登录成功', req });
    res.json({ user: auth.publicUser({ ...user, last_login_at: now }) });
  } catch (error) {
    fail(res, error);
  }
});

/** POST /api/auth/logout */
router.post('/auth/logout', (req, res) => {
  try {
    if (req.user) {
      auth.destroySession(req.user.sid);
      auth.audit({ username: req.user.username, action: 'logout', detail: '退出登录', req });
    }
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    fail(res, error);
  }
});

/** GET /api/auth/me —— 前端启动时用它判断是否已登录 */
router.get('/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  res.json({ user: auth.publicUser(req.user) });
});

/* ------------------------------------------------------------ 个人资料 */

const PROFILE_TEXT_FIELDS = [
  ['display_name', '显示名'],
  ['email', '联系邮箱'],
  ['phone', '电话'],
  ['address', '地址'],
  ['position', '职位'],
  ['avatar', '头像']
];

/** PATCH /api/me —— 保存个人资料 */
router.patch('/me', (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    const fields = [];
    const values = [];

    for (const [key, label] of PROFILE_TEXT_FIELDS) {
      if (req.body?.[key] === undefined) continue;
      const value = String(req.body[key] ?? '').trim();
      if (key === 'display_name' && !value) throw badRequest('显示名不能为空');
      if (key === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw badRequest('联系邮箱格式不正确');
      }
      fields.push(`${key} = ?`);
      values.push(value || null);
    }

    if (req.body?.role !== undefined) {
      const role = String(req.body.role || '').trim();
      if (!ROLE_VALUES.includes(role)) throw badRequest('角色取值不在允许范围内');
      fields.push('role = ?');
      values.push(role);
    }
    if (req.body?.org_id !== undefined) {
      const orgId = Number(req.body.org_id);
      if (!Number.isInteger(orgId) || !db.prepare('SELECT id FROM organizations WHERE id = ?').get(orgId)) {
        throw badRequest('所属组织不存在');
      }
      fields.push('org_id = ?');
      values.push(orgId);
    }

    if (!fields.length) throw badRequest('没有需要保存的内容');
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(req.user.id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    auth.audit({ username: updated.username, action: 'profile_update', detail: '更新个人资料', req });
    res.json({ user: auth.publicUser(updated), message: '个人资料已保存' });
  } catch (error) {
    fail(res, error);
  }
});

/** PATCH /api/me/password —— 改密码：三段校验全过才落库 */
router.patch('/me/password', (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    const current = String(req.body?.current_password || '');
    const next = String(req.body?.new_password || '');
    const confirm = String(req.body?.confirm_password || '');

    if (!current) throw badRequest('请输入当前密码');
    if (!next) throw badRequest('请输入新密码');
    if (next.length < 6) throw badRequest('新密码至少 6 位');
    if (next !== confirm) throw badRequest('两次输入的新密码不一致');
    if (next === current) throw badRequest('新密码不能与当前密码相同');
    if (!auth.verifyPassword(current, req.user.password_hash)) {
      auth.audit({ username: req.user.username, action: 'password_change_failed', detail: '当前密码不正确', req, ok: 0 });
      throw badRequest('当前密码不正确');
    }

    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(auth.hashPassword(next), new Date().toISOString(), req.user.id);
    /* 保住当前会话，踢掉其它设备上已登录的会话 */
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.user.sid);
    auth.audit({ username: req.user.username, action: 'password_change', detail: '修改密码成功', req });
    res.json({ ok: true, message: '密码已修改' });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
