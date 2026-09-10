import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { BotIcon, ClockIcon, CloudDbIcon, PlusCircleIcon, SearchIcon } from './Icons'
import { HOME_PATH, PAGE_LABELS } from '../navigation'

const TABS_STORAGE_KEY = 'happy.openTabs'
const MAX_TABS = 10

/* 从本地缓存读取上次打开的页面（只保留仍然存在的路由，工作台恒定在首位） */
function readStoredTabs() {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_STORAGE_KEY) || '[]')
    const list = Array.isArray(raw) ? raw.filter(path => PAGE_LABELS[path]) : []
    return [HOME_PATH, ...list.filter(path => path !== HOME_PATH)]
  } catch { return [HOME_PATH] }
}

function GlobalHeader({ onOpenAssistant }) {
  const [now, setNow] = useState(new Date())
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [openTabs, setOpenTabs] = useState(readStoredTabs)
  const searchRef = useRef(null)
  const tabsRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  /* 访问过的页面自动登记成标签：工作台恒在首位，其余按最近使用排序，新页插在第二位 */
  useEffect(() => {
    const path = location.pathname
    if (!PAGE_LABELS[path]) return
    setOpenTabs(current => {
      if (current[0] === path) return current
      if (current[1] === path) return current
      const rest = current.filter(item => item !== path && item !== HOME_PATH)
      return [HOME_PATH, path, ...rest].slice(0, MAX_TABS)
    })
  }, [location.pathname])

  useEffect(() => {
    try { localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(openTabs)) } catch { /* 存储不可用时仅本次会话有效 */ }
    const active = tabsRef.current?.querySelector('.page-tab.active')
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [openTabs, location.pathname])

  /* 关闭标签：关掉的若是当前页，就退到剩下的最近一个，没有则回工作台 */
  const closeTab = (event, path) => {
    event.stopPropagation()
    const next = openTabs.filter(item => item !== path)
    const result = next.length ? next : [HOME_PATH]
    setOpenTabs(result)
    if (path === location.pathname) navigate(result[0])
  }

  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) { setResults([]); setSearching(false); return }
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const response = await axios.get('/api/search', { params: { q: keyword } })
        setResults(response.data.results || [])
      } catch { setResults([]) } finally { setSearching(false) }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const onKeyDown = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
        window.setTimeout(() => searchRef.current?.focus(), 0)
      }
      if (event.key === 'Escape') { setSearchOpen(false); searchRef.current?.blur() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const timeLabel = useMemo(() => now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), [now])
  const dateLabel = useMemo(() => now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }), [now])
  const selectResult = result => { navigate(result.path); setQuery(''); setSearchOpen(false) }

  return (
    <header className="global-header">
      <div className="global-header-brand"><span className="brand-mark" title="happy出口通"><CloudDbIcon size={36} /><span className="header-status-dot" /></span><div><strong>happy出口通</strong><span>EXPORT OPERATIONS CONSOLE</span></div></div>
      <div className={`global-search ${searchOpen ? 'is-open' : ''}`}>
        <SearchIcon size={17} />
        <input ref={searchRef} aria-label="搜索 everything" value={query} onFocus={() => setSearchOpen(true)} onChange={event => setQuery(event.target.value)} placeholder="搜索 everything" autoComplete="off" />
        <kbd>⌘ K</kbd>
        {searchOpen && query.trim() && <div className="global-search-results" role="listbox" aria-label="全局搜索结果">
          {searching ? <div className="global-search-status">正在检索系统业务数据…</div> : results.length ? results.map(result => <button key={`${result.type}-${result.id}`} role="option" onMouseDown={event => event.preventDefault()} onClick={() => selectResult(result)}><span className={`search-result-mark ${result.type}`}>{result.typeLabel}</span><span><strong>{result.title}</strong><small>{result.detail}</small></span></button>) : <div className="global-search-status">未找到匹配的数据</div>}
          <div className="global-search-footnote">已检索客户、供应商、产品、订单、商机、待办和活动记录</div>
        </div>}
      </div>
      {/* 已打开页面：搜索框后的快速跳转标签，工作台常驻且不可关闭 */}
      <nav className="page-tabs" ref={tabsRef} aria-label="已打开页面">
        {openTabs.map(path => {
          const label = PAGE_LABELS[path] || path
          const isHome = path === HOME_PATH
          const active = location.pathname === path
          return (
            <div key={path} className={`page-tab${active ? ' active' : ''}`}>
              <button type="button" className="page-tab-label" title={label} aria-current={active ? 'page' : undefined} onClick={() => navigate(path)}>{label}</button>
              {!isHome && <button type="button" className="page-tab-close" aria-label={`关闭${label}`} title={`关闭${label}`} onClick={event => closeTab(event, path)}>×</button>}
            </div>
          )
        })}
      </nav>
      <div className="global-header-actions"><div className="header-clock"><ClockIcon size={16} /><span>{dateLabel}</span><b>{timeLabel}</b></div><button className="quick-create-btn" title="快速新建"><PlusCircleIcon size={19} /><span>快速新建</span></button><button className="ai-entry-btn" onClick={onOpenAssistant} title="打开 AI 助手"><BotIcon size={19} /><span>AI 助手</span><i>β</i></button><button className="header-avatar" title="当前用户">W</button><button className="mobile-search-btn" onClick={() => { setSearchOpen(v => !v); window.setTimeout(() => searchRef.current?.focus(), 0) }} title="搜索"><SearchIcon size={18} /></button></div>
    </header>
  )
}

export default GlobalHeader
