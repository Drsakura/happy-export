import {
  FactoryIcon,
  PackageIcon,
  UsersIcon,
  TargetIcon,
  ClipboardIcon,
  DownloadIcon,
  QuoteIcon,
  ContractIcon,
  PurchaseIcon
} from './components/Icons'

/* 工作台独立置顶，不属于任何分组 */
export const HOME_PATH = '/'
export const HOME_LABEL = '工作台'

/* 侧边栏分组配置 */
export const NAV_GROUPS = [
  {
    id: 'business',
    title: '业务管理',
    items: [
      { to: '/quotes', label: '客户报价单管理', icon: QuoteIcon },
      { to: '/pi-contracts', label: 'PI合同管理', icon: ContractIcon },
      { to: '/purchase-orders', label: '采购单管理', icon: PurchaseIcon }
    ]
  },
  {
    id: 'customer',
    title: '客户管理',
    items: [
      { to: '/customers', label: '客户管理', icon: UsersIcon },
      { to: '/prospects', label: '新客开发', icon: TargetIcon },
      { to: '/orders', label: '订单管理', icon: ClipboardIcon }
    ]
  },
  {
    id: 'procurement',
    title: '采购管理',
    items: [
      { to: '/products', label: '产品管理', icon: PackageIcon },
      { to: '/suppliers', label: '供应商管理', icon: FactoryIcon },
      { to: '/procurement/import', label: '合同导入', icon: DownloadIcon }
    ]
  }
]

/* 路由 → 页面名（顶栏「已打开页面」标签用），由分组自动派生，避免两处维护 */
export const PAGE_LABELS = {
  [HOME_PATH]: HOME_LABEL,
  ...NAV_GROUPS.reduce((acc, group) => {
    group.items.forEach(item => { acc[item.to] = item.label })
    return acc
  }, {})
}
