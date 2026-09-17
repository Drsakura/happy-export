/**
 * 系统权限点清单（单一事实来源）。
 *
 * 设计口径（Wayne 2026-09-14 定）：
 *   - 「角色」是职位显示（董事长 / 总经理 / 销售经理 / 销售业务员 …），本身不带权限；
 *   - 权限全部收敛到「权限组」：一个组勾选一批权限点（即下面的 key）；
 *   - 把角色指派进某个组（role_permission_groups），该角色下的所有用户即获得这组权限。
 *
 * 命名约定：`模块.动作`。前端菜单过滤、路由守卫、后端 requirePermission 都用同一批 key。
 */

const PERMISSIONS = [
  /* 工作台 */
  { key: 'dashboard.view', label: '查看工作台', group: '工作台' },

  /* 业务管理 */
  { key: 'inquiry.view', label: '查看询盘管理', group: '业务管理' },
  { key: 'inquiry.edit', label: '编辑询盘管理', group: '业务管理' },
  { key: 'quote.view', label: '查看客户报价单', group: '业务管理' },
  { key: 'quote.edit', label: '编辑客户报价单', group: '业务管理' },
  { key: 'contract.view', label: '查看 PI 合同', group: '业务管理' },
  { key: 'contract.edit', label: '编辑 PI 合同', group: '业务管理' },
  { key: 'purchase.view', label: '查看采购单', group: '业务管理' },
  { key: 'purchase.edit', label: '编辑采购单', group: '业务管理' },
  { key: 'order.view', label: '查看订单管理', group: '业务管理' },
  { key: 'order.edit', label: '编辑订单管理', group: '业务管理' },

  /* 客户管理 */
  { key: 'customer.view', label: '查看我的客户', group: '客户管理' },
  { key: 'customer.edit', label: '编辑我的客户', group: '客户管理' },
  /* 客户默认「谁建的谁看得见」，丢进公海才对同组织开放。
     拿到这个点才越过归属看全部客户 —— 按 Wayne 的口径只给最高级别的系统管理组。 */
  { key: 'customer.view_all', label: '查看全部客户（含他人归属）', group: '客户管理' },
  { key: 'prospect.view', label: '新客开发', group: '客户管理' },
  { key: 'pool.view', label: '客户公海', group: '客户管理' },
  { key: 'pool.claim', label: '客户公海领取', group: '客户管理' },

  /* 采购管理 */
  { key: 'product.view', label: '查看产品管理', group: '采购管理' },
  { key: 'product.edit', label: '编辑产品管理', group: '采购管理' },
  { key: 'supplier.view', label: '查看供应商管理', group: '采购管理' },
  { key: 'supplier.edit', label: '编辑供应商管理', group: '采购管理' },
  { key: 'cleanup.view', label: '合同清洗中心', group: '采购管理' },

  /* 系统管理 */
  { key: 'org.manage', label: '组织管理', group: '系统管理' },
  /* 组织与品牌（改公司名 / 组织代码 / 描述）单独成点，与「组织管理」解耦 ——
     Wayne 2026-09-15 的口径：这块**只允许高管改**，所以它得能单独勾给「公司高管」组，
     而不是搭在系统管理权限上。前端设置页分类、PATCH /api/organizations/:id 与
     PUT /api/branding 都认这一个点。 */
  { key: 'branding.manage', label: '组织与品牌（公司信息）', group: '系统管理' },
  { key: 'user.manage', label: '用户管理', group: '系统管理' },
  { key: 'perm.manage', label: '权限组管理', group: '系统管理' },
  { key: 'ai.manage', label: '智能配置（大模型接入与用途分配）', group: '系统管理' },
  { key: 'audit.view', label: '审计日志', group: '系统管理' }
]

const PERMISSION_KEYS = PERMISSIONS.map(item => item.key)

/* 角色清单：Wayne 列举的四个业务角色 + 系统管理员。权限组管理页的「角色指派」用它做候选。 */
const ROLES = [
  { value: 'admin', label: '系统管理员' },
  { value: 'chairman', label: '董事长' },
  { value: 'general_manager', label: '总经理' },
  { value: 'sales_manager', label: '销售经理' },
  { value: 'sales_rep', label: '销售业务员' }
]

/* 开箱默认权限组。仅在首次建库/首次运行时写入，之后以库里的为准。 */
const DEFAULT_PERMISSION_GROUPS = [
  {
    name: '超级管理员组',
    description: '全部权限，含组织、用户与权限组管理',
    is_system: 1,
    permissions: PERMISSION_KEYS,
    /* 只挂 admin。董事长 / 总经理改走下面的「公司高管」组 ——
       一个角色同时只能属于一个组（role_permission_groups.role 是主键），
       让他们留在超管组就等于「高管 = 系统管理员」，与 Wayne 2026-09-15 的分权口径冲突。 */
    roles: ['admin']
  },
  {
    name: '销售管理组',
    description: '业务全流程可读可写，可维护客户、产品与供应商，无系统管理权限',
    is_system: 0,
    /* 注意：`customer.view_all` 必须显式排除 —— 它不含 .manage 后缀，
       否则会被这个过滤器顺带带上，销售经理就能看到全公司的客户了。
       `branding.manage` 反过来说：它**靠** .manage 后缀被自动排除，
       销售经理永远拿不到改公司信息的权限（Wayne 口径：只有高管能改）。 */
    permissions: PERMISSION_KEYS.filter(key =>
      !key.endsWith('.manage') && key !== 'audit.view' && key !== 'customer.view_all'),
    roles: ['sales_manager']
  },
  {
    name: '销售业务组',
    description: '基础业务操作：维护自己名下的客户与询盘报价，产品只读',
    is_system: 0,
    permissions: [
      'dashboard.view',
      'inquiry.view', 'inquiry.edit',
      'quote.view', 'quote.edit',
      'contract.view',
      'purchase.view',
      'order.view',
      'customer.view', 'customer.edit',
      'prospect.view', 'pool.view', 'pool.claim',
      'product.view', 'supplier.view', 'cleanup.view'
    ],
    roles: ['sales_rep']
  },
  {
    name: '公司高管',
    description: '董事长 / 总经理：除用户、权限组、智能配置与系统日志外的全部权限，含改公司信息',
    is_system: 0,
    /* 与线上库（2026-09-15）一致：全量权限里摘掉四个「系统管理员专属」的点。
       user.manage / perm.manage 是账号治理权，ai.manage 会看到所有模型密钥，
       audit.view 能看到全公司的操作轨迹 —— Wayne 口径是「系统日志仅系统管理员可见」。 */
    permissions: PERMISSION_KEYS.filter(key =>
      !['user.manage', 'perm.manage', 'ai.manage', 'audit.view'].includes(key)),
    roles: ['chairman', 'general_manager']
  }
]

module.exports = { PERMISSIONS, PERMISSION_KEYS, ROLES, DEFAULT_PERMISSION_GROUPS }
