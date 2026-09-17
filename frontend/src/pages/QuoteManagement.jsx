import React, { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { SkeletonTableRows } from '../components/Skeleton'
import { useAuth, hasPermission } from '../auth'

/**
 * 客户报价单管理
 * 数据来源：happy 后端 /api/quotes
 */
function QuoteManagement() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'quote.edit')
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    let alive = true
    axios.get('/api/quotes')
      .then(res => { if (alive) setQuotes(Array.isArray(res.data) ? res.data : res.data?.items || []) })
      .catch(() => { if (alive) setQuotes([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return quotes
    return quotes.filter(q => [q.quote_no, q.customer_name, q.customer_company].filter(Boolean).join(' ').toLowerCase().includes(kw))
  }, [quotes, keyword])

  const statusText = (s) => ({ draft: '草稿', sent: '已发送', accepted: '已接受', rejected: '已拒绝', expired: '已过期' }[s] || s || '—')

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">客户报价单管理</h1>
        {canEdit && <button className="btn btn-primary" onClick={() => navigate('/quotes/new')}>+ 新建报价单</button>}
      </div>

      <div className="toolbar">
        <input
          type="text"
          className="toolbar-search"
          placeholder="搜索报价单号 / 客户"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
        <div className="toolbar-actions">
          <span className="secondary">{rows.length} 条</span>
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>报价单号</th>
              <th>客户</th>
              <th>报价日期</th>
              <th>有效期至</th>
              <th>金额</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonTableRows rows={5} widths={[1.2, 1.6, 1, 1, 1.2, 0.8, 1]} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan="7" className="empty-state">
                  <div className="empty-state-title">暂无报价单</div>
                  <div className="empty-state-hint">在「产品管理」里把货号加入小推车，点「汇总报价」就能生成第一张。</div>
                </td>
              </tr>
            ) : (
              rows.map(q => (
                <tr key={q.id}>
                  <td><strong>{q.quote_no}</strong></td>
                  <td>{q.customer_name || q.customer_company || '—'}</td>
                  <td>{q.quote_date ? new Date(q.quote_date).toLocaleDateString('zh-CN') : '—'}</td>
                  <td>{q.valid_until ? new Date(q.valid_until).toLocaleDateString('zh-CN') : '—'}</td>
                  <td>{q.total_amount ? `${q.currency || 'USD'} ${Number(q.total_amount).toFixed(2)}` : '—'}</td>
                  <td><span className={`status-badge status-${q.status}`}>{statusText(q.status)}</span></td>
                  <td>
                    <button className="btn-link">查看</button>
                    {canEdit && <button className="btn-link">转 PI</button>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default QuoteManagement
