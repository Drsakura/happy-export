import {
  FactoryIcon,
  PackageIcon,
  UsersIcon,
  TargetIcon,
  ClipboardIcon,
  QuoteIcon,
  ContractIcon,
  PurchaseIcon,
  InquiryIcon,
  CleanupIcon,
  GlobeIcon,
  ShieldIcon,
  ActivityIcon
} from './components/Icons'

/* 工作台独立置顶，不属于任何分组 */
export const HOME_PATH = '/'
export const HOME_LABEL = '工作台'

/**
 * 侧边栏分组配置。
 *
 * 顺序即业务发生顺序：询盘 → 报价 → PI，订单作为业务闭环的收口放在业务管理最后；
 * 采购单连同品类 / 供应商 / 合同导入统一归到「采购管理」组（2026-09-15 Wayne 调整）。
 * 每项带 permission：侧栏按当前用户权限组过滤，路由层做同样的守卫，两处同源。
 */
export const NAV_GROUPS = [
  {
    id: 'business',
    title: '业务管理',
    items: [
      { to: '/inquiries', label: '询盘管理', icon: InquiryIcon, permission: 'inquiry.view' },
      { to: '/quotes', label: '客户报价单管理', icon: QuoteIcon, permission: 'quote.view' },
      { to: '/pi-contracts', label: 'PI合同管理', icon: ContractIcon, permission: 'contract.view' },
      { to: '/orders', label: '订单管理', icon: ClipboardIcon, permission: 'order.view' }
    ]
  },
  {
    id: 'customer',
    title: '客户管理',
    items: [
      { to: '/customers', label: '我的客户', icon: UsersIcon, permission: 'customer.view' },
      { to: '/prospects', label: '新客开发', icon: TargetIcon, permission: 'prospect.view' },
      { to: '/customer-pool', label: '客户公海', icon: GlobeIcon, permission: 'pool.view' }
    ]
  },
  {
    id: 'procurement',
    title: '采购管理',
    items: [
      /* 采购单是采购侧的主单据，放在本组最前；下面三项是支撑它的品类 / 供应商 / 合同导入。
         2026-09-15 从「业务管理」组挪过来（Wayne：采购单管理放到采购管理目录下）。 */
      { to: '/purchase-orders', label: '采购单管理', icon: PurchaseIcon, permission: 'purchase.view' },
      { to: '/products', label: '产品管理', icon: PackageIcon, permission: 'product.view' },
      { to: '/suppliers', label: '供应商管理', icon: FactoryIcon, permission: 'supplier.view' },
      /* 合同清洗中心 = 合同导入与复核队列（上传 → 解析 → 待复核 → 通过/驳回） */
      { to: '/contract-cleanup', label: '合同清洗中心', icon: CleanupIcon, permission: 'cleanup.view' }
    ]
  },
  {
    id: 'system',
    title: '系统管理',
    items: [
      { to: '/users', label: '用户管理', icon: UsersIcon, permission: 'user.manage' },
      { to: '/permission-groups', label: '权限组管理', icon: ShieldIcon, permission: 'perm.manage' },
      /* 审计轨迹。Wayne 口径：只有系统管理员能看，故认 audit.view（该点只授予超级管理员组）。 */
      { to: '/logs', label: '系统日志', icon: ActivityIcon, permission: 'audit.view' }
    ]
  }
]

/* 路由 → 页面名（顶栏「已打开页面」标签用），由分组自动派生，避免两处维护 */
export const PAGE_LABELS = {
  [HOME_PATH]: HOME_LABEL,
  ...NAV_GROUPS.reduce((acc, group) => {
    group.items.forEach(item => { acc[item.to] = item.label })
    return acc
  }, {}),
  '/profile': '个人资料'
}

/* 路由 → 所需权限（路由守卫用）。个人资料页人人可进，故不在表内。 */
export const ROUTE_PERMISSIONS = {
  '/inquiries': 'inquiry.view',
  '/quotes': 'quote.view',
  '/quotes/new': 'quote.edit',
  '/pi-contracts': 'contract.view',
  '/purchase-orders': 'purchase.view',
  '/orders': 'order.view',
  '/customers': 'customer.view',
  '/prospects': 'prospect.view',
  '/customer-pool': 'pool.view',
  '/products': 'product.view',
  '/suppliers': 'supplier.view',
  '/contract-cleanup': 'cleanup.view',
  '/users': 'user.manage',
  '/permission-groups': 'perm.manage',
  '/logs': 'audit.view'
}
