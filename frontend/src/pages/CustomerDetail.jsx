import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import axios from 'axios'
import {
  UsersIcon, ClockIcon, PlusCircleIcon, InquiryIcon, QuoteIcon,
  ClipboardIcon, RefreshIcon, TargetIcon, PencilIcon, CloseIcon
} from '../components/Icons'
import { useAuth, hasPermission } from '../auth'

const ACTIVITY_TYPES = ['邮件', '电话', '微信', 'WhatsApp', '拜访', '样品', '展会', '其他']

/* 联系人表单的空值模板：新增和「清空重置」共用一份，避免字段改动漏掉某处 */
const EMPTY_CONTACT = {
  name: '', name_en: '', position: '', department: '',
  email: '', phone: '', whatsapp: '', wechat: '', is_primary: false, notes: ''
}

const STATUS_LABELS = { active: '活跃', inactive: '非活跃', lead: '潜在' }

const INQUIRY_STATUS_LABELS = {
  draft: '草稿', quoting: '报价中', quoted: '已报价', won: '已成交', lost: '已流失', closed: '已关闭'
}

const ORDER_STATUS_LABELS = {
  pending: '待处理', confirmed: '已确认', producing: '生产中', shipped: '已发货',
  completed: '已完成', cancelled: '已取消'
}

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function money(value, currency) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`
}

function formatMoment(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 下次跟进日期的语义化提示 —— 业务上「逾期」和「今天」要一眼能看出来 */
function dueState(dateKey) {
  if (!dateKey) return null
  const today = todayKey()
  if (dateKey < today) return { tone: 'danger', label: '已逾期' }
  if (dateKey === today) return { tone: 'warn', label: '今天' }
  return { tone: 'ok', label: '待跟进' }
}

/** 快速记录跟进：默认收起成一个输入框，聚焦或输入时展开完整字段 */
function QuickFollowUp({ customer, contacts, inquiries, onSaved, canEdit }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    activity_type: ACTIVITY_TYPES[0], content: '', next_action: '',
    next_action_date: '', contact_id: '', inquiry_id: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    const content = form.content.trim()
    if (!content) { setError('写点什么吧，至少留下一句跟进内容'); return }
    setSaving(true)
    setError('')
    try {
      await axios.post(`/api/customers/${customer.id}/follow-ups`, {
        activity_type: form.activity_type,
        content,
        next_action: form.next_action.trim() || null,
        next_action_date: form.next_action_date || null,
        contact_id: form.contact_id ? Number(form.contact_id) : null,
        inquiry_id: form.inquiry_id ? Number(form.inquiry_id) : null
      })
      setForm({
        activity_type: ACTIVITY_TYPES[0], content: '', next_action: '',
        next_action_date: '', contact_id: '', inquiry_id: ''
      })
      setOpen(false)
      onSaved()
    } catch (submitError) {
      setError(submitError?.response?.data?.error || '记录失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className={`quick-follow${open ? ' is-open' : ''}`} onSubmit={submit}>
      <div className="quick-follow-head">
        <span className="quick-follow-icon"><PlusCircleIcon size={15} /></span>
        <input
          type="text"
          value={form.content}
          placeholder="快速记录一条跟进，回车保存"
          aria-label="快速记录跟进内容"
          onFocus={() => setOpen(true)}
          onChange={event => setForm({ ...form, content: event.target.value })}
        />
        {!open && canEdit && <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>记录</button>}
      </div>

      {open && (
        <div className="quick-follow-body">
          <div className="form-row">
            <div className="form-group">
              <label>跟进方式</label>
              <select
                value={form.activity_type}
                onChange={event => setForm({ ...form, activity_type: event.target.value })}
              >
                {ACTIVITY_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>对接联系人</label>
              <select
                value={form.contact_id}
                onChange={event => setForm({ ...form, contact_id: event.target.value })}
              >
                <option value="">不指定</option>
                {contacts.map(contact => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}{contact.position ? ` · ${contact.position}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>下一次跟进动作</label>
              <input
                type="text"
                value={form.next_action}
                placeholder="例如：电话确认包装要求"
                onChange={event => setForm({ ...form, next_action: event.target.value })}
              />
            </div>
            <div className="form-group">
              <label>下一次跟进日期</label>
              <input
                type="date"
                value={form.next_action_date}
                onChange={event => setForm({ ...form, next_action_date: event.target.value })}
              />
            </div>
          </div>
          {inquiries.length > 0 && (
            <div className="form-group">
              <label>关联询盘</label>
              <select
                value={form.inquiry_id}
                onChange={event => setForm({ ...form, inquiry_id: event.target.value })}
              >
                <option value="">不关联</option>
                {inquiries.map(inquiry => (
                  <option key={inquiry.id} value={inquiry.id}>
                    {inquiry.inquiry_no} · {inquiry.title || '未命名'}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="quick-follow-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setOpen(false); setError('') }}>
              收起
            </button>
            {canEdit && (
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? '保存中…' : '保存跟进'}
              </button>
            )}
          </div>
        </div>
      )}
      {!open && error && <p className="form-error">{error}</p>}
    </form>
  )
}

/** 编辑一条跟进记录 —— 字段与快速记录保持一致，避免两套表单口径不一 */
function FollowUpEditModal({ record, contacts, inquiries, onClose, onSaved }) {
  const [form, setForm] = useState({
    activity_type: record.activity_type || ACTIVITY_TYPES[0],
    content: record.content || '',
    next_action: record.next_action || '',
    next_action_date: record.next_action_date ? String(record.next_action_date).slice(0, 10) : '',
    contact_id: record.contact_id || '',
    inquiry_id: record.inquiry_id || ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async event => {
    event.preventDefault()
    const content = form.content.trim()
    if (!content) { setError('跟进内容不能为空'); return }
    setSaving(true)
    setError('')
    try {
      await axios.patch(`/api/customers/${record.customer_id}/follow-ups/${record.id}`, {
        activity_type: form.activity_type,
        content,
        next_action: form.next_action.trim() || null,
        next_action_date: form.next_action_date || null,
        contact_id: form.contact_id ? Number(form.contact_id) : null,
        inquiry_id: form.inquiry_id ? Number(form.inquiry_id) : null
      })
      onSaved()
    } catch (err) {
      setError(err?.response?.data?.error || '保存失败，请稍后重试')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-wide" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2>编辑跟进记录</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭"><CloseIcon size={16} /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            {error && <p className="form-error">{error}</p>}
            <div className="form-row">
              <div className="form-group">
                <label>跟进方式</label>
                <select value={form.activity_type} onChange={e => setForm({ ...form, activity_type: e.target.value })}>
                  {ACTIVITY_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>对接联系人</label>
                <select value={form.contact_id} onChange={e => setForm({ ...form, contact_id: e.target.value })}>
                  <option value="">不指定</option>
                  {contacts.map(contact => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}{contact.position ? ` · ${contact.position}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>跟进内容 *</label>
              <textarea rows="3" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>下一次跟进动作</label>
                <input
                  type="text" value={form.next_action}
                  placeholder="例如：电话确认包装要求"
                  onChange={e => setForm({ ...form, next_action: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>下一次跟进日期</label>
                <input
                  type="date" value={form.next_action_date}
                  onChange={e => setForm({ ...form, next_action_date: e.target.value })}
                />
              </div>
            </div>
            {inquiries.length > 0 && (
              <div className="form-group">
                <label>关联询盘</label>
                <select value={form.inquiry_id} onChange={e => setForm({ ...form, inquiry_id: e.target.value })}>
                  <option value="">不关联</option>
                  {inquiries.map(inquiry => (
                    <option key={inquiry.id} value={inquiry.id}>
                      {inquiry.inquiry_no} · {inquiry.title || '未命名'}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** 编辑客户基本信息（右侧「基本信息」面板的编辑按钮） */
function CustomerProfileModal({ customer, onClose, onSaved }) {
  const [form, setForm] = useState({
    company: customer.company || '',
    company_en: customer.company_en || '',
    country: customer.country || '',
    industry: customer.industry || '',
    website: customer.website || '',
    address: customer.address || '',
    email: customer.email || '',
    phone: customer.phone || '',
    notes: customer.notes || '',
    status: customer.status === 'inactive' ? 'inactive' : 'active'
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))

  const submit = async event => {
    event.preventDefault()
    if (!form.company.trim()) { setError('公司名称不能为空'); return }
    setSaving(true)
    setError('')
    try {
      await axios.patch(`/api/customers/${customer.id}`, { ...form, company: form.company.trim() })
      onSaved()
    } catch (err) {
      setError(err?.response?.data?.error || '保存失败，请稍后重试')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-wide" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2>编辑客户信息</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭"><CloseIcon size={16} /></button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            {error && <p className="form-error">{error}</p>}
            <div className="form-row">
              <div className="form-group">
                <label>公司名称 *</label>
                <input type="text" value={form.company} onChange={e => set('company', e.target.value)} />
              </div>
              <div className="form-group">
                <label>英文名称</label>
                <input type="text" value={form.company_en} onChange={e => set('company_en', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>国家 / 地区</label>
                <input type="text" value={form.country} onChange={e => set('country', e.target.value)} />
              </div>
              <div className="form-group">
                <label>行业</label>
                <input type="text" value={form.industry} onChange={e => set('industry', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>网站</label>
              <input type="text" value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://" />
            </div>
            <div className="form-group">
              <label>地址</label>
              <input type="text" value={form.address} onChange={e => set('address', e.target.value)} placeholder="报价单抬头会用到" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>邮箱</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div className="form-group">
                <label>电话</label>
                <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>客户状态</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}>
                <option value="active">活跃（可正常跟进）</option>
                <option value="inactive">非活跃</option>
              </select>
            </div>
            <div className="form-group">
              <label>备注</label>
              <textarea rows="2" value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function CustomerDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'customer.edit')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [contactOpen, setContactOpen] = useState(false)
  /* 为 null = 新增联系人；有值 = 正在编辑这条联系人 */
  const [contactEditing, setContactEditing] = useState(null)
  const [contactForm, setContactForm] = useState({ ...EMPTY_CONTACT })
  const [contactError, setContactError] = useState('')
  const [savingContact, setSavingContact] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  /* 正在编辑的跟进记录；null = 没打开 */
  const [followUpEditing, setFollowUpEditing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await axios.get(`/api/customers/${id}`)
      setData(response.data)
    } catch (loadError) {
      setError(loadError?.response?.data?.error || '读取客户详情失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  /* 打开联系人弹窗：不传参数是新增，传了联系人就是编辑 */
  const openContact = (contact = null) => {
    setContactEditing(contact)
    setContactError('')
    setContactForm(contact ? {
      name: contact.name || '',
      name_en: contact.name_en || '',
      position: contact.position || '',
      department: contact.department || '',
      email: contact.email || '',
      phone: contact.phone || '',
      whatsapp: contact.whatsapp || '',
      wechat: contact.wechat || '',
      is_primary: !!contact.is_primary,
      notes: contact.notes || ''
    } : { ...EMPTY_CONTACT })
    setContactOpen(true)
  }

  const closeContact = () => {
    setContactOpen(false)
    setContactEditing(null)
    setContactError('')
    setContactForm({ ...EMPTY_CONTACT })
  }

  const submitContact = async (event) => {
    event.preventDefault()
    if (!contactForm.name.trim()) { setContactError('联系人姓名不能为空'); return }
    setSavingContact(true)
    setContactError('')
    try {
      const payload = { ...contactForm, name: contactForm.name.trim() }
      if (contactEditing) await axios.patch(`/api/customers/${id}/contacts/${contactEditing.id}`, payload)
      else await axios.post(`/api/customers/${id}/contacts`, payload)
      closeContact()
      await load()
    } catch (submitError) {
      setContactError(submitError?.response?.data?.error || (contactEditing ? '保存联系人失败' : '新增联系人失败'))
    } finally {
      setSavingContact(false)
    }
  }

  const customer = data?.customer
  const followups = data?.followups || []
  const contacts = data?.contacts || []
  const inquiries = data?.inquiries || []

  // 下一次跟进 = 还没过期或被跳过的记录里最近的那一条
  const nextFollowUp = useMemo(() => {
    const dated = followups.filter(record => record.next_action_date)
    if (!dated.length) return null
    return [...dated].sort((a, b) => String(a.next_action_date).localeCompare(String(b.next_action_date)))
      .find(record => record.next_action_date >= todayKey()) || dated[0]
  }, [followups])

  if (loading) return <div className="loading">加载客户详情…</div>
  if (!customer) {
    return (
      <div className="page-container">
        <p className="notice-inline">{error || '客户不存在'}</p>
        <Link className="btn btn-secondary btn-sm" to="/customers">返回客户列表</Link>
      </div>
    )
  }

  const nextDue = nextFollowUp ? dueState(String(nextFollowUp.next_action_date).slice(0, 10)) : null

  return (
    <div className="page-container">
      <div className="breadcrumb">
        <Link to="/customers">客户管理</Link>
        <span>/</span>
        <span>{customer.company}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{customer.company}</h1>
          <p className="page-sub">
            {[customer.country, customer.industry].filter(Boolean).join(' · ') || '未填写国家与行业'}
            {' · '}
            <span className={`pill pill-${customer.status === 'active' ? 'ok' : 'mute'}`}>
              {STATUS_LABELS[customer.status] || customer.status || '未标记'}
            </span>
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            <RefreshIcon size={14} /> 刷新
          </button>
          <Link className="btn btn-primary btn-sm" to="/inquiries">
            <InquiryIcon size={15} /> 去询盘报价
          </Link>
        </div>
      </div>

      {error && <p className="notice-inline">{error}</p>}

      <div className="stat-rail inquiry-rail">
        <div className="stat-line">
          <span className="stat-line-icon"><ClockIcon size={17} /></span>
          <span>最近联系</span>
          <strong>{customer.last_contact_at ? formatMoment(customer.last_contact_at).slice(0, 16) : '—'}</strong>
        </div>
        <div className="stat-line">
          <span className="stat-line-icon"><TargetIcon size={17} /></span>
          <span>下次跟进</span>
          <strong>
            {nextFollowUp
              ? <>{String(nextFollowUp.next_action_date).slice(0, 10)} <span className={`pill pill-${nextDue?.tone || 'mute'}`}>{nextDue?.label}</span></>
              : '未安排'}
          </strong>
        </div>
        <div className="stat-line">
          <span className="stat-line-icon"><InquiryIcon size={17} /></span>
          <span>询盘</span><strong>{inquiries.length}</strong>
        </div>
        <div className="stat-line">
          <span className="stat-line-icon"><QuoteIcon size={17} /></span>
          <span>报价单</span>
          <strong>
            {data.quoteOverview?.count || 0}
            {Number(data.quoteOverview?.total_amount) > 0 && ` · ${money(data.quoteOverview.total_amount)}`}
          </strong>
        </div>
        <div className="stat-line">
          <span className="stat-line-icon"><ClipboardIcon size={17} /></span>
          <span>订单</span>
          <strong>
            {data.orderOverview?.count || 0}
            {Number(data.orderOverview?.total_amount) > 0 && ` · ${money(data.orderOverview.total_amount)}`}
          </strong>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <div>
                <h2><ClockIcon size={17} /> 跟进时间线</h2>
              </div>
              <span className="panel-period">{followups.length} 条记录</span>
            </div>

            <QuickFollowUp
              customer={customer}
              contacts={contacts}
              inquiries={inquiries}
              onSaved={load}
              canEdit={canEdit}
            />

            {followups.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-title">还没有跟进记录</p>
                <p className="empty-state-hint">上面那一行就是快速记录入口，写一句话按回车即可。</p>
              </div>
            ) : (
              <ol className="timeline">
                {followups.map(record => {
                  const due = dueState(String(record.next_action_date || '').slice(0, 10))
                  return (
                    <li className="timeline-item" key={record.id}>
                      <span className="timeline-dot" />
                      <div className="timeline-body">
                        <div className="timeline-head">
                          <span className="timeline-type">{record.activity_type}</span>
                          <span className="timeline-time">{formatMoment(record.created_at)}</span>
                          {canEdit && (
                            <button
                              type="button"
                              className="timeline-edit"
                              onClick={() => setFollowUpEditing(record)}
                              title="编辑这条跟进"
                              aria-label="编辑这条跟进"
                            >
                              <PencilIcon size={13} />
                            </button>
                          )}
                        </div>
                        <p className="timeline-content">{record.content}</p>
                        {(record.next_action || record.next_action_date) && (
                          <div className="timeline-next">
                            <TargetIcon size={13} />
                            <span>
                              下次：{record.next_action || '跟进'}
                              {record.next_action_date ? ` · ${String(record.next_action_date).slice(0, 10)}` : ''}
                            </span>
                            {due && <span className={`pill pill-${due.tone}`}>{due.label}</span>}
                          </div>
                        )}
                        {(record.contact_name || record.inquiry_id) && (
                          <div className="timeline-meta">
                            {record.contact_name && <span>对接：{record.contact_name}</span>}
                            {record.inquiry_id && (
                              <Link to={`/inquiries/${record.inquiry_id}`}>关联询盘 #{record.inquiry_id}</Link>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <div>
                <h2><InquiryIcon size={17} /> 关联询盘</h2>
              </div>
              <Link className="btn btn-secondary btn-sm" to="/inquiries">全部询盘</Link>
            </div>
            {inquiries.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-title">还没有询盘</p>
                <p className="empty-state-hint">在「询盘管理」里新建一条，把它挂到当前客户名下。</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>询盘号</th><th>标题</th><th>日期</th><th>币种</th><th>状态</th><th className="col-actions">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inquiries.map(inquiry => (
                      <tr key={inquiry.id}>
                        <td className="mono bold">{inquiry.inquiry_no}</td>
                        <td>{inquiry.title || <span className="muted-note">未命名</span>}</td>
                        <td className="mono">{inquiry.inquiry_date}</td>
                        <td>{inquiry.currency || '—'}</td>
                        <td>{INQUIRY_STATUS_LABELS[inquiry.status] || inquiry.status}</td>
                        <td className="col-actions">
                          <Link className="btn-link" to={`/inquiries/${inquiry.id}`}>查看报价</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <div>
                <h2><QuoteIcon size={17} /> 报价单与订单</h2>
              </div>
            </div>
            <div className="split-lists">
              <div>
                <h4 className="split-title">客户报价单</h4>
                {(data.quoteItems || []).length === 0 ? (
                  <p className="muted-note">还没有正式报价单。</p>
                ) : (
                  <ul className="mini-list">
                    {data.quoteItems.map(quote => (
                      <li key={quote.id}>
                        <span className="mono">{quote.quote_no}</span>
                        <span className="mini-list-sub">{quote.quote_date}</span>
                        <b>{money(quote.total_amount, quote.currency)}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="split-title">订单</h4>
                {(data.orderItems || []).length === 0 ? (
                  <p className="muted-note">还没有成交订单。</p>
                ) : (
                  <ul className="mini-list">
                    {data.orderItems.map(order => (
                      <li key={order.id}>
                        <span className="mono">{order.order_no}</span>
                        <span className="mini-list-sub">
                          {order.order_date} · {ORDER_STATUS_LABELS[order.status] || order.status}
                        </span>
                        <b>{money(order.total_amount, order.currency)}</b>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>

        <aside className="detail-side">
          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <div>
                <h2>基本信息</h2>
              </div>
              {canEdit && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setProfileOpen(true)}>
                  <PencilIcon size={14} /> 编辑
                </button>
              )}
            </div>
            <div className="kv-grid kv-grid-single">
              <div className="kv"><span className="kv-label">公司名称</span><span className="kv-value">{customer.company}</span></div>
              <div className="kv"><span className="kv-label">国家 / 地区</span><span className={`kv-value${customer.country ? '' : ' is-empty'}`}>{customer.country || '未填写'}</span></div>
              <div className="kv"><span className="kv-label">行业</span><span className={`kv-value${customer.industry ? '' : ' is-empty'}`}>{customer.industry || '未填写'}</span></div>
              <div className="kv"><span className="kv-label">网站</span><span className="kv-value">
                {customer.website
                  ? <a href={customer.website} target="_blank" rel="noopener noreferrer">{customer.website}</a>
                  : <span className="is-empty">未填写</span>}
              </span></div>
              <div className="kv"><span className="kv-label">邮箱</span><span className={`kv-value${customer.email ? '' : ' is-empty'}`}>{customer.email || '未填写'}</span></div>
              <div className="kv"><span className="kv-label">电话</span><span className={`kv-value${customer.phone ? '' : ' is-empty'}`}>{customer.phone || '未填写'}</span></div>
              <div className="kv"><span className="kv-label">负责人</span><span className={`kv-value${customer.owner_name ? '' : ' is-empty'}`}>{customer.owner_name || '未指派'}</span></div>
              <div className="kv"><span className="kv-label">建档时间</span><span className="kv-value">{formatMoment(customer.created_at).slice(0, 10)}</span></div>
            </div>
            {customer.notes && <p className="notes-box">{customer.notes}</p>}
          </section>

          <section className="dashboard-panel">
            <div className="dashboard-panel-header">
              <div>
                <h2><UsersIcon size={17} /> 联系人</h2>
              </div>
              {canEdit && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openContact()}>
                  <PlusCircleIcon size={14} /> 新增
                </button>
              )}
            </div>
            {contacts.length === 0 ? (
              <p className="muted-note">还没有联系人。报价和跟进都挂在具体的人身上，建议先补一个。</p>
            ) : (
              <ul className="contact-list">
                {contacts.map(contact => (
                  <li className="contact-card" key={contact.id}>
                    <div className="contact-head">
                      <span className="contact-avatar">{(contact.name || '?').slice(0, 1)}</span>
                      <div>
                        <div className="contact-name">
                          {contact.name}
                          {contact.is_primary ? <span className="pill pill-ok">主要</span> : null}
                        </div>
                        <div className="contact-role">
                          {[contact.position, contact.department].filter(Boolean).join(' · ') || '未填写职位'}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          className="contact-edit"
                          onClick={() => openContact(contact)}
                          title="编辑联系人"
                          aria-label={`编辑联系人 ${contact.name}`}
                        >
                          <PencilIcon size={13} />
                        </button>
                      )}
                    </div>
                    <div className="contact-lines">
                      {contact.email && <span>✉ {contact.email}</span>}
                      {contact.phone && <span>☎ {contact.phone}</span>}
                      {contact.whatsapp && <span>WA {contact.whatsapp}</span>}
                      {contact.wechat && <span>微信 {contact.wechat}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {contactOpen && (
        <div className="modal-overlay" onClick={closeContact}>
          <div className="modal-content" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{contactEditing ? '编辑联系人' : '新增联系人'}</h2>
              <button type="button" className="icon-btn" onClick={closeContact} aria-label="关闭">×</button>
            </div>
            <form onSubmit={submitContact}>
              <div className="form-row">
                <div className="form-group">
                  <label>姓名 *</label>
                  <input
                    type="text" required value={contactForm.name}
                    onChange={event => setContactForm({ ...contactForm, name: event.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>英文名</label>
                  <input
                    type="text" value={contactForm.name_en}
                    onChange={event => setContactForm({ ...contactForm, name_en: event.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>职位</label>
                  <input
                    type="text" value={contactForm.position}
                    onChange={event => setContactForm({ ...contactForm, position: event.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>部门</label>
                  <input
                    type="text" value={contactForm.department}
                    onChange={event => setContactForm({ ...contactForm, department: event.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>邮箱</label>
                  <input
                    type="email" value={contactForm.email}
                    onChange={event => setContactForm({ ...contactForm, email: event.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>电话</label>
                  <input
                    type="text" value={contactForm.phone}
                    onChange={event => setContactForm({ ...contactForm, phone: event.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>WhatsApp</label>
                  <input
                    type="text" value={contactForm.whatsapp}
                    onChange={event => setContactForm({ ...contactForm, whatsapp: event.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>微信</label>
                  <input
                    type="text" value={contactForm.wechat}
                    onChange={event => setContactForm({ ...contactForm, wechat: event.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>备注</label>
                <textarea
                  rows={2} value={contactForm.notes}
                  onChange={event => setContactForm({ ...contactForm, notes: event.target.value })}
                />
              </div>
              <label className="check-inline">
                <input
                  type="checkbox" checked={contactForm.is_primary}
                  onChange={event => setContactForm({ ...contactForm, is_primary: event.target.checked })}
                />
                设为主要联系人
              </label>
              {contactError && <p className="form-error">{contactError}</p>}
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeContact}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={savingContact}>
                  {savingContact ? '保存中…' : (contactEditing ? '保存修改' : '保存')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {profileOpen && (
        <CustomerProfileModal
          customer={customer}
          onClose={() => setProfileOpen(false)}
          onSaved={async () => { setProfileOpen(false); await load() }}
        />
      )}

      {followUpEditing && (
        <FollowUpEditModal
          record={followUpEditing}
          contacts={contacts}
          inquiries={inquiries}
          onClose={() => setFollowUpEditing(null)}
          onSaved={async () => { setFollowUpEditing(null); await load() }}
        />
      )}
    </div>
  )
}

export default CustomerDetail
