import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { GlobeIcon, RefreshIcon, UserIcon, SearchIcon, CheckIcon } from '../components/Icons'
import { SkeletonTableRows } from '../components/Skeleton'
import { useAuth, hasPermission } from '../auth'
import { setPageTitle } from '../branding'

function fmtDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * 客户公海 —— 组织（团队）共享的客户资源池。
 *
 * 数据就是 customers 里 pool_status = 'public' 的那批：
 * 创建人主动把客户丢进来，同组织成员可见、可领取，谁先领归谁。
 */
function CustomerPool() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canClaim = hasPermission(user, 'pool.claim')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    setPageTitle('客户公海')
  }, [])

  const fetchPool = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get('/api/customers', { params: { scope: 'pool' } })
      setRows(Array.isArray(data) ? data : [])
    } catch (loadError) {
      setError(loadError?.response?.data?.error || '获取公海客户失败')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPool() }, [fetchPool])

  /* 领取：乐观更新 —— 先把行从公海拿掉，后台失败再放回原位。
     409 = 被同事抢先，回滚后顺手刷一次对齐真实状态。 */
  const claim = async (customer) => {
    setError('')
    setNotice('')
    const index = rows.findIndex(row => row.id === customer.id)
    setRows(prev => prev.filter(row => row.id !== customer.id))
    setNotice(`「${customer.company}」已领取，现在归你名下。`)
    try {
      await axios.post(`/api/customers/${customer.id}/claim`)
    } catch (err) {
      setRows(prev => {
        if (prev.some(row => row.id === customer.id)) return prev
        const next = [...prev]
        next.splice(Math.min(Math.max(index, 0), next.length), 0, customer)
        return next
      })
      setNotice('')
      setError(err?.response?.data?.error || '领取失败，已恢复原状')
      if (err?.response?.status === 409) fetchPool()
    }
  }

  const filtered = keyword.trim()
    ? rows.filter(row =>
        [row.company, row.country, row.industry, row.email, row.created_by_name]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(keyword.trim().toLowerCase()))
      )
    : rows

  return (
    <div className="page-container pool-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">客户公海</h1>
          <p className="page-subtitle">
            与组织（团队）共用的客户资源池：同事主动放出来的客户都躺在下面，同组织成员都能看到，谁先领取就归谁。
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary btn-sm" onClick={fetchPool}>
            <RefreshIcon size={14} /> 刷新
          </button>
        </div>
      </div>

      <div className="pool-rules">
        <div className="pool-rule-card">
          <span className="pool-rule-index">01</span>
          <b>主动放出</b>
          <p>客户默认只有创建人可见。创建人在「我的客户」里点「丢入公海」，这条就进入团队资源池。</p>
        </div>
        <div className="pool-rule-card">
          <span className="pool-rule-index">02</span>
          <b>团队可见</b>
          <p>公海客户对同组织成员可见，联系方式与历史跟进都能查，方便快速判断值不值得跟。</p>
        </div>
        <div className="pool-rule-card">
          <span className="pool-rule-index">03</span>
          <b>领取跟进</b>
          <p>点「领取」即归属到自己名下并进入「我的客户」，同组织其他人不会再领到。</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          <GlobeIcon size={15} /> 公海客户
          <span className="panel-count">{rows.length}</span>
        </div>

        <div className="filter-bar">
          <span className="toolbar-search">
            <SearchIcon size={15} />
            <input
              type="search"
              value={keyword}
              placeholder="搜公司 / 国家 / 行业 / 联系方式"
              aria-label="搜索公海客户"
              onChange={event => setKeyword(event.target.value)}
            />
          </span>
        </div>

        {notice && <p className="notice-inline notice-ok"><CheckIcon size={13} /> {notice}</p>}
        {error && <p className="notice-inline">{error}</p>}

        <div className="table-container table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>公司名称</th>
                <th>国家</th>
                <th>行业</th>
                <th>联系方式</th>
                <th>原归属</th>
                <th>丢入时间</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRows rows={5} widths={[2.2, 0.8, 1, 1.6, 1, 1, 1]} />
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-state">
                    <GlobeIcon size={28} />
                    <p style={{ margin: '8px 0 0' }}>
                      {rows.length ? '没有匹配的公海客户' : '公海现在是空的 —— 同事把客户丢进来后会出现在这里。'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map(row => (
                  <tr key={row.id} onClick={() => navigate(`/customers/${row.id}`)}>
                    <td>
                      <strong>{row.company}</strong>
                      {row.pool_note && <div className="muted-note">放出说明：{row.pool_note}</div>}
                    </td>
                    <td>{row.country || '-'}</td>
                    <td>{row.industry || '-'}</td>
                    <td>
                      {row.email && <div>{row.email}</div>}
                      {row.phone && <div>{row.phone}</div>}
                    </td>
                    <td>
                      <span className="owner-cell"><UserIcon size={11} /> {row.owner_name || '未指定'}</span>
                      {row.created_by_name && <div className="muted-note">创建人：{row.created_by_name}</div>}
                    </td>
                    <td className="mono">{fmtDate(row.pool_at)}</td>
                    <td className="col-actions">
                      {canClaim ? (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={event => { event.stopPropagation(); claim(row) }}
                        >
                          领取
                        </button>
                      ) : (
                        <span className="muted-note">无领取权限</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default CustomerPool
