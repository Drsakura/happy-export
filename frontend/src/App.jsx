import React from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import Settings from './components/Settings'
import GlobalHeader from './components/GlobalHeader'
import AIAssistant from './components/AIAssistant'
import { readPreference } from './preferences'
import { AuthProvider, useAuth, hasPermission } from './auth'
import { loadBranding, useBranding, setPageTitle } from './branding'
import { NAV_GROUPS, ROUTE_PERMISSIONS, HOME_PATH, PAGE_LABELS } from './navigation'
import { getUnsavedGuard, isGuardDirty, clearUnsavedGuard } from './unsavedGuard'
import {
  DashboardIcon,
  ChevronDownIcon,
  TuneIcon,
  SunIcon,
  MoonStarsIcon,
  SidebarLayoutIcon
} from './components/Icons'

/* ---------------------------------------------------------------------------
 * 路由级代码分割
 *
 * 改造前：18 个页面全是静态 import，Vite 把整站打进一个 index.js（约 530 KB）。
 * 打开任何一页，浏览器都得先把整站的代码下载并解析完才看得到东西 ——
 * 本地感觉不出来，上云走公网就是一两秒白屏。
 *
 * 改成 React.lazy 后每页一个独立 chunk，首屏只加载当前页那一份。
 * 下面几个刻意保持静态 import，不拆，理由各自不同：
 *   · LoginPage    —— 未登录时它本身就是首屏，拆了反而多一次往返
 *   · GlobalHeader / Settings / AIAssistant —— 属于外壳，首屏就要用
 * --------------------------------------------------------------------------- */
const Dashboard = React.lazy(() => import('./pages/Dashboard'))
const ProductManagement = React.lazy(() => import('./pages/ProductManagement'))
const SupplierManagement = React.lazy(() => import('./pages/SupplierManagement'))
const CustomerManagement = React.lazy(() => import('./pages/CustomerManagement'))
const CustomerDetail = React.lazy(() => import('./pages/CustomerDetail'))
const InquiryManagement = React.lazy(() => import('./pages/InquiryManagement'))
const InquiryDetail = React.lazy(() => import('./pages/InquiryDetail'))
const ContractCleanup = React.lazy(() => import('./pages/ContractCleanup'))
const OrderManagement = React.lazy(() => import('./pages/OrderManagement'))
const ProspectManagement = React.lazy(() => import('./pages/ProspectManagement'))
const QuoteManagement = React.lazy(() => import('./pages/QuoteManagement'))
const QuoteEditor = React.lazy(() => import('./pages/QuoteEditor'))
const PiContractManagement = React.lazy(() => import('./pages/PiContractManagement'))
const PurchaseOrderManagement = React.lazy(() => import('./pages/PurchaseOrderManagement'))
const CustomerPool = React.lazy(() => import('./pages/CustomerPool'))
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'))
const UserManagement = React.lazy(() => import('./pages/UserManagement'))
const PermissionGroups = React.lazy(() => import('./pages/PermissionGroups'))
const SystemLogs = React.lazy(() => import('./pages/SystemLogs'))

/* -------------------------------------------------------------- 启动与兜底 */

function BootScreen() {
  const brand = useBranding()
  return (
    <div className="app-boot">
      <span className="app-boot-mark" />
      <p>正在载入 {brand.name}…</p>
    </div>
  )
}

/* 详情页路径不在导航表里，给它们一批前缀标题，免得浏览器标签只剩系统名 */
const DETAIL_TITLES = [
  ['/customers/', '客户详情'],
  ['/inquiries/', '询盘详情'],
  ['/products/', '产品详情'],
  ['/suppliers/', '供应商详情']
]

function pageTitleFor(pathname) {
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname]
  const hit = DETAIL_TITLES.find(([prefix]) => pathname.startsWith(prefix))
  return hit ? hit[1] : ''
}

/** 路由懒加载时的过渡态：不白屏，给一条顶部进度线 + 一句提示 */
function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <div className="route-fallback-bar" />
      <p>正在载入…</p>
    </div>
  )
}

function NoPermission() {
  return (
    <div className="page-container">
      <div className="panel">
        <div className="panel-title">无访问权限</div>
        <p className="muted-note">
          当前角色所属的权限组没有该模块的查看权限。请让管理员在「权限组管理」里把该角色指派到有权限的组。
        </p>
      </div>
    </div>
  )
}

/** 路由级权限守卫：与侧栏用的是同一份 ROUTE_PERMISSIONS，不会两处不一致 */
function Guarded({ permission, children }) {
  const { user } = useAuth()
  if (permission && !hasPermission(user, permission)) return <NoPermission />
  return children
}

/* -------------------------------------------------------------- 主外壳 */

function Shell({ theme, onThemeChange }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = React.useState(false)
  const [collapsedGroups, setCollapsedGroups] = React.useState([])
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [assistantOpen, setAssistantOpen] = React.useState(false)
  const [pendingNav, setPendingNav] = React.useState(null)
  const [guardBusy, setGuardBusy] = React.useState(false)
  const [reducedMotion, setReducedMotion] = React.useState(
    () => readPreference('tms-motion', ['full', 'reduced'], 'full') === 'reduced'
  )

  const closeSettings = React.useCallback(() => setSettingsOpen(false), [])
  const closeAssistant = React.useCallback(() => setAssistantOpen(false), [])

  React.useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full'
    try { localStorage.setItem('tms-motion', reducedMotion ? 'reduced' : 'full') } catch { /* Session-only. */ }
  }, [reducedMotion])

  /* 浏览器标签标题跟着当前页走 —— 页面组件内部也会设一次（同值），
     这里兜住那些没自己设标题的页面，避免标签一直停在上一页的名字。 */
  React.useEffect(() => {
    setPageTitle(pageTitleFor(location.pathname))
  }, [location.pathname])

  /* ------------------------------------------------------------------
     未保存改动拦截
     编辑页（个人资料）挂载时会在 unsavedGuard 里登记「我脏了吗 / 帮我存 / 帮我丢弃」。
     两道防线：
       1) 所有应用内跳转都走 guardedNavigate，跳之前先问一句；
       2) 浏览器后退/前进这类不走我们的导航，靠监听 location 变化把它弹回来。
     ------------------------------------------------------------------ */
  const guardedNavigate = React.useCallback((path) => {
    if (!path || path === location.pathname) return
    if (isGuardDirty()) { setPendingNav(path); return }
    navigate(path)
  }, [navigate, location.pathname])

  const lastPathRef = React.useRef(location.pathname)
  React.useEffect(() => {
    const previous = lastPathRef.current
    lastPathRef.current = location.pathname
    /* 只在「刚刚离开编辑页」且「它还有未保存改动」时弹回来 */
    if (previous === location.pathname || previous !== '/profile') return
    if (!isGuardDirty()) return
    setPendingNav(location.pathname)
    navigate('/profile', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  React.useEffect(() => {
    const handler = event => {
      if (!isGuardDirty()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const resolvePending = async (action) => {
    const target = pendingNav
    const guard = getUnsavedGuard()
    setPendingNav(null)
    if (action === 'cancel') return
    if (action === 'save') {
      setGuardBusy(true)
      try {
        await guard?.save()
      } catch {
        setGuardBusy(false)
        return
      }
      setGuardBusy(false)
    } else {
      guard?.discard()
    }
    clearUnsavedGuard()
    if (target) navigate(target)
  }

  const navClass = ({ isActive }) => `nav-item${isActive ? ' active' : ''}`
  /* 工作台额外带一个类，供「展开/收起导航按钮挂在它右侧」定位 */
  const homeNavClass = ({ isActive }) => `nav-item nav-item-home${isActive ? ' active' : ''}`

  const toggleGroup = React.useCallback((id) => {
    setCollapsedGroups(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id])
  }, [])

  /* 侧栏只显示当前权限组可见的菜单；整组都不可见就整组隐藏 */
  const visibleGroups = React.useMemo(
    () => NAV_GROUPS
      .map(group => ({ ...group, items: group.items.filter(item => hasPermission(user, item.permission)) }))
      .filter(group => group.items.length > 0),
    [user]
  )

  const guard = (path, element) => <Guarded permission={ROUTE_PERMISSIONS[path]}>{element}</Guarded>

  return (
    <div className="app-container">
      {/* 只有设置是模态；「小皮」是浮窗，不能再 inert 主界面，否则没法边聊边操作 */}
      <div className="app-shell" inert={settingsOpen ? "" : undefined}>
        {/* 顶栏横跨整宽，压在侧边栏之上 */}
        <GlobalHeader onOpenAssistant={() => setAssistantOpen(true)} onNavigate={guardedNavigate} />

        <div className="app-body">
          <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
            {/* 工作台置顶；展开/收起导航按钮挂在它右侧 */}
            <div className="sidebar-top">
              <NavLink aria-label="工作台" title="工作台" to="/" end className={homeNavClass}>
                <span className="icon"><DashboardIcon size={18} /></span>
                {!collapsed && <span>工作台</span>}
              </NavLink>
              <button
                onClick={() => setCollapsed(!collapsed)}
                className="collapse-btn"
                aria-label={collapsed ? '展开导航' : '收起导航'}
                title={collapsed ? '展开导航' : '收起导航'}
              >
                <SidebarLayoutIcon size={18} />
              </button>
            </div>

            <nav className="sidebar-nav">
              {visibleGroups.map(group => {
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
                        <NavLink
                          key={item.to}
                          aria-label={item.label}
                          title={item.label}
                          to={item.to}
                          className={navClass}
                          onClick={event => { event.preventDefault(); guardedNavigate(item.to) }}
                        >
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
              {/* 用户信息只在右上角 header 显示，此处不再重复；只留日夜切换与设置 */}
              <button
                className="theme-toggle-btn"
                onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
                title={theme === 'light' ? '切换至夜间模式' : '切换至日间模式'}
                aria-label={theme === 'light' ? '切换至夜间模式' : '切换至日间模式'}
              >
                {theme === 'light' ? <MoonStarsIcon size={20} /> : <SunIcon size={20} />}
              </button>
              <button className="settings-btn" onClick={() => setSettingsOpen(true)} title="设置" aria-label="设置">
                <TuneIcon size={18} />
              </button>
            </div>
          </aside>

          <main className="main-content">
            <div className="route-content">
            {/* 页面 chunk 加载期间显示过渡态，避免白屏 */}
            <React.Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inquiries" element={guard('/inquiries', <InquiryManagement />)} />
              <Route path="/inquiries/:id" element={guard('/inquiries', <InquiryDetail />)} />
              <Route path="/quotes" element={guard('/quotes', <QuoteManagement />)} />
              <Route path="/quotes/new" element={guard('/quotes/new', <QuoteEditor />)} />
              <Route path="/pi-contracts" element={guard('/pi-contracts', <PiContractManagement />)} />
              <Route path="/purchase-orders" element={guard('/purchase-orders', <PurchaseOrderManagement />)} />
              <Route path="/orders" element={guard('/orders', <OrderManagement />)} />
              <Route path="/products" element={guard('/products', <ProductManagement />)} />
              <Route path="/suppliers" element={guard('/suppliers', <SupplierManagement />)} />
              <Route path="/contract-cleanup" element={guard('/contract-cleanup', <ContractCleanup />)} />
              <Route path="/customers" element={guard('/customers', <CustomerManagement />)} />
              <Route path="/customers/:id" element={guard('/customers', <CustomerDetail />)} />
              <Route path="/prospects" element={guard('/prospects', <ProspectManagement />)} />
              <Route path="/customer-pool" element={guard('/customer-pool', <CustomerPool />)} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/users" element={guard('/users', <UserManagement />)} />
              <Route path="/permission-groups" element={guard('/permission-groups', <PermissionGroups />)} />
              <Route path="/logs" element={guard('/logs', <SystemLogs />)} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </React.Suspense>
            </div>
          </main>
        </div>
      </div>

      {/* 未保存改动的离开确认：保存并离开 / 放弃修改 / 取消 */}
      {pendingNav && (
        <div className="modal-overlay" onClick={() => resolvePending('cancel')}>
          <div className="modal-content modal-content-sm" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2>个人资料还没保存</h2>
            </div>
            <div className="modal-body">
              <p>你修改了个人资料但还没有保存。要保存后再离开吗？</p>
              <p className="muted-note">选「放弃修改」会丢掉刚才的改动，恢复成保存前的样子。</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => resolvePending('cancel')}>取消</button>
              <button type="button" className="btn btn-secondary" onClick={() => resolvePending('discard')}>放弃修改</button>
              <button type="button" className="btn btn-primary" onClick={() => resolvePending('save')} disabled={guardBusy}>
                {guardBusy ? '保存中…' : '保存并离开'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AIAssistant isOpen={assistantOpen} onClose={closeAssistant} />
      <Settings
        isOpen={settingsOpen}
        onClose={closeSettings}
        theme={theme}
        onThemeChange={onThemeChange}
        reducedMotion={reducedMotion}
        onReducedMotionChange={setReducedMotion}
      />
    </div>
  )
}

/* -------------------------------------------------------------- 分流 */

function AppRoutes({ theme, onThemeChange }) {
  const { user, loading } = useAuth()

  if (loading) return <BootScreen />
  if (!user) {
    /* 未登录时任何路径都落到登录页 */
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  return <Shell theme={theme} onThemeChange={onThemeChange} />
}

function App() {
  const [theme, setTheme] = React.useState(() => readPreference('tms-theme', ['dark', 'light'], 'dark'))

  /* 品牌信息（系统显示名/副标题）启动就拉一次：登录页与顶栏都要用，且改完要即时生效。
     它是公开接口，未登录也能拿到；失败就用兜底名，不影响进系统。 */
  React.useEffect(() => { loadBranding() }, [])

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    try { localStorage.setItem('tms-theme', theme) } catch { /* Session-only when storage is unavailable. */ }
  }, [theme])

  return (
    <AuthProvider>
      <Router>
        <AppRoutes theme={theme} onThemeChange={setTheme} />
      </Router>
    </AuthProvider>
  )
}

export default App
