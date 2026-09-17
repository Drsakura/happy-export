import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { ActivityIcon, DownloadIcon, RefreshIcon, SearchIcon, ClockIcon, ShieldIcon } from '../components/Icons'
import { setPageTitle } from '../branding'

/* ---------------------------------------------------------------------------
   系统日志（审计轨迹）—— 侧栏「系统管理」下的独立页面。
   参考 GoodJob 的系统日志页：四格统计 + 等级/分类筛选 + 搜索 + 导出 + 列表 + 展开详情。
   数据源 GET /api/logs（后端按 action 前缀归分类、按 ok 归等级）。
   入口与路由都认 audit.view —— 按 Wayne 的口径，仅系统管理员可见。
--------------------------------------------------------------------------- */

const LEVELS = [
  { key: '', label: '全部' },
  { key: 'info', label: '信息' },
  { key: 'success', label: '成功' },
  { key: 'warning', label: '警告' },
  { key: 'error', label: '错误' }
]

const PAGE_SIZE = 50

function fmtTime(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(value)
  }
}

function SystemLogs() {
  const [level, setLevel] = useState('')
  const [category, setCategory] = useState('')
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  const alive = useRef(true)

  useEffect(() => { setPageTitle('系统日志') }, [])

  /* 搜索框防抖，避免每敲一个字打一次接口 */
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(keyword.trim()); setOffset(0) }, 300)
    return () => clearTimeout(timer)
  }, [keyword])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: payload } = await axios.get('/api/logs', {
        params: { level: level || undefined, category: category || undefined, q: search || undefined, limit: PAGE_SIZE, offset }
      })
      if (!alive.current) return
      setData(payload)
    } catch (e) {
      if (alive.current) setError(e?.response?.data?.error || e.message)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [level, category, search, offset])

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { load() }, [load])

  const items = data?.items || []
  const stats = data?.stats || { total: 0, today: 0, warning: 0, error: 0 }
  const total = data?.total || 0

  const rangeText = useMemo(() => {
    if (!total) return '暂无记录'
    const from = offset + 1
    const to = Math.min(offset + PAGE_SIZE, total)
    return `第 ${from}–${to} 条 / 共 ${total} 条`
  }, [offset, total])

  const exportCsv = async () => {
    setExporting(true)
    setError('')
    try {
      const response = await axios.get('/api/logs/export', {
        params: { level: level || undefined, category: category || undefined, q: search || undefined },
        responseType: 'blob'
      })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `system-logs-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e?.response?.data?.error || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page-container logs-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">系统日志</h1>
          <p className="page-subtitle">
            账号登录与核心业务操作的审计轨迹，用于追溯与排障。仅系统管理员可见。
            {total > 0 && ` 共 ${total} 条记录。`}
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshIcon size={14} /> {loading ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="btn btn-primary" onClick={exportCsv} disabled={exporting || !total}>
            <DownloadIcon size={14} /> {exporting ? '导出中…' : '导出 CSV'}
          </button>
        </div>
      </div>

      <div className="log-stats">
        <div className="log-stat">
          <b>{stats.total}</b>
          <span>记录</span>
        </div>
        <div className="log-stat">
          <b>{stats.today}</b>
          <span>今日</span>
        </div>
        <div className="log-stat is-warn">
          <b>{stats.warning}</b>
          <span>警告</span>
        </div>
        <div className="log-stat is-err">
          <b>{stats.error}</b>
          <span>错误</span>
        </div>
      </div>

      <div className="panel">
        <div className="log-toolbar">
          <div className="log-chips" role="tablist" aria-label="按等级筛选">
            {LEVELS.map(item => (
              <button
                key={item.key || 'all'}
                type="button"
                role="tab"
                aria-selected={level === item.key}
                className={`log-chip ${level === item.key ? 'is-active' : ''} ${item.key ? 'is-' + item.key : ''}`}
                onClick={() => { setLevel(item.key); setOffset(0) }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="log-toolbar">
          <div className="log-chips" role="tablist" aria-label="按分类筛选">
            <button
              type="button"
              role="tab"
              aria-selected={category === ''}
              className={`log-chip ${category === '' ? 'is-active' : ''}`}
              onClick={() => { setCategory(''); setOffset(0) }}
            >
              全部
            </button>
            {(data?.categories || []).map(item => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={category === item.key}
                className={`log-chip ${category === item.key ? 'is-active' : ''}`}
                onClick={() => { setCategory(item.key); setOffset(0) }}
              >
                {item.label}<small>{item.count}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="log-actions">
          <label className="log-search">
            <SearchIcon size={15} />
            <input
              type="search"
              value={keyword}
              placeholder="搜索操作人 / 动作 / 说明 / IP"
              onChange={e => setKeyword(e.target.value)}
            />
          </label>
        </div>

        {error && <p className="log-error"><ShieldIcon size={14} /> {error}</p>}

        {!loading && !items.length && (
          <div className="log-empty">
            <ActivityIcon size={22} />
            <strong>暂无日志记录</strong>
            <small>登录系统或改动用户、权限、客户、商机与模型接入时，操作会自动记录到这里。</small>
          </div>
        )}

        {!!items.length && (
          <ul className="log-list">
            {items.map(row => (
              <li key={row.id} className={`log-row is-${row.level}`}>
                <button
                  type="button"
                  className="log-row-main"
                  aria-expanded={openId === row.id}
                  onClick={() => setOpenId(openId === row.id ? null : row.id)}
                >
                  <span className={`log-dot is-${row.level}`} aria-hidden="true" />
                  <span className="log-time"><ClockIcon size={12} />{fmtTime(row.at)}</span>
                  <span className={`log-badge is-${row.level}`}>{row.ok ? '' : '失败 · '}{row.action_label}</span>
                  <span className="log-detail">{row.detail || '—'}</span>
                  <span className="log-actor">{row.username || '—'}</span>
                  <span className="log-cat">{row.category}</span>
                </button>
                {openId === row.id && (
                  <dl className="log-more">
                    <div><dt>动作标识</dt><dd>{row.action}</dd></div>
                    <div><dt>操作人</dt><dd>{row.username || '—'}</dd></div>
                    <div><dt>来源 IP</dt><dd>{row.ip || '—'}</dd></div>
                    <div><dt>结果</dt><dd>{row.ok ? '成功' : '失败'}</dd></div>
                    <div className="full"><dt>说明</dt><dd>{row.detail || '—'}</dd></div>
                    <div className="full"><dt>User-Agent</dt><dd>{row.user_agent || '—'}</dd></div>
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}

        {(total > PAGE_SIZE || offset > 0) && (
          <div className="log-pager">
            <span>{rangeText}</span>
            <div>
              <button type="button" className="btn btn-secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}>上一页</button>
              <button type="button" className="btn btn-secondary" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default SystemLogs
