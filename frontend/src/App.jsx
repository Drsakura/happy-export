import React from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import EmbeddedSku from './pages/EmbeddedSku'
import ProductManagement from './pages/ProductManagement'
import SupplierManagement from './pages/SupplierManagement'
import CustomerManagement from './pages/CustomerManagement'
import OrderManagement from './pages/OrderManagement'
import ProspectManagement from './pages/ProspectManagement'
import QuoteManagement from './pages/QuoteManagement'
import PiContractManagement from './pages/PiContractManagement'
import PurchaseOrderManagement from './pages/PurchaseOrderManagement'
import Settings from './components/Settings'
import GlobalHeader from './components/GlobalHeader'
import AIAssistant from './components/AIAssistant'
import { readPreference } from './preferences'
import {
  DashboardIcon,
  FactoryIcon,
  PackageIcon,
  UsersIcon,
  TargetIcon,
  ClipboardIcon,
  DownloadIcon,
  QuoteIcon,
  ContractIcon,
  PurchaseIcon,
  ChevronDownIcon,
  TuneIcon,
  SunIcon,
  MoonIcon,
  SidebarLayoutIcon
} from './components/Icons'

/* 侧边栏分组配置：工作台独立置顶，不归属任何分组 */
const NAV_GROUPS = [
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

function App() {
  const [collapsed, setCollapsed] = React.useState(false)
  const [collapsedGroups, setCollapsedGroups] = React.useState([])
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [assistantOpen, setAssistantOpen] = React.useState(false)
  const [theme, setTheme] = React.useState(() => readPreference('tms-theme', ['dark', 'light'], 'dark'))

  const [reducedMotion, setReducedMotion] = React.useState(() => readPreference('tms-motion', ['full', 'reduced'], 'full') === 'reduced')
  const closeSettings = React.useCallback(() => setSettingsOpen(false), [])
  const closeAssistant = React.useCallback(() => setAssistantOpen(false), [])

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try { localStorage.setItem('tms-theme', theme) } catch { /* Session-only when storage is unavailable. */ }
  }, [theme])

  React.useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full'
    try { localStorage.setItem('tms-motion', reducedMotion ? 'reduced' : 'full') } catch { /* Session-only. */ }
  }, [reducedMotion])

  const navClass = ({ isActive }) => `nav-item${isActive ? ' active' : ''}`

  const toggleGroup = React.useCallback((id) => {
    setCollapsedGroups(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id])
  }, [])

  return (
    <Router>
      <div className="app-container">
        <aside inert={settingsOpen || assistantOpen ? "" : undefined} className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <h1>{collapsed ? 'HET' : 'happy出口通'}</h1>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="collapse-btn"
              aria-label={collapsed ? '展开导航' : '收起导航'}
              title={collapsed ? '展开导航' : '收起导航'}
            >
              <SidebarLayoutIcon size={20} />
            </button>
          </div>

          <nav className="sidebar-nav">
            {/* 工作台：独立置顶，不属于任何分组 */}
            <NavLink aria-label="工作台" title="工作台" to="/" end className={navClass}>
              <span className="icon"><DashboardIcon size={18} /></span>
              {!collapsed && <span>工作台</span>}
            </NavLink>

            {NAV_GROUPS.map(group => {
              /* 侧栏整体收起时忽略分组的折叠状态，保证图标仍可点 */
              const open = collapsed || !collapsedGroups.includes(group.id)
              return (
                <div className="nav-group" key={group.id}>
                  <div className="nav-group-header">
                    <span className="nav-group-title">{group.title}</span>
                    {!collapsed && (
                      <button
                        type="button"
                        className={`nav-group-toggle${open ? ' open' : ''}`}
                        onClick={() => toggleGroup(group.id)}
                        aria-expanded={open}
                        aria-label={`${open ? '收起' : '展开'}${group.title}`}
                        title={`${open ? '收起' : '展开'}${group.title}`}
                      >
                        <ChevronDownIcon size={14} />
                      </button>
                    )}
                  </div>
                  {open && group.items.map(item => {
                    const ItemIcon = item.icon
                    return (
                      <NavLink key={item.to} aria-label={item.label} title={item.label} to={item.to} className={navClass}>
                        <span className="icon"><ItemIcon size={18} /></span>
                        {!collapsed && <span>{item.label}</span>}
                      </NavLink>
                    )
                  })}
                </div>
              )
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="user-info">管理员</div>
            <button
              className="theme-toggle-btn"
              onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')}
              title={theme === 'light' ? '切换至夜间模式' : '切换至日间模式'}
              aria-label={theme === 'light' ? '切换至夜间模式' : '切换至日间模式'}
            >
              {theme === 'light' ? <MoonIcon size={18} /> : <SunIcon size={18} />}
            </button>
            <button className="settings-btn" onClick={() => setSettingsOpen(true)} title="设置" aria-label="设置">
              <TuneIcon size={18} />
            </button>
          </div>
        </aside>

        <main inert={settingsOpen || assistantOpen ? "" : undefined} className="main-content">
          <GlobalHeader onOpenAssistant={() => setAssistantOpen(true)} />
          <div className="route-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/quotes" element={<QuoteManagement />} />
            <Route path="/pi-contracts" element={<PiContractManagement />} />
            <Route path="/purchase-orders" element={<PurchaseOrderManagement />} />
            <Route path="/products" element={<ProductManagement />} />
            <Route path="/suppliers" element={<SupplierManagement />} />
            <Route path="/procurement/import" element={<EmbeddedSku view="import" />} />
            <Route path="/customers" element={<CustomerManagement />} />
            <Route path="/orders" element={<OrderManagement />} />
            <Route path="/prospects" element={<ProspectManagement />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </div>
        </main>

        <AIAssistant isOpen={assistantOpen} onClose={closeAssistant} />
        <Settings isOpen={settingsOpen} onClose={closeSettings} theme={theme} onThemeChange={setTheme} reducedMotion={reducedMotion} onReducedMotionChange={setReducedMotion} />
      </div>
    </Router>
  )
}

export default App





