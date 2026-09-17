import React, { useEffect } from 'react'
import { CloseIcon } from './Icons'

/**
 * 右侧抽屉。产品页原本各自内联了一份同样的结构，这里抽出来给新页面复用，
 * 保持「遮罩点击关闭 / Esc 关闭 / 正文独立滚动」三件事的行为一致。
 */
function Drawer({ title, sub, onClose, children, footer, wide = false }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className={`drawer${wide ? ' drawer-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-header">
          <div className="drawer-head-main">
            <h2 className="drawer-title">{title}</h2>
            {sub && <p className="drawer-sub">{sub}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><CloseIcon size={16} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </aside>
    </>
  )
}

export default Drawer
