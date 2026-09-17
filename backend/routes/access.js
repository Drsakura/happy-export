/**
 * 组织与权限组（多用户阶段的权限中枢）。
 * 挂载点：/api
 *
 * 口径（Wayne 2026-09-14 定）：
 *   - 角色只是职位标签，本身不带权限；
 *   - 权限组 = 一批权限点；把角色指派进某个组，该角色下所有用户即获得这组权限。
 * 所以「角色 → 组」是唯一的授权入口，permission_group_permissions 是唯一的权限范围来源。
 */
const express = require('express');
const db = require('../db/db');
const auth = require('../lib/auth');
const branding = require('../lib/branding');
const { PERMISSIONS, PERMISSION_KEYS, ROLES } = require('../lib/permissions');

const router = express.Router();
const ROLE_VALUES = ROLES.map(item => item.value);
const KEY_SET = new Set(PERMISSION_KEYS);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
function fail(res, error) {
  const message = error?.message || '请求处理失败';
  const status = error?.statusCode
    || (/必须|不能为空|不存在|无效|格式|已存在|不可|请先/.test(message) ? 400 : 500);
  res.status(status).json({ error: message });
}

/** 校验并归一化权限点数组 */
function normalizePermissions(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw badRequest('权限范围格式不正确');
  const list = [...new Set(input.map(key => String(key).trim()).filter(Boolean))];
  const unknown = list.filter(key => !KEY_SET.has(key));
  if (unknown.length) throw badRequest(`未知的权限点：${unknown.join('、')}`);
  return list;
}

/** 校验并归一化角色数组 */
function normalizeRoles(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw badRequest('角色指派格式不正确');
  const list = [...new Set(input.map(role => String(role).trim()).filter(Boolean))];
  const unknown = list.filter(role => !ROLE_VALUES.includes(role));
  if (unknown.length) throw badRequest(`未知的角色：${unknown.join('、')}`);
  return list;
}

function groupDetail(row) {
  const permissions = db.prepare('SELECT permission_key FROM permission_group_permissions WHERE group_id = ?')
    .all(row.id).map(item => item.permission_key);
  const roles = db.prepare('SELECT role FROM role_permission_groups WHERE group_id = ?')
    .all(row.id).map(item => item.role);
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    is_system: !!row.is_system,
    permissions,
    roles,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/** 写入某个组的权限范围（整组替换） */
function replacePermissions(groupId, permissions) {
  db.prepare('DELETE FROM permission_group_permissions WHERE group_id = ?').run(groupId);
  const insert = db.prepare('INSERT OR IGNORE INTO permission_group_permissions (group_id, permission_key) VALUES (?, ?)');
  for (const key of permissions) insert.run(groupId, key);
}

/**
 * 写入某个组的角色指派。
 * 先把原本指向本组、但不在新名单里的角色解绑（role 表主键唯一，只能改指处），
 * 再把新名单里的角色指到本组。
 */
function replaceRoles(groupId, roles, nowIso) {
  const current = db.prepare('SELECT role FROM role_permission_groups WHERE group_id = ?').all(groupId).map(row => row.role);
  const keep = new Set(roles);
  for (const role of current) {
    if (!keep.has(role)) db.prepare('DELETE FROM role_permission_groups WHERE role = ?').run(role);
  }
  const assign = db.prepare('INSERT OR REPLACE INTO role_permission_groups (role, group_id, updated_at) VALUES (?, ?, ?)');
  for (const role of roles) assign.run(role, groupId, nowIso);
}

/* ------------------------------------------------------------ 权限清单 */

/** GET /api/permissions —— 权限点清单 + 可选角色（权限组管理页的左栏） */
router.get('/permissions', auth.requireAuth, (req, res) => {
  try {
    const groups = [];
    for (const item of PERMISSIONS) {
      let bucket = groups.find(group => group.title === item.group);
      if (!bucket) { bucket = { title: item.group, items: [] }; groups.push(bucket); }
      bucket.items.push({ key: item.key, label: item.label });
    }
    res.json({ permissions: PERMISSIONS, groups, roles: ROLES });
  } catch (error) {
    fail(res, error);
  }
});

/** GET /api/roles —— 角色与各自所在的权限组（指派一览） */
router.get('/roles', auth.requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT r.role, r.group_id, g.name AS group_name
      FROM role_permission_groups r JOIN permission_groups g ON g.id = r.group_id
    `).all();
    const map = new Map(rows.map(row => [row.role, row]));
    res.json({
      roles: ROLES.map(item => ({
        ...item,
        group_id: map.get(item.value)?.group_id || null,
        group_name: map.get(item.value)?.group_name || null
      }))
    });
  } catch (error) {
    fail(res, error);
  }
});

/* ------------------------------------------------------------ 权限组 */

router.get('/permission-groups', auth.requirePermission('perm.manage'), (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM permission_groups ORDER BY is_system DESC, id ASC').all();
    res.json({ groups: rows.map(groupDetail) });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/permission-groups', auth.requirePermission('perm.manage'), (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw badRequest('权限组名称不能为空');
    if (db.prepare('SELECT id FROM permission_groups WHERE name = ?').get(name)) throw badRequest('该权限组名称已存在');
    const permissions = normalizePermissions(req.body?.permissions) || [];
    const roles = normalizeRoles(req.body?.roles) || [];

    const now = new Date().toISOString();
    const result = db.prepare('INSERT INTO permission_groups (name, description, is_system, created_at) VALUES (?, ?, 0, ?)')
      .run(name, String(req.body?.description || '').trim() || null, now);
    replacePermissions(result.lastInsertRowid, permissions);
    replaceRoles(result.lastInsertRowid, roles, now);

    auth.audit({ username: req.user.username, action: 'permission_group_create', detail: `新建权限组「${name}」`, req });
    const row = db.prepare('SELECT * FROM permission_groups WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ group: groupDetail(row), message: '权限组已创建' });
  } catch (error) {
    fail(res, error);
  }
});

router.patch('/permission-groups/:id', auth.requirePermission('perm.manage'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM permission_groups WHERE id = ?').get(id);
    if (!row) throw badRequest('权限组不存在');

    const now = new Date().toISOString();
    const fields = [];
    const values = [];
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || '').trim();
      if (!name) throw badRequest('权限组名称不能为空');
      const clash = db.prepare('SELECT id FROM permission_groups WHERE name = ? AND id != ?').get(name, id);
      if (clash) throw badRequest('该权限组名称已存在');
      fields.push('name = ?'); values.push(name);
    }
    if (req.body?.description !== undefined) {
      fields.push('description = ?'); values.push(String(req.body.description || '').trim() || null);
    }
    if (fields.length) {
      fields.push('updated_at = ?'); values.push(now); values.push(id);
      db.prepare(`UPDATE permission_groups SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    const permissions = normalizePermissions(req.body?.permissions);
    if (permissions) replacePermissions(id, permissions);
    const roles = normalizeRoles(req.body?.roles);
    if (roles) replaceRoles(id, roles, now);

    auth.audit({ username: req.user.username, action: 'permission_group_update', detail: `更新权限组「${row.name}」`, req });
    const updated = db.prepare('SELECT * FROM permission_groups WHERE id = ?').get(id);
    res.json({ group: groupDetail(updated), message: '权限组已保存' });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/permission-groups/:id', auth.requirePermission('perm.manage'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM permission_groups WHERE id = ?').get(id);
    if (!row) throw badRequest('权限组不存在');
    if (row.is_system) throw badRequest('系统内置权限组不可删除');
    const occupied = db.prepare('SELECT COUNT(*) AS c FROM role_permission_groups WHERE group_id = ?').get(id).c;
    if (occupied > 0) throw badRequest('该权限组下仍指派有角色，请先把角色改派到其它组');

    db.prepare('DELETE FROM permission_group_permissions WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM permission_groups WHERE id = ?').run(id);
    auth.audit({ username: req.user.username, action: 'permission_group_delete', detail: `删除权限组「${row.name}」`, req });
    res.json({ ok: true, message: '权限组已删除' });
  } catch (error) {
    fail(res, error);
  }
});

/* ------------------------------------------------------------ 组织 */

router.get('/organizations', auth.requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT o.*, (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) AS member_count
      FROM organizations o ORDER BY o.id ASC
    `).all();
    res.json({ organizations: rows });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/organizations', auth.requirePermission('org.manage'), (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw badRequest('组织名称不能为空');
    if (db.prepare('SELECT id FROM organizations WHERE name = ?').get(name)) throw badRequest('该组织名称已存在');
    const now = new Date().toISOString();
    const result = db.prepare('INSERT INTO organizations (name, code, description, created_at) VALUES (?, ?, ?, ?)')
      .run(name, String(req.body?.code || '').trim() || null, String(req.body?.description || '').trim() || null, now);
    auth.audit({ username: req.user.username, action: 'organization_create', detail: `新建组织「${name}」`, req });
    res.status(201).json({ organization: db.prepare('SELECT * FROM organizations WHERE id = ?').get(result.lastInsertRowid) });
  } catch (error) {
    fail(res, error);
  }
});

/* ------------------------------------------------------------ 组织改名与系统标识 */

/**
 * PATCH /api/organizations/:id —— 改组织名/代码/描述（branding.manage）
 * 组织名 = 部署方自己的公司名，可自由改；它只作业务字段用（资源边界 + 下拉显示），
 * **不会**影响界面上的系统名（系统名固定，见 lib/branding.js）。
 *
 * ⚠️ 权限点从 `org.manage` 换成 `branding.manage`（Wayne 2026-09-15）：
 * 这块**只允许高管改**，所以拆成独立权限点，只勾给「公司高管」组 + 超级管理员组，
 * 销售经理/业务员永远拿不到。
 */
router.patch('/organizations/:id', auth.requirePermission('branding.manage'), (req, res) => {
  try {
    const before = db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(Number(req.params.id));
    if (!before) throw badRequest('组织不存在');
    const organization = branding.updateOrg(req.params.id, req.body || {});
    auth.audit({
      username: req.user.username,
      action: 'organization_update',
      detail: `组织「${before.name}」→「${organization.name}」`,
      req
    });
    res.json({ organization });
  } catch (error) {
    fail(res, error);
  }
});

/** GET /api/branding —— 当前系统标识 + 公司名（登录即可读，设置页要用） */
router.get('/branding', auth.requireAuth, (req, res) => {
  try {
    res.json(branding.getBranding());
  } catch (error) {
    fail(res, error);
  }
});

/**
 * PUT /api/branding —— 已停用：系统名是作者固定署名，任何角色都改不了。
 * 保留这条路由是为了给调用方一个明确的 403 说明，而不是含糊的 404。
 * 想换公司门面的，请改组织名（PATCH /api/organizations/:id）。
 */
router.put('/branding', auth.requirePermission('branding.manage'), (req, res) => {
  res.status(403).json({
    error: `「${branding.SYSTEM.name}」是作者固定署名，不可修改；如需换成贵公司的名字，请修改组织名称。`
  });
});

/* ------------------------------------------------------------ 用户 */

/** 用户行 → 输出对象（绝不带 password_hash），附带角色/权限组/组织的可读名 */
function userDetail(row) {
  const roleMeta = ROLES.find(item => item.value === row.role);
  const group = db.prepare(`
    SELECT g.id, g.name FROM role_permission_groups r
    JOIN permission_groups g ON g.id = r.group_id WHERE r.role = ?
  `).get(row.role || '') || null;
  const org = row.org_id
    ? db.prepare('SELECT id, name, code FROM organizations WHERE id = ?').get(row.org_id)
    : null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    email: row.email || '',
    phone: row.phone || '',
    role: row.role || '',
    role_label: roleMeta?.label || row.role || '—',
    position: row.position || '',
    org_id: row.org_id || null,
    org_name: org?.name || '',
    permission_group_name: group?.name || '',
    is_active: !!row.is_active,
    created_at: row.created_at,
    last_login_at: row.last_login_at
  };
}

function normalizeRole(value) {
  const role = String(value || '').trim();
  if (!ROLE_VALUES.includes(role)) throw badRequest(`角色不正确（可选：${ROLE_VALUES.join('、')}）`);
  return role;
}

function normalizeOrgId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(id);
  if (!org) throw badRequest('所属组织不存在');
  return id;
}

/** GET /api/users —— 用户列表（user.manage） */
router.get('/users', auth.requirePermission('user.manage'), (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM users ORDER BY id ASC').all();
    res.json({ users: rows.map(userDetail) });
  } catch (error) {
    fail(res, error);
  }
});

/** POST /api/users —— 新建用户（user.manage） */
router.post('/users', auth.requirePermission('user.manage'), (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    if (!username) throw badRequest('登录账号不能为空');
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(username)) {
      throw badRequest('账号只能是 2–32 位字母 / 数字 / 下划线 / 点 / 横线');
    }
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw badRequest('该账号已存在');
    const password = String(req.body?.password || '');
    if (password.length < 6) throw badRequest('密码至少 6 位');
    const role = normalizeRole(req.body?.role);
    const orgId = normalizeOrgId(req.body?.org_id);

    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, email, phone, role, position, org_id, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      username,
      auth.hashPassword(password),
      String(req.body?.display_name || '').trim() || null,
      String(req.body?.email || '').trim() || null,
      String(req.body?.phone || '').trim() || null,
      role,
      String(req.body?.position || '').trim() || null,
      orgId,
      now
    );
    auth.audit({ username: req.user.username, action: 'user_create', detail: `新建用户「${username}」（${role}）`, req });
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ user: userDetail(row), message: '用户已创建' });
  } catch (error) {
    fail(res, error);
  }
});

/** PATCH /api/users/:id —— 编辑用户 / 重置密码 / 停用（user.manage） */
router.patch('/users/:id', auth.requirePermission('user.manage'), (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw badRequest('用户不存在');

    const body = req.body || {};
    const isSelf = row.id === req.user.id;

    /* 自己的账号：不许改角色（防止把自己锁在门外）、不许停用 */
    if (isSelf && body.role !== undefined && String(body.role) !== row.role) {
      throw badRequest('不能修改自己的角色');
    }
    if (isSelf && body.is_active !== undefined && !body.is_active) {
      throw badRequest('不能停用自己的账号');
    }

    const fields = [];
    const values = [];
    if (body.display_name !== undefined) {
      fields.push('display_name = ?'); values.push(String(body.display_name || '').trim() || null);
    }
    if (body.email !== undefined) {
      fields.push('email = ?'); values.push(String(body.email || '').trim() || null);
    }
    if (body.phone !== undefined) {
      fields.push('phone = ?'); values.push(String(body.phone || '').trim() || null);
    }
    if (body.position !== undefined) {
      fields.push('position = ?'); values.push(String(body.position || '').trim() || null);
    }
    if (body.org_id !== undefined) {
      fields.push('org_id = ?'); values.push(normalizeOrgId(body.org_id));
    }
    if (body.role !== undefined) {
      const role = normalizeRole(body.role);
      if (row.role === 'admin' && role !== 'admin') {
        /* 防止把最后一个系统管理员改成普通角色 */
        const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1").get().c;
        if (adminCount <= 1) throw badRequest('系统至少要保留一名可用的系统管理员');
      }
      fields.push('role = ?'); values.push(role);
    }
    if (body.is_active !== undefined) {
      fields.push('is_active = ?'); values.push(body.is_active ? 1 : 0);
    }
    if (body.password !== undefined) {
      const password = String(body.password || '');
      if (password.length < 6) throw badRequest('密码至少 6 位');
      fields.push('password_hash = ?'); values.push(auth.hashPassword(password));
      fields.push('failed_count = ?'); values.push(0);
      fields.push('locked_until = ?'); values.push(null);
    }

    if (!fields.length) throw badRequest('没有要更新的内容');
    const now = new Date().toISOString();
    fields.push('updated_at = ?'); values.push(now); values.push(id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    /* 改密/停用后踢掉该用户除当前会话外的所有会话（当前管理员自己的会话只在做自改密码时保留） */
    if (body.password !== undefined || body.is_active === false) {
      const keep = isSelf ? req.user.sid : null;
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(id, keep || '');
    }

    const summary = [
      body.password !== undefined ? '重置密码' : null,
      body.is_active !== undefined ? (body.is_active ? '启用' : '停用') : null,
      body.role !== undefined && String(body.role) !== row.role ? `角色改为 ${body.role}` : null
    ].filter(Boolean).join('、') || '更新资料';
    auth.audit({ username: req.user.username, action: 'user_update', detail: `${summary}：「${row.username}」`, req });

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.json({ user: userDetail(updated), message: '用户已保存' });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
