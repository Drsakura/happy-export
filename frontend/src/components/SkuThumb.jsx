import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import axios from 'axios'
import { ImageIcon } from './Icons'

/**
 * 货号缩略图 + 鼠标悬浮预览。
 *
 * 图片来自 happy 后端（4300）的 /product-images/*，同源访问，已无独立 SKU 服务。
 * 图片挂在**产品组**上（不是每个货号一张），所以同一个组里的货号会共享同一张主图。
 */

export const thumbSrc = filename => (filename ? `/product-images/${encodeURIComponent(filename)}` : '')

const PREVIEW_WIDTH = 268
const PREVIEW_HEIGHT = 268

/**
 * @param {string} sku      货号（用于预览卡上的标注）
 * @param {string} filename 图片文件名（不带路径）
 * @param {number} size     缩略图边长
 * @param {boolean} preview 是否开启悬浮预览
 */
export function SkuThumb({ sku, filename, size = 34, preview = true, className = '' }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState(null)
  const anchorRef = useRef(null)
  const src = thumbSrc(filename)

  /* 预览是 fixed 浮层：滚动或改变视口就收起，免得悬在错位的半空中 */
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const show = () => {
    const element = anchorRef.current
    if (!element || !src) return
    const rect = element.getBoundingClientRect()
    let left = rect.right + 14
    if (left + PREVIEW_WIDTH > window.innerWidth - 12) {
      left = Math.max(12, rect.left - PREVIEW_WIDTH - 14)
    }
    let top = rect.top + rect.height / 2 - PREVIEW_HEIGHT / 2
    top = Math.max(12, Math.min(top, window.innerHeight - PREVIEW_HEIGHT - 12))
    setPosition({ left, top })
    setOpen(true)
  }

  return (
    <>
      <span
        ref={anchorRef}
        className={`sku-thumb${src ? '' : ' is-empty'}${className ? ' ' + className : ''}`}
        style={{ width: size, height: size }}
        onMouseEnter={preview && src ? show : undefined}
        onMouseLeave={preview ? () => setOpen(false) : undefined}
        title={sku ? `货号 ${sku}` : undefined}
      >
        {src
          ? <img src={src} alt="" loading="lazy" />
          : <ImageIcon size={Math.max(13, Math.round(size * 0.42))} />}
      </span>
      {open && position && createPortal(
        <span className="sku-thumb-preview" style={{ left: position.left, top: position.top }}>
          <img src={src} alt="" />
          {sku ? <b>{sku}</b> : null}
        </span>,
        document.body
      )}
    </>
  )
}

/**
 * 批量取货号缩略图。
 * 只关心「货号 → 文件名」这一层映射，一次请求拿一批，避免每个货号打一次接口。
 */
export function useSkuThumbs(skus) {
  const [map, setMap] = useState({})
  const key = useMemo(
    () => [...new Set((skus || []).filter(Boolean).map(item => String(item)))].sort().join(','),
    [skus]
  )

  useEffect(() => {
    if (!key) { setMap({}); return }
    let alive = true
    axios.get('/api/sku/thumbs', { params: { skus: key } })
      .then(({ data }) => { if (alive) setMap(data?.thumbs || {}) })
      .catch(() => { if (alive) setMap({}) })
    return () => { alive = false }
  }, [key])

  return map
}

export default SkuThumb
