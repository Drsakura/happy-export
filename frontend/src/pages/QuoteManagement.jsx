import React, { useState, useEffect, useMemo } from 'react'
import axios from 'axios'

/**
 * 客户报价单管理
 * 数据来源：happy 后端 /api/quotes（P1 后端合并阶段开放）
 * 未接入前保持可用的空态，不做假数据。
 */
function QuoteManagement() {
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
        <button className="btn btn-primary">+ 新建报价单</button>
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
              <tr><td colSpan="7" className="empty-state">加载中...</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan="7" className="empty-state">
                  <div className="empty-state-title">暂无报价单</div>
                  <div className="empty-state-hint">报价单接口待接入（P1 后端合并阶段开放）</div>
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
                    <button className="btn-link">转 PI</button>
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
