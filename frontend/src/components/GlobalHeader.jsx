import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { BotIcon, ClockIcon, CloudDbIcon, PlusCircleIcon, SearchIcon } from './Icons'

function GlobalHeader({ onOpenAssistant }) {
  const [now, setNow] = useState(new Date())
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const searchRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

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
      <div className="global-header-brand"><span className="brand-mark" title="happy出口通"><CloudDbIcon size={28} /><span className="header-status-dot" /></span><div><strong>happy出口通</strong><span>EXPORT OPERATIONS CONSOLE</span></div></div>
      <div className={`global-search ${searchOpen ? 'is-open' : ''}`}>
        <SearchIcon size={17} />
        <input ref={searchRef} aria-label="搜索 everything" value={query} onFocus={() => setSearchOpen(true)} onChange={event => setQuery(event.target.value)} placeholder="搜索 everything" autoComplete="off" />
        <kbd>⌘ K</kbd>
        {searchOpen && query.trim() && <div className="global-search-results" role="listbox" aria-label="全局搜索结果">
          {searching ? <div className="global-search-status">正在检索系统业务数据…</div> : results.length ? results.map(result => <button key={`${result.type}-${result.id}`} role="option" onMouseDown={event => event.preventDefault()} onClick={() => selectResult(result)}><span className={`search-result-mark ${result.type}`}>{result.typeLabel}</span><span><strong>{result.title}</strong><small>{result.detail}</small></span></button>) : <div className="global-search-status">未找到匹配的数据</div>}
          <div className="global-search-footnote">已检索客户、供应商、产品、订单、商机、待办和活动记录</div>
        </div>}
      </div>
      <div className="global-header-actions"><div className="header-clock"><ClockIcon size={16} /><span>{dateLabel}</span><b>{timeLabel}</b></div><button className="quick-create-btn" title="快速新建"><PlusCircleIcon size={19} /><span>快速新建</span></button><button className="ai-entry-btn" onClick={onOpenAssistant} title="打开 AI 助手"><BotIcon size={19} /><span>AI 助手</span><i>β</i></button><button className="header-avatar" title="当前用户">W</button><button className="mobile-search-btn" onClick={() => { setSearchOpen(v => !v); window.setTimeout(() => searchRef.current?.focus(), 0) }} title="搜索"><SearchIcon size={18} /></button></div>
    </header>
  )
}

export default GlobalHeader
