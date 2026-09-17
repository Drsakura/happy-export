import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  TargetIcon, RefreshIcon, UsersIcon, PlusCircleIcon, SearchIcon, ArrowLeftIcon
} from '../components/Icons'
import { SkeletonTableRows } from '../components/Skeleton'
import { setPageTitle } from '../branding'

const TABS = [
  { key: 'pending', label: '未成交', hint: '还在谈的客户' },
  { key: 'won', label: '已成交', hint: '已经下单的客户' },
  { key: 'lost', label: '已流失', hint: '明确放弃或长期无响应的客户' },
  { key: 'all', label: '全部', hint: '不分成败的所有开发客户' }
]

const DEAL_LABELS = { pending: '未成交', won: '已成交', lost: '已流失' }

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  return date.toLocaleDateString('zh-CN')
}

function ProspectManagement() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('pending')
  const [keyword, setKeyword] = useState('')
  const [items, setItems] = useState([])
  const [stats, setStats] = useState({ pending: 0, won: 0, lost: 0 })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/prospects', {
        params: { deal_status: tab === 'all' ? '' : tab, q: keyword.trim() }
      })
      setItems(data.items || [])
      setStats(data.stats || { pending: 0, won: 0, lost: 0 })
    } catch (error) {
      setNotice({ type: 'error', text: error?.response?.data?.error || '加载开发客户失败' })
    } finally {
      setLoading(false)
    }
  }, [tab, keyword])

  useEffect(() => {
    setPageTitle('新客开发')
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(load, keyword ? 260 : 0)
    return () => window.clearTimeout(timer)
  }, [load, keyword])

  /* 标记成交/流失：乐观更新 —— 先按新状态改界面（不匹配当前标签页的行直接消失、
     顶部计数同步增减），后台失败再把行和计数整体放回原状。 */
  const mark = async (item, dealStatus) => {
    setBusyId(item.id)
    const previous = item.deal_status
    const index = items.findIndex(row => row.id === item.id)
    const nextStats = { ...stats }
    if (previous && nextStats[previous] !== undefined) {
      nextStats[previous] = Math.max(0, (nextStats[previous] || 0) - 1)
    }
    nextStats[dealStatus] = (nextStats[dealStatus] || 0) + 1
    setStats(nextStats)
    if (tab !== 'all' && dealStatus !== tab) {
      setItems(prev => prev.filter(row => row.id !== item.id))
    } else {
      setItems(prev => prev.map(row => (row.id === item.id ? { ...row, deal_status: dealStatus } : row)))
    }
    setNotice({ type: 'ok', text: `「${item.company}」已标记为${DEAL_LABELS[dealStatus]}` })
    try {
      await axios.patch(`/api/prospects/${item.id}`, { deal_status: dealStatus })
    } catch (error) {
      setStats(stats)
      setItems(prev => {
        if (prev.some(row => row.id === item.id)) return prev.map(row => (row.id === item.id ? item : row))
        const next = [...prev]
        next.splice(Math.min(Math.max(index, 0), next.length), 0, item)
        return next
      })
      setNotice({ type: 'error', text: error?.response?.data?.error || '标记失败，已恢复原状态' })
    } finally {
      setBusyId(null)
    }
  }

  const openCreate = () => navigate('/customers')

  return (
    <div className="page-container prospect-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">新客开发</h1>
          <p className="page-subtitle">
            上半部分是自动获客线索池（待上线）；下半部分管理开发结果 —— 谈成的进「已成交」，谈不动的进「已流失」，其余留在「未成交」继续跟。
            和「我的客户」同一份数据、同一套归属：只显示你自己名下的客户。
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={openCreate}>
          <PlusCircleIcon size={15} /> 手工新增客户
        </button>
      </div>

      {/* ---------------- 自动获客（线索池，待上线） ---------------- */}
      <section className="panel">
        <div className="panel-title"><TargetIcon size={15} /> 自动获客线索池</div>
        <div className="prospect-pool-note">
          <p>
            线索池将按「产品关键词 + 目标国家 + 客户类型」从公开数据源（GLEIF、Companies House、搜索引擎）批量抓取，
            再由 AI 做去重与意向评分，合格线索一键转成客户。
          </p>
          <span className="pill pill-warn">待上线</span>
        </div>
      </section>

      {/* ---------------- 开发结果管理 ---------------- */}
      <section className="panel">
        <div className="panel-title"><UsersIcon size={15} /> 开发结果管理</div>

        <div className="prospect-stats">
          <button type="button" className={`prospect-stat${tab === 'pending' ? ' active' : ''}`} onClick={() => setTab('pending')}>
            <b>{stats.pending}</b>
            <span>未成交</span>
          </button>
          <button type="button" className={`prospect-stat${tab === 'won' ? ' active' : ''}`} onClick={() => setTab('won')}>
            <b className="is-won">{stats.won}</b>
            <span>已成交</span>
          </button>
          <button type="button" className={`prospect-stat${tab === 'lost' ? ' active' : ''}`} onClick={() => setTab('lost')}>
            <b className="is-lost">{stats.lost}</b>
            <span>已流失</span>
          </button>
        </div>

        <div className="prospect-toolbar">
          <div className="prospect-tabs" role="tablist">
            {TABS.map(item => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={`prospect-tab${tab === item.key ? ' active' : ''}`}
                title={item.hint}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="prospect-search">
            <SearchIcon size={14} />
            <input
              type="text"
              value={keyword}
              onChange={event => setKeyword(event.target.value)}
              placeholder="搜索公司 / 国家 / 邮箱"
              aria-label="搜索开发客户"
            />
          </label>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            <RefreshIcon size={14} /> 刷新
          </button>
        </div>

        {notice && <p className={`profile-notice ${notice.type}`}>{notice.text}</p>}

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>公司</th>
                <th>国家</th>
                <th className="num">联系人</th>
                <th className="num">报价单</th>
                <th>最后跟进</th>
                <th>成交状态</th>
                <th className="num">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRows rows={5} widths={[2.2, 0.8, 0.6, 0.6, 1, 1, 1.4]} />
              ) : items.length === 0 ? (
                <tr><td colSpan="7" className="empty-state">
                  {keyword ? '没有匹配的客户' : `「${TABS.find(item => item.key === tab)?.label}」下暂无客户`}
                </td></tr>
              ) : items.map(item => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.company}</strong>
                    {item.company_en ? <div className="muted-note">{item.company_en}</div> : null}
                  </td>
                  <td>{item.country || '—'}</td>
                  <td className="num">{item.contact_count || 0}</td>
                  <td className="num">{item.quote_count || 0}</td>
                  <td>{formatDate(item.last_follow_at)}</td>
                  <td>
                    <span className={`pill ${item.deal_status === 'won' ? 'pill-ok' : item.deal_status === 'lost' ? 'pill-danger' : 'pill-mute'}`}>
                      {DEAL_LABELS[item.deal_status] || '未成交'}
                    </span>
                  </td>
                  <td className="num">
                    <div className="prospect-actions">
                      {item.deal_status !== 'won' && (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === item.id} onClick={() => mark(item, 'won')}>
                          标记成交
                        </button>
                      )}
                      {item.deal_status !== 'lost' && (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === item.id} onClick={() => mark(item, 'lost')}>
                          标记流失
                        </button>
                      )}
                      {item.deal_status !== 'pending' && (
                        <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === item.id} onClick={() => mark(item, 'pending')}>
                          退回跟进
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/customers/${item.id}`)}>
                        <ArrowLeftIcon size={13} /> 查看
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default ProspectManagement
