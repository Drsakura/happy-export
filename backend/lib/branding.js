/**
 * 系统标识与组织名称（单一事实来源）。
 *
 * 口径（Wayne 2026-09-15 定，别再改回去）：
 *   - **系统名是作者固定署名，不可修改**：登录页、顶栏、浏览器标题一律显示
 *     SYSTEM.name，且**不跟随组织名** —— 这套系统会被别人拿去部署，
 *     把牌子固定在作者名下是刻意保留的来源标识（引流）。
 *   - **组织名（公司名）可以改**：它只是业务字段，决定「同组织」的资源边界、
 *     以及权限组/用户下拉里的显示；改组织名**不会**影响界面上的系统名。
 *   - 之前那套 `settings['brand.name'] / brand.subtitle` 覆盖已作废，
 *     历史遗留的这两个键即使还在库里也不再被读取。
 */

const db = require('../db/db');

/** 系统标识：作者固定署名，界面一律用它；不读 settings，不跟随组织名 */
const SYSTEM = {
  name: 'happy出口通',
  subtitle: 'Ai Export System'
};

/** 第一个组织视为「主组织」：开箱数据只有一个，组织名以它为准 */
function primaryOrg() {
  try {
    return db.prepare('SELECT id, name, code, description FROM organizations ORDER BY id LIMIT 1').get() || null;
  } catch {
    return null;
  }
}

/**
 * 给前端用的标识信息。
 * 故意做得轻：登录页、顶栏、浏览器标题都会调它。
 * name / subtitle 恒为固定值；org_* 只是顺带给设置页展示「当前公司名」。
 */
function getBranding() {
  const org = primaryOrg();
  return {
    /* 界面牌子：固定 */
    name: SYSTEM.name,
    subtitle: SYSTEM.subtitle,
    /* 前端据此把「系统标识」渲染成只读、不提供输入框 */
    system_locked: true,
    /* 公司/组织名单独给出：设置页要能看见它当前是什么（这个是可改的） */
    org_name: org?.name || '',
    org_id: org?.id ?? null
  };
}

/** 改组织名（顺带把 code / 描述也支持了，组织与品牌设置页要用） */
function updateOrg(id, { name, code, description } = {}) {
  const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(Number(id));
  if (!row) throw Object.assign(new Error('组织不存在'), { statusCode: 400 });

  const nextName = name === undefined ? row.name : String(name || '').trim();
  if (!nextName) throw Object.assign(new Error('组织名称不能为空'), { statusCode: 400 });
  if (nextName.length > 40) throw Object.assign(new Error('组织名称不能超过 40 个字'), { statusCode: 400 });

  const clash = db.prepare('SELECT id FROM organizations WHERE name = ? AND id <> ?').get(nextName, row.id);
  if (clash) throw Object.assign(new Error('已存在同名组织'), { statusCode: 400 });

  db.prepare('UPDATE organizations SET name = ?, code = ?, description = ? WHERE id = ?').run(
    nextName,
    code === undefined ? row.code : (String(code || '').trim() || null),
    description === undefined ? row.description : (String(description || '').trim() || null),
    row.id
  );
  return db.prepare('SELECT id, name, code, description FROM organizations WHERE id = ?').get(row.id);
}

module.exports = { SYSTEM, getBranding, updateOrg, primaryOrg };
