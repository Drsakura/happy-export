import React, { useState, useEffect, useMemo } from 'react'
import axios from 'axios'

/**
 * PI 合同管理（Proforma Invoice）
 * 数据来源：happy 后端 /api/pi-contracts（P1 后端合并阶段开放）
 */
function PiContractManagement() {
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    let alive = true
    axios.get('/api/pi-contracts')
      .then(res => { if (alive) setContracts(Array.isArray(res.data) ? res.data : res.data?.items || []) })
      .catch(() => { if (alive) setContracts([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return contracts
    return contracts.filter(c => [c.pi_no, c.customer_name, c.customer_company].filter(Boolean).join(' ').toLowerCase().includes(kw))
  }, [contracts, keyword])

  const statusText = (s) => ({ draft: '草稿', signed: '已签署', deposited: '已收定金', producing: '生产中', shipped: '已出运', closed: '已结案' }[s] || s || '—')

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">PI 合同管理</h1>
        <button className="btn btn-primary">+ 新建 PI</button>
      </div>

      <div className="toolbar">
        <input
          type="text"
          className="toolbar-search"
          placeholder="搜索 PI 编号 / 客户"
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
              <th>PI 编号</th>
              <th>客户</th>
              <th>签订日期</th>
              <th>金额</th>
              <th>收款条件</th>
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
                  <div className="empty-state-title">暂无 PI 合同</div>
                  <div className="empty-state-hint">PI 合同接口待接入（P1 后端合并阶段开放）</div>
                </td>
              </tr>
            ) : (
              rows.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.pi_no}</strong></td>
                  <td>{c.customer_name || c.customer_company || '—'}</td>
                  <td>{c.signed_date ? new Date(c.signed_date).toLocaleDateString('zh-CN') : '—'}</td>
                  <td>{c.total_amount ? `${c.currency || 'USD'} ${Number(c.total_amount).toFixed(2)}` : '—'}</td>
                  <td>{c.payment_terms || '—'}</td>
                  <td><span className={`status-badge status-${c.status}`}>{statusText(c.status)}</span></td>
                  <td>
                    <button className="btn-link">查看</button>
                    <button className="btn-link">生成单据</button>
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

export default PiContractManagement
