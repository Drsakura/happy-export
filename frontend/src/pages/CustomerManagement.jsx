import React, { useState, useEffect } from 'react'
import axios from 'axios'

function CustomerManagement() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [formData, setFormData] = useState({
    company: '',
    country: '',
    industry: '',
    website: '',
    email: '',
    phone: '',
    notes: ''
  })

  useEffect(() => {
    fetchCustomers()
  }, [])

  const fetchCustomers = async () => {
    try {
      const response = await axios.get('/api/customers')
      setCustomers(response.data)
    } catch (error) {
      console.error('获取客户列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await axios.post('/api/customers', formData)
      setShowAddModal(false)
      setFormData({
        company: '',
        country: '',
        industry: '',
        website: '',
        email: '',
        phone: '',
        notes: ''
      })
      fetchCustomers()
    } catch (error) {
      console.error('创建客户失败:', error)
      alert('创建失败: ' + error.message)
    }
  }

  if (loading) {
    return <div className="loading">加载中...</div>
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">客户管理</h1>
        <button className="btn-primary" onClick={() => setShowAddModal(true)}>
          + 新增客户
        </button>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>公司名称</th>
              <th>国家</th>
              <th>行业</th>
              <th>网站</th>
              <th>联系方式</th>
              <th>负责人</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty-state">暂无客户数据</td>
              </tr>
            ) : (
              customers.map(customer => (
                <tr key={customer.id}>
                  <td><strong>{customer.company}</strong></td>
                  <td>{customer.country || '-'}</td>
                  <td>{customer.industry || '-'}</td>
                  <td>
                    {customer.website ? (
                      <a href={customer.website} target="_blank" rel="noopener noreferrer">
                        {customer.website}
                      </a>
                    ) : '-'}
                  </td>
                  <td>
                    {customer.email && <div>{customer.email}</div>}
                    {customer.phone && <div>{customer.phone}</div>}
                  </td>
                  <td>{customer.owner_name || '-'}</td>
                  <td>
                    <span className={`status-badge status-${customer.status}`}>
                      {customer.status === 'active' ? '活跃' : '非活跃'}
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

      {/* 新增客户模态框 */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>新增客户</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>公司名称 *</label>
                <input
                  type="text"
                  required
                  value={formData.company}
                  onChange={e => setFormData({...formData, company: e.target.value})}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>国家</label>
                  <input
                    type="text"
                    value={formData.country}
                    onChange={e => setFormData({...formData, country: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>行业</label>
                  <input
                    type="text"
                    value={formData.industry}
                    onChange={e => setFormData({...formData, industry: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>网站</label>
                <input
                  type="url"
                  placeholder="https://"
                  value={formData.website}
                  onChange={e => setFormData({...formData, website: e.target.value})}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>邮箱</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                  />
                </div>
                <div className="form-group">
                  <label>电话</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={e => setFormData({...formData, phone: e.target.value})}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>备注</label>
                <textarea
                  rows="3"
                  value={formData.notes}
                  onChange={e => setFormData({...formData, notes: e.target.value})}
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>
                  取消
                </button>
                <button type="submit" className="btn-primary">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default CustomerManagement
