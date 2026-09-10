import React, { useState, useEffect, useMemo } from 'react'
import axios from 'axios'

/**
 * 采购单管理
 * 数据来源：happy 后端 /api/purchase-orders（P1 后端合并阶段开放）
 */
function PurchaseOrderManagement() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    let alive = true
    axios.get('/api/purchase-orders')
      .then(res => { if (alive) setOrders(Array.isArray(res.data) ? res.data : res.data?.items || []) })
      .catch(() => { if (alive) setOrders([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return orders
    return orders.filter(o => [o.po_no, o.supplier_name].filter(Boolean).join(' ').toLowerCase().includes(kw))
  }, [orders, keyword])

  const statusText = (s) => ({ draft: '草稿', issued: '已下达', received: '已收货', partial: '部分到货', closed: '已关闭', cancelled: '已取消' }[s] || s || '—')

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">采购单管理</h1>
        <button className="btn btn-primary">+ 新建采购单</button>
      </div>

      <div className="toolbar">
        <input
          type="text"
          className="toolbar-search"
          placeholder="搜索采购单号 / 供应商"
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
              <th>采购单号</th>
              <th>供应商</th>
              <th>下单日期</th>
              <th>预计交期</th>
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
                  <div className="empty-state-title">暂无采购单</div>
                  <div className="empty-state-hint">采购单接口待接入（P1 后端合并阶段开放）</div>
                </td>
              </tr>
            ) : (
              rows.map(o => (
                <tr key={o.id}>
                  <td><strong>{o.po_no}</strong></td>
                  <td>{o.supplier_name || '—'}</td>
                  <td>{o.order_date ? new Date(o.order_date).toLocaleDateString('zh-CN') : '—'}</td>
                  <td>{o.expected_date ? new Date(o.expected_date).toLocaleDateString('zh-CN') : '—'}</td>
                  <td>{o.total_amount ? `${o.currency || 'CNY'} ${Number(o.total_amount).toFixed(2)}` : '—'}</td>
                  <td><span className={`status-badge status-${o.status}`}>{statusText(o.status)}</span></td>
                  <td>
                    <button className="btn-link">查看</button>
                    <button className="btn-link">编辑</button>
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

export default PurchaseOrderManagement
