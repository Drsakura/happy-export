import React, { useState } from 'react'

function ProspectManagement() {
  const [formData, setFormData] = useState({
    productKeywords: '',
    countries: '',
    customerTypes: '',
    excludeKeywords: '',
    resultLimit: 100
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    alert('自动获客功能开发中...')
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">新客开发（自动获客）</h1>
      </div>

      <div className="prospect-container">
        {/* 搜索条件 */}
        <div className="card">
          <h2>搜索条件</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>产品关键词</label>
              <input
                type="text"
                placeholder="如：LED灯具, 五金工具"
                value={formData.productKeywords}
                onChange={e => setFormData({...formData, productKeywords: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label>目标国家</label>
              <input
                type="text"
                placeholder="如：德国, 英国, 美国"
                value={formData.countries}
                onChange={e => setFormData({...formData, countries: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label>客户类型</label>
              <input
                type="text"
                placeholder="如：经销商, 系统集成商, OEM"
                value={formData.customerTypes}
                onChange={e => setFormData({...formData, customerTypes: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label>排除关键词</label>
              <input
                type="text"
                placeholder="如：招聘, 二手, 学校"
                value={formData.excludeKeywords}
                onChange={e => setFormData({...formData, excludeKeywords: e.target.value})}
              />
            </div>

            <div className="form-group">
              <label>结果数量</label>
              <input
                type="number"
                value={formData.resultLimit}
                onChange={e => setFormData({...formData, resultLimit: e.target.value})}
              />
            </div>

            <button type="submit" className="btn-primary">
              开始搜索
            </button>
          </form>
        </div>

        {/* 搜索结果 */}
        <div className="card">
          <h2>搜索结果</h2>
          <div className="empty-state">
            请配置搜索条件并点击"开始搜索"
          </div>
        </div>
      </div>

      <div className="info-box">
        <h3>功能说明</h3>
        <p>自动获客功能将帮助你从多个数据源自动搜索潜在客户：</p>
        <ul>
          <li>公开公司注册数据（GLEIF、Companies House）</li>
          <li>网页搜索引擎</li>
          <li>AI 智能解析和评分</li>
          <li>自动去重和质量过滤</li>
        </ul>
        <p><strong>此功能将在后续版本中完善。</strong></p>
      </div>
    </div>
  )
}

export default ProspectManagement

