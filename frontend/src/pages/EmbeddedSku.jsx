import React, { useState, useRef } from 'react'

/**
 * SKU 功能嵌入页（整合过渡期方案）。
 *
 * 合并策略是「先嵌后重写」：SKU 的能力先以嵌入方式跑通，
 * 之后再逐步重写为原生 React 页面。
 *
 * 现在嵌入的是独立的 sku-manager 服务(3300)；等后端合并(P1/P2)完成后，
 * 把 SKU_ORIGIN 换成同源子路径(如 /sku)即可，页面组件本身不用动。
 */
const SKU_ORIGIN = import.meta.env.VITE_SKU_ORIGIN || 'http://127.0.0.1:3300'

const VIEW_META = {
  search: {
    title: '产品管理',
    sub: '按货号、品名、规格、材质或参数检索产品与采购价'
  },
  suppliers: {
    title: '供应商管理',
    sub: '供应商档案、联系方式、工厂所在地与主营类目'
  },
  import: {
    title: '合同导入',
    sub: '批量导入采购合同，自动解析价格、产品与参数'
  }
}

function EmbeddedSku({ view = 'search' }) {
  const [loaded, setLoaded] = useState(false)
  const frameRef = useRef(null)
  const meta = VIEW_META[view] || VIEW_META.search
  const src = `${SKU_ORIGIN}/?embed=1&view=${encodeURIComponent(view)}`

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">{meta.title}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '6px' }}>
            {meta.sub}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" onClick={() => frameRef.current?.contentWindow?.location.reload()}>
            刷新
          </button>
          <a className="btn btn-sm" href={src} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            新窗口打开
          </a>
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          height: 'calc(100vh - 210px)',
          minHeight: '560px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          background: 'var(--surface)'
        }}
      >
        {!loaded && (
          <div className="loading" style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
            <div className="spinner"></div>
            <span style={{ marginLeft: '12px' }}>正在加载 SKU 模块…</span>
          </div>
        )}
        <iframe
          ref={frameRef}
          title={meta.title}
          src={src}
          onLoad={() => setLoaded(true)}
          allow="clipboard-write"
          style={{
            width: '100%',
            height: '100%',
            border: 0,
            display: 'block',
            opacity: loaded ? 1 : 0,
            transition: 'opacity .18s ease'
          }}
        />
      </div>
    </div>
  )
}

export default EmbeddedSku
