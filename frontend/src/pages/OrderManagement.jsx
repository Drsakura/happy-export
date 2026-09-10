import React, { useState, useEffect } from 'react'
import axios from 'axios'

function OrderManagement() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchOrders()
  }, [])

  const fetchOrders = async () => {
    try {
      const response = await axios.get('/api/orders')
      setOrders(response.data)
    } catch (error) {
      console.error('获取订单列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusText = (status) => {
    const statusMap = {
      draft: '草稿',
      confirmed: '已确认',
      production: '生产中',
      shipped: '已发货',
      completed: '已完成',
      cancelled: '已取消'
    }
    return statusMap[status] || status
  }

  if (loading) {
    return <div className="loading">加载中...</div>
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">订单管理</h1>
        <button className="btn-primary">+ 新建订单</button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户</th>
              <th>订单日期</th>
              <th>交货日期</th>
              <th>金额</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan="7" className="empty-state">暂无订单数据</td>
              </tr>
            ) : (
              orders.map(order => (
                <tr key={order.id}>
                  <td><strong>{order.order_no}</strong></td>
                  <td>{order.customer_name}</td>
                  <td>{new Date(order.order_date).toLocaleDateString('zh-CN')}</td>
                  <td>
                    {order.delivery_date
                      ? new Date(order.delivery_date).toLocaleDateString('zh-CN')
                      : '-'}
                  </td>
                  <td>
                    {order.total_amount
                      ? `${order.currency} ${order.total_amount.toFixed(2)}`
                      : '-'}
                  </td>
                  <td>
                    <span className={`status-badge status-${order.status}`}>
                      {getStatusText(order.status)}
                    </span>
                  </td>
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

export default OrderManagement
