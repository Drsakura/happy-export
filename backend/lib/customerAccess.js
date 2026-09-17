/**
 * 客户归属与可见性口径（唯一事实来源）。
 *
 * Wayne 2026-09-14 定的规矩：
 *   ① 客户有「所属」：谁建的归谁，默认只有归属人自己看得见；
 *   ② 创建人主动丢进公海（pool_status = 'public'）后，同组织成员都能看见、都能领取；
 *   ③ 其余情况只有拿到 `customer.view_all` 的最高级别管理账号能查看。
 *
 * 「能看」与「能改」是两档：
 *   公海里的客户同组织成员都能看见（不然没法判断值不值得领），
 *   但只有归属人或管理账号能改 —— 别人想改得先「领取」。
 *
 * ⚠️ 注意 req.user 是 users 表的原始行（attachUser 直接塞的是 sessionUser 的结果），
 *    上面**没有** permissions 字段，权限必须用 auth.permissionsOfRole(role) 现推。
 */
const auth = require('./auth');

/** 越过归属看全部客户的权限点 */
const VIEW_ALL = 'customer.view_all';

/** 是否属于「最高级别系统管理账号」 */
function seesAll(user) {
  if (!user || !user.role) return false;
  return auth.permissionsOfRole(user.role).includes(VIEW_ALL);
}

/**
 * 列表可见性 → 可直接拼进 WHERE 的条件数组 + 参数。
 *
 * scope:
 *   'mine' 我的客户（默认）—— owner_id = 我
 *   'all'  全部客户 —— 需 customer.view_all，无权限时退回 'mine' 而不是报错
 *   'pool' 客户公海 —— pool_status = 'public'，且限定本组织
 *
 * 调用方拼 SQL 时，customers 表必须别名为 **c**。
 */
function scopeFilter(user, scope = 'mine') {
  const conditions = [];
  const params = [];

  if (scope === 'pool') {
    conditions.push("c.pool_status = 'public'");
    if (user && user.org_id) {
      /* 公海是「组织（团队）」的资源，只放本组织的进来。
         存量没 org_id 的老数据不设门槛，免得刚升级就凭空少一批。 */
      conditions.push('(c.org_id IS NULL OR c.org_id = ?)');
      params.push(user.org_id);
    }
    return { conditions, params };
  }

  if (scope === 'all' && seesAll(user)) {
    return { conditions, params };
  }

  /* 「我的客户」= 归我 + 还没交出去。
     丢进公海后这条就从我的列表里移走，只留在「客户公海」——
     否则用户会疑惑「我都丢出去了怎么还在我这儿」。 */
  conditions.push('c.owner_id = ?');
  conditions.push("COALESCE(c.pool_status, 'owned') <> 'public'");
  params.push(user ? user.id : -1);
  return { conditions, params };
}

/** 公海是「组织（团队）」的资源：两边都记了组织且不一致，就是外人 */
function inSameOrg(user, customer) {
  const mine = user?.org_id;
  const theirs = customer?.org_id;
  /* 存量数据可能没组织，不设门槛 —— 与 scopeFilter 里 pool 的写法保持一致 */
  if (!mine || !theirs) return true;
  return Number(mine) === Number(theirs);
}

/** 能不能看这条客户（详情页、跟进时间线） */
function canView(user, customer) {
  if (!customer) return false;
  if (seesAll(user)) return true;
  if (user && Number(customer.owner_id) === Number(user.id)) return true;
  /* 公海客户同组织可见；别组织的公海客户连详情都不该看到 */
  if (customer.pool_status === 'public' && inSameOrg(user, customer)) return true;
  return false;
}

/** 能不能改这条客户（基本信息、联系人、跟进记录） */
function canEdit(user, customer) {
  if (!customer) return false;
  if (seesAll(user)) return true;
  return !!user && Number(customer.owner_id) === Number(user.id);
}

module.exports = { VIEW_ALL, seesAll, scopeFilter, inSameOrg, canView, canEdit };
