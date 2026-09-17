import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { InquiryIcon, PlusCircleIcon, SearchIcon, RefreshIcon, UsersIcon } from '../components/Icons'
import { SkeletonTableRows } from '../components/Skeleton'
import { useAuth, hasPermission } from '../auth'

const STATUS_LABELS = {
  draft: '草稿',
  quoting: '报价中',
  quoted: '已报价',
  won: '已成交',
  lost: '已流失',
  closed: '已关闭'
}
const STATUS_TONE = {
  draft: 'mute',
  quoting: 'warn',
  quoted: 'ok',
  won: 'ok',
  lost: 'danger',
  closed: 'mute'
}
const SOURCES = ['展会', '邮件开发', '老客户复购', '阿里国际站', '客户主动询价', '其他']

function InquiryManagement() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'inquiry.edit')
  const [inquiries, setInquiries] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    customer_id: '', title: '', inquiry_date: new Date().toISOString().slice(0, 10),
    currency: 'USD', source: SOURCES[0], notes: ''
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [inquiryResponse, customerResponse] = await Promise.all([
        axios.get('/api/inquiries'),
        axios.get('/api/customers')
      ])
      setInquiries(Array.isArray(inquiryResponse.data) ? inquiryResponse.data : [])
      setCustomers(Array.isArray(customerResponse.data) ? customerResponse.data : [])
    } catch (loadError) {
      setError(loadError?.response?.data?.error || '读取询盘列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    return inquiries.filter(inquiry => {
      if (statusFilter && inquiry.status !== statusFilter) return false
      if (!term) return true
      return [inquiry.inquiry_no, inquiry.title, inquiry.customer_name]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(term))
    })
  }, [inquiries, keyword, statusFilter])

  const counts = useMemo(() => {
    const result = { total: inquiries.length }
    inquiries.forEach(inquiry => { result[inquiry.status] = (result[inquiry.status] || 0) + 1 })
    return result
  }, [inquiries])

  const openAdd = () => {
    setForm({
      customer_id: customers[0]?.id ? String(customers[0].id) : '',
      title: '', inquiry_date: new Date().toISOString().slice(0, 10),
      currency: 'USD', source: SOURCES[0], notes: ''
    })
    setFormError('')
    setShowAdd(true)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!form.customer_id) { setFormError('请选择客户'); return }
    if (!customers.length) { setFormError('还没有客户，请先到「客户管理」新增一个客户'); return }
    setSaving(true)
    setFormError('')
    try {
      const response = await axios.post('/api/inquiries', {
        customer_id: Number(form.customer_id),
        title: form.title.trim() || null,
        inquiry_date: form.inquiry_date,
        currency: form.currency,
        source: form.source || null,
        notes: form.notes.trim() || null
      })
      const created = response.data?.inquiry
      setShowAdd(false)
      if (created?.id) navigate(`/inquiries/${created.id}`)
      else load()
    } catch (submitError) {
      setFormError(submitError?.response?.data?.error || '创建询盘失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">询盘管理</h1>
          <p className="page-sub">客户的第一封询价、绑定的货号、最终的 EXW 报价，都在这里串起来。</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            <RefreshIcon size={14} /> 刷新
          </button>
          {canEdit && (
            <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
              <PlusCircleIcon size={15} /> 新建询盘
            </button>
          )}
        </div>
      </div>

      <div className="filter-bar">
        <span className="toolbar-search">
          <SearchIcon size={15} />
          <input
            type="search"
            value={keyword}
            placeholder="搜询盘号 / 标题 / 客户"
            aria-label="搜索询盘"
            onChange={event => setKeyword(event.target.value)}
          />
        </span>
        <div className="chip-filters">
          <button
            type="button"
            className={`chip-filter${statusFilter === '' ? ' is-active' : ''}`}
            onClick={() => setStatusFilter('')}
          >
            全部 <b>{counts.total || 0}</b>
          </button>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            counts[value] ? (
              <button
                type="button"
                key={value}
                className={`chip-filter${statusFilter === value ? ' is-active' : ''}`}
                onClick={() => setStatusFilter(value)}
              >
                {label} <b>{counts[value]}</b>
              </button>
            ) : null
          ))}
        </div>
      </div>

      {error && <p className="notice-inline">{error}</p>}

      {loading ? (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>询盘号</th>
                <th>客户</th>
                <th>标题</th>
                <th>询盘日期</th>
                <th className="num">货号数</th>
                <th>报价币种</th>
                <th>来源</th>
                <th>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <SkeletonTableRows rows={6} widths={[1.2, 1.2, 1.8, 1, 0.7, 0.9, 0.9, 0.9, 1]} />
            </tbody>
          </table>
        </div>
      ) : filtered.length === 0 ? (
        <div className="dashboard-panel">
          <div className="empty-state">
            <p className="empty-state-title">
              {inquiries.length ? '没有符合条件的询盘' : '还没有任何询盘'}
            </p>
            <p className="empty-state-hint">
              {inquiries.length
                ? '换个关键词或状态试试。'
                : '客户来了第一封询价时，先建一条询盘，再往里面挂货号。'}
            </p>
            {!inquiries.length && canEdit && (
              <button type="button" className="btn btn-primary btn-sm" onClick={openAdd} style={{ marginTop: 14 }}>
                <PlusCircleIcon size={15} /> 新建询盘
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>询盘号</th>
                <th>客户</th>
                <th>标题</th>
                <th>询盘日期</th>
                <th className="num">货号数</th>
                <th>报价币种</th>
                <th>来源</th>
                <th>状态</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inquiry => (
                <tr key={inquiry.id} onClick={() => navigate(`/inquiries/${inquiry.id}`)}>
                  <td className="mono bold">{inquiry.inquiry_no}</td>
                  <td>{inquiry.customer_name || '—'}</td>
                  <td>{inquiry.title || <span className="muted-note">未命名</span>}</td>
                  <td className="mono">{inquiry.inquiry_date}</td>
                  <td className="num">{inquiry.item_count ?? 0}</td>
                  <td>{inquiry.currency || '—'}</td>
                  <td>{inquiry.source || '—'}</td>
                  <td>
                    <span className={`pill pill-${STATUS_TONE[inquiry.status] || 'mute'}`}>
                      {STATUS_LABELS[inquiry.status] || inquiry.status}
                    </span>
                  </td>
                  <td className="col-actions">
                    <Link
                      className="btn-link"
                      to={`/inquiries/${inquiry.id}`}
                      onClick={event => event.stopPropagation()}
                    >
                      查看报价
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-content" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2><InquiryIcon size={18} /> 新建询盘</h2>
              <button type="button" className="icon-btn" onClick={() => setShowAdd(false)} aria-label="关闭">×</button>
            </div>
            <form onSubmit={submit}>
              {customers.length === 0 && (
                <p className="notice-inline">
                  还没有客户档案。先去
                  <Link to="/customers" onClick={() => setShowAdd(false)}> 客户管理 </Link>
                  建一个客户，询盘必须挂在客户身上。
                </p>
              )}
              <div className="form-group">
                <label>客户 *</label>
                <select
                  value={form.customer_id}
                  onChange={event => setForm({ ...form, customer_id: event.target.value })}
                >
                  <option value="">请选择客户</option>
                  {customers.map(customer => (
                    <option key={customer.id} value={customer.id}>
                      {customer.company}{customer.country ? ` · ${customer.country}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>询盘标题</label>
                <input
                  type="text"
                  maxLength={200}
                  value={form.title}
                  placeholder="例如：2026 春季手动工具首轮询价"
                  onChange={event => setForm({ ...form, title: event.target.value })}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>询盘日期</label>
                  <input
                    type="date"
                    value={form.inquiry_date}
                    onChange={event => setForm({ ...form, inquiry_date: event.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>报价币种</label>
                  <select
                    value={form.currency}
                    onChange={event => setForm({ ...form, currency: event.target.value })}
                  >
                    {['USD', 'EUR', 'CNY', 'GBP', 'JPY', 'AUD'].map(currency => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>来源渠道</label>
                <select value={form.source} onChange={event => setForm({ ...form, source: event.target.value })}>
                  {SOURCES.map(source => <option key={source} value={source}>{source}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>备注</label>
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={form.notes}
                  placeholder="客户提到的交期、认证、目标价等"
                  onChange={event => setForm({ ...form, notes: event.target.value })}
                />
              </div>
              {formError && <p className="form-error">{formError}</p>}
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>取消</button>
                {canEdit && (
                  <button type="submit" className="btn btn-primary" disabled={saving || !customers.length}>
                    {saving ? '创建中…' : '创建并去报价'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {!loading && customers.length > 0 && inquiries.length > 0 && (
        <p className="muted-note table-foot-note">
          <UsersIcon size={13} /> 共 {filtered.length} 条询盘
          {filtered.some(inquiry => !inquiry.item_count) && ' · 有询盘还没有报价行，点进去添加货号'}
        </p>
      )}
    </div>
  )
}

export default InquiryManagement
