import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { SkeletonTableRows } from '../components/Skeleton'
import { PlusCircleIcon, RefreshIcon, SearchIcon, GlobeIcon, UserIcon } from '../components/Icons'
import { useAuth, hasPermission } from '../auth'

const STATUS_LABELS = { active: '活跃', inactive: '非活跃', lead: '潜在' }

/**
 * 我的客户。
 *
 * 归属口径（Wayne 2026-09-14）：客户有「所属」，谁建的归谁，默认只有归属人看得见；
 * 创建人主动丢进公海后同组织可见可领；其余客户只有拿到 customer.view_all 的
 * 最高级别管理账号能看到 —— 所以这里默认只查 scope=mine，
 * 有权限的账号多一个「全部客户」看板。
 */
function CustomerManagement() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canViewAll = hasPermission(user, 'customer.view_all')
  const canEdit = hasPermission(user, 'customer.edit')
  const [scope, setScope] = useState('mine')
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [formData, setFormData] = useState({
    company: '',
    country: '',
    industry: '',
    website: '',
    email: '',
    phone: '',
    notes: ''
  })

  const fetchCustomers = useCallback(async (nextScope = scope) => {
    setError('')
    setLoading(true)
    try {
      const response = await axios.get('/api/customers', { params: { scope: nextScope } })
      setCustomers(Array.isArray(response.data) ? response.data : [])
    } catch (loadError) {
      setError(loadError?.response?.data?.error || '获取客户列表失败')
      setCustomers([])
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { fetchCustomers(scope) }, [scope, fetchCustomers])

  const filtered = useMemo(() => {
    const term = keyword.trim().toLowerCase()
    if (!term) return customers
    return customers.filter(customer =>
      [customer.company, customer.country, customer.industry, customer.email, customer.phone, customer.owner_name]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(term))
    )
  }, [customers, keyword])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      const response = await axios.post('/api/customers', formData)
      setShowAddModal(false)
      setFormData({ company: '', country: '', industry: '', website: '', email: '', phone: '', notes: '' })
      const newId = response.data?.id
      await fetchCustomers(scope)
      // 新建后直接进详情页 —— 下一步九成是记第一条跟进，不该让用户再自己找
      if (newId) navigate(`/customers/${newId}`)
    } catch (submitError) {
      setFormError(submitError?.response?.data?.error || submitError?.message || '创建失败')
    } finally {
      setSaving(false)
    }
  }

  /* 丢入公海：归属人主动放弃，客户变成组织共享资源，同组织同事可见可领。
     乐观更新：先把行从列表拿掉（mine 范围）或打上公海标记（all 范围），
     后台失败再放回原位 —— 用户点完立刻看到结果，不用等网络往返。 */
  const handleToPool = async (customer) => {
    const ok = window.confirm(
      `把「${customer.company}」丢进客户公海？\n\n` +
      '丢入后它会从「我的客户」移到「客户公海」，同组织的同事都能看到并领取。\n' +
      '一旦有同事领取，这条客户就不再归你了。'
    )
    if (!ok) return
    setError('')
    const index = customers.findIndex(item => item.id === customer.id)
    const rollback = () => setCustomers(prev => {
      if (prev.some(item => item.id === customer.id)) {
        return prev.map(item => (item.id === customer.id ? customer : item))
      }
      const next = [...prev]
      next.splice(Math.min(Math.max(index, 0), next.length), 0, customer)
      return next
    })
    if (scope === 'mine') {
      setCustomers(prev => prev.filter(item => item.id !== customer.id))
    } else {
      setCustomers(prev => prev.map(item => (item.id === customer.id ? { ...item, pool_status: 'public' } : item)))
    }
    try {
      await axios.post(`/api/customers/${customer.id}/to-pool`)
    } catch (err) {
      rollback()
      setError(err?.response?.data?.error || '丢入公海失败，已恢复原状')
    }
  }

  const openAdd = () => {
    setFormError('')
    setShowAddModal(true)
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">我的客户</h1>
          <p className="page-sub">
            客户默认只有创建人（归属人）可见。想让团队一起跟，就把客户丢进「客户公海」，
            同组织成员都能看到并领取。
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => fetchCustomers(scope)}>
            <RefreshIcon size={14} /> 刷新
          </button>
          {canEdit && (
            <button className="btn btn-primary btn-sm" onClick={openAdd}>
              <PlusCircleIcon size={15} /> 新增客户
            </button>
          )}
        </div>
      </div>

      <div className="filter-bar">
        {canViewAll ? (
          <div className="scope-tabs" role="tablist" aria-label="客户范围">
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'mine'}
              className={`scope-tab${scope === 'mine' ? ' is-active' : ''}`}
              onClick={() => setScope('mine')}
            >
              我的客户
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'all'}
              className={`scope-tab${scope === 'all' ? ' is-active' : ''}`}
              onClick={() => setScope('all')}
            >
              全部客户
            </button>
          </div>
        ) : (
          <span className="scope-hint"><UserIcon size={13} /> 仅显示我名下的客户</span>
        )}

        <span className="toolbar-search">
          <SearchIcon size={15} />
          <input
            type="search"
            value={keyword}
            placeholder="搜公司 / 国家 / 行业 / 联系方式"
            aria-label="搜索客户"
            onChange={event => setKeyword(event.target.value)}
          />
        </span>
      </div>

      {error && <p className="notice-inline">{error}</p>}

      <div className="table-container table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>公司名称</th>
              <th>国家</th>
              <th>行业</th>
              <th>网站</th>
              <th>联系方式</th>
              <th>归属</th>
              <th>状态</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              /* 骨架屏：列宽贴近真实表格，加载完成时整页不会跳一下 */
              <SkeletonTableRows rows={6} widths={[2.4, 1, 1.2, 1.6, 1.8, 1, 1, 1.2]} />
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty-state">
                  {customers.length
                    ? '没有匹配的客户'
                    : scope === 'all'
                      ? '系统里还没有客户'
                      : '你名下还没有客户。点右上角「新增客户」建档，或到「客户公海」领取同事放出的资源。'}
                </td>
              </tr>
            ) : (
              filtered.map(customer => {
                const isMine = user && Number(customer.owner_id) === Number(user.id)
                const inPool = customer.pool_status === 'public'
                const canDrop = (isMine || canViewAll) && !inPool && canEdit
                return (
                  <tr key={customer.id} onClick={() => navigate(`/customers/${customer.id}`)}>
                    <td><strong>{customer.company}</strong></td>
                    <td>{customer.country || '-'}</td>
                    <td>{customer.industry || '-'}</td>
                    <td>
                      {customer.website ? (
                        <a
                          href={customer.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={event => event.stopPropagation()}
                        >
                          {customer.website}
                        </a>
                      ) : '-'}
                    </td>
                    <td>
                      {customer.email && <div>{customer.email}</div>}
                      {customer.phone && <div>{customer.phone}</div>}
                    </td>
                    <td>
                      {inPool ? (
                        <span className="pill pill-mute" title="已丢入公海，同组织成员可见可领">
                          <GlobeIcon size={11} /> 公海
                        </span>
                      ) : (
                        <span className="owner-cell">
                          <UserIcon size={11} /> {customer.owner_name || '未指定'}
                          {isMine && <span className="owner-self">我</span>}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`pill pill-${customer.status === 'active' ? 'ok' : 'mute'}`}>
                        {STATUS_LABELS[customer.status] || customer.status || '未标记'}
                      </span>
                    </td>
                    <td className="col-actions">
                      {canDrop && (
                        <button
                          className="btn-link"
                          title="放弃归属，同组织成员可见并可领取"
                          onClick={event => { event.stopPropagation(); handleToPool(customer) }}
                        >
                          丢入公海
                        </button>
                      )}
                      <button
                        className="btn-link"
                        onClick={event => { event.stopPropagation(); navigate(`/customers/${customer.id}`) }}
                      >
                        查看详情
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>新增客户</h2>
              <button className="icon-btn" onClick={() => setShowAddModal(false)} aria-label="关闭">×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>公司名称 *</label>
                <input
                  type="text"
                  required
                  value={formData.company}
                  onChange={e => setFormData({ ...formData, company: e.target.value })}
                />
              </div>
              <p className="form-hint">
                新建的客户归属你自己：只有你能看到，除非你把它丢进客户公海。
              </p>
              <div className="form-row">
                <div className="form-group">
                  <label>国家</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={e => setFormData({ ...formData, country: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>行业</label>
                  <input
                    type="text"
                    value={formData.industry}
                    onChange={e => setFormData({ ...formData, industry: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>网站</label>
                <input
                  type="url"
                  placeholder="https://"
                  value={formData.website}
                  onChange={e => setFormData({ ...formData, website: e.target.value })}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>邮箱</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>电话</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>备注</label>
                <textarea
                  rows="3"
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>
              {formError && <p className="form-error">{formError}</p>}
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  取消
                </button>
                {canEdit && (
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? '保存中…' : '保存并进入详情'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default CustomerManagement
