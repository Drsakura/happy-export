import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshIcon } from '../components/Icons'

/**
 * SKU 功能嵌入页（整合过渡期方案）。
 *
 * 合并策略是「先嵌后重写」：SKU 的能力先以嵌入方式跑通，
 * 之后再逐步重写为原生 React 页面。
 *
 * 现在嵌入的是独立的 sku-manager 服务(3300)；等后端合并(P1/P2)完成后，
 * 把 SKU_ORIGIN 换成同源子路径(如 /sku)即可，页面组件本身不用动。
 *
 * 外观一体：跨源 iframe 读不到宿主的 CSS 变量，所以由宿主把当前主题下
 * 这些变量的实际取值读出来 postMessage 过去，嵌入页照单贴到自己对应的
 * 变量上（嵌入页侧不含任何宿主变量名，见 sku-manager/public/embed.css）。
 */
const SKU_ORIGIN = import.meta.env.VITE_SKU_ORIGIN || 'http://127.0.0.1:3300'

/**
 * 设计令牌桥：左边是嵌入页的 CSS 变量名，右边是宿主这边的取值来源。
 * 只有这一处维护映射 —— 嵌入页负责结构，宿主负责配色与字体。
 */
const TOKEN_BRIDGE = {
  '--bg': '--bg-primary',            // 卡片底色 = 外壳底色 → 嵌入页"消失"
  '--panel': '--surface',            // 卡片、输入框默认底
  '--panel-2': '--surface-deep',     // 比卡片再深一档：输入框、拖入区
  '--raised': '--surface-hover',     // 悬浮、拖拽经过
  '--line': '--border',
  '--line-soft': '--border-light',
  '--fg': '--text-primary',
  '--fg-dim': '--text-secondary',
  '--fg-mute': '--text-tertiary',
  '--accent': '--primary',
  '--accent-ink': '--primary',
  '--accent-line': '--primary-border',
  '--accent-glow': '--accent-glow',
  '--accent-fill': '--primary-bg',   // 输入框聚焦时的实底
  '--on-accent': '--bg-primary',     // 强调色上的文字：取宿主底色，两种主题都自动是反色
  '--font-display': '--font-body',
  '--font-body': '--font-body',
  '--font-mono': '--font-mono',
  '--r-sm': '--radius-sm',
  '--r-md': '--radius-md'
}

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

function EmbeddedSku({ view = 'search', theme = 'dark' }) {
  const [loaded, setLoaded] = useState(false)
  const frameRef = useRef(null)
  const meta = VIEW_META[view] || VIEW_META.search

  /* src 里的 theme 只当"首帧用哪个主题"的初始值：钉死成首次渲染时的值。
     否则换主题时 React 会改 src，iframe 整页重载白闪一下。 */
  const initialTheme = useRef(theme).current

  const pushTheme = useCallback(() => {
    const frame = frameRef.current
    if (!frame?.contentWindow) return
    const computed = window.getComputedStyle(document.documentElement)
    const vars = {}
    Object.entries(TOKEN_BRIDGE).forEach(([skuVar, hostVar]) => {
      const value = computed.getPropertyValue(hostVar).trim()
      /* 宿主改了变量名而这里没跟上时，嵌入页会悄悄回落到自己的旧配色 ——
         必须喊出来，否则要对着截图猜半天。 */
      if (!value) console.warn(`[embed] 宿主找不到变量 ${hostVar}，嵌入页的 ${skuVar} 将回落默认值`)
      vars[skuVar] = value
    })
    frame.contentWindow.postMessage({ type: 'happy:embed', theme, vars }, '*')
  }, [theme])

  useEffect(() => {
    if (!loaded) return undefined
    /* 放到下一个宏任务：App 是在自己的 effect 里才把 data-theme 写到 <html> 上，
       而子组件的 effect 先于父组件执行，此刻读到的还是上一个主题的令牌。 */
    const id = window.setTimeout(pushTheme, 0)
    return () => window.clearTimeout(id)
  }, [loaded, pushTheme])

  const reload = () => {
    setLoaded(false)
    frameRef.current?.contentWindow?.location.reload()
  }

  const src = `${SKU_ORIGIN}/?embed=1&view=${encodeURIComponent(view)}&theme=${initialTheme}`

  return (
    <div className="page-container embed-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">{meta.title}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '6px' }}>
            {meta.sub}
          </p>
        </div>
        <button type="button" className="embed-refresh" onClick={reload} title="重新加载" aria-label="重新加载">
          <RefreshIcon size={16} />
        </button>
      </div>

      <div className="embed-frame">
        {!loaded && (
          <div className="loading" style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
            <div className="spinner"></div>
            <span style={{ marginLeft: '12px' }}>正在加载{meta.title}…</span>
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
