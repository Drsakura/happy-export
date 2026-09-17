import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SearchIcon, ChevronDownIcon, CloseIcon } from './Icons'

/**
 * 可搜索下拉（combobox）
 *
 * 供应商 272 家、产品 300+ 个，原生 <select> 只能一格一格滚。这里把触发区做成
 * 一个搜索框：点开就能打字，候选实时收窄，↑↓ 选择、回车确认、Esc 收起。
 *
 * 实现要点：
 * - 菜单用 createPortal 挂到 body + position:fixed —— 抽屉的 .drawer-body 是
 *   overflow:auto，就地绝对定位会被它裁掉；fixed 还能跟着滚动/缩放重新定位。
 * - 触发区沿用全局「无方框」输入框规则：靠底色区分，不做描边与聚焦光环。
 * - 展开时按实时位置决定朝上还是朝下弹，空间不够就压 max-height 自身滚动。
 *
 * props
 *   value / onChange(value, option)
 *   options      [{ value, label, hint? }]，hint 显示在右侧（灰）
 *   placeholder  未选中时的提示
 *   searchPlaceholder 展开后的提示
 *   emptyText    无匹配时的文案
 *   size         'md'(38px) | 'sm'(32px)
 *   clearable    选中后是否给出清除按钮
 */

const MENU_MAX = 268
const GAP = 6

function SearchSelect({
  value,
  onChange,
  options = [],
  placeholder = '请选择',
  searchPlaceholder = '输入关键词搜索…',
  emptyText = '没有匹配项',
  size = 'md',
  disabled = false,
  clearable = false,
  style,
  className = ''
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState(null)

  const rootRef = useRef(null)
  const menuRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const selected = useMemo(
    () => options.find((o) => String(o.value) === String(value ?? '')) || null,
    [options, value]
  )

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase()
    if (!kw) return options
    return options.filter((o) => `${o.label || ''} ${o.hint || ''}`.toLowerCase().includes(kw))
  }, [options, query])

  /* 按触发区的实时位置定位菜单：下方空间不够就翻到上面 */
  const place = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom - GAP - 8
    const spaceAbove = r.top - GAP - 8
    const up = spaceBelow < 180 && spaceAbove > spaceBelow
    setPos({
      left: r.left,
      width: r.width,
      top: up ? undefined : r.bottom + GAP,
      bottom: up ? window.innerHeight - r.top + GAP : undefined,
      maxHeight: Math.max(120, Math.min(MENU_MAX, up ? spaceAbove : spaceBelow))
    })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  const openMenu = useCallback(() => {
    if (disabled || open) return
    place()
    setQuery('')
    const idx = options.findIndex((o) => String(o.value) === String(value ?? ''))
    setActive(idx >= 0 ? idx : 0)
    setOpen(true)
  }, [disabled, open, options, place, value])

  const pick = useCallback((option) => {
    onChange?.(option.value, option)
    setOpen(false)
    setQuery('')
  }, [onChange])

  /* 展开期间：点外部收起、滚动/缩放时跟住触发区 */
  useEffect(() => {
    if (!open) return
    const onDocDown = (e) => {
      if (rootRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      close()
    }
    const onReflow = () => place()
    document.addEventListener('mousedown', onDocDown)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [open, close, place])

  /* 键盘走到看不见的项时，把它滚进视野 */
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector('.ss-opt.is-active')
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const onKeyDown = (e) => {
    // Esc 只收候选：必须拦住，否则抽屉/浮层的全局 Esc 会顺手把整层关掉
    if (e.key === 'Escape') { e.stopPropagation(); close(); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { openMenu(); return }
      if (filtered.length === 0) return
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1
        return (next + filtered.length) % filtered.length
      })
      return
    }
    if (e.key === 'Enter') {
      if (!open) return
      e.preventDefault()
      const option = filtered[active]
      if (option) pick(option)
    }
  }

  const showClear = clearable && !disabled && selected

  return (
    <div
      ref={rootRef}
      className={`ss-root ss-${size}${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      onMouseDown={(e) => {
        if (disabled) return
        if (e.target.closest('.ss-clear')) return
        if (inputRef.current && document.activeElement !== inputRef.current) inputRef.current.focus()
        if (!open) openMenu()
      }}
      // mousedown 之外再兜一层 click：真实鼠标两者都会来（第二次是 no-op），
      // 但程序化 el.click() / 触摸设备只发 click，不补这层会「点了没反应」
      onClick={() => { if (!open) openMenu() }}
    >
      <span className="ss-icon" aria-hidden="true"><SearchIcon size={size === 'sm' ? 13 : 14} /></span>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : (selected?.label || '')}
        placeholder={open ? searchPlaceholder : placeholder}
        readOnly={!open}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(e) => { setQuery(e.target.value); setActive(0) }}
        onFocus={openMenu}
        onKeyDown={onKeyDown}
      />
      {showClear && (
        <button
          type="button"
          className="ss-clear"
          title="清除"
          aria-label="清除"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onChange?.('', null); setQuery(''); inputRef.current?.focus() }}
        >
          <CloseIcon size={12} />
        </button>
      )}
      <span className={`ss-caret${open ? ' is-up' : ''}`} aria-hidden="true"><ChevronDownIcon size={13} /></span>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="ss-menu"
          role="listbox"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
        >
          {filtered.length === 0 ? (
            <div className="ss-empty">{emptyText}</div>
          ) : (
            <div ref={listRef}>
              {filtered.map((o, i) => (
                <div
                  key={String(o.value)}
                  role="option"
                  aria-selected={i === active}
                  className={`ss-opt${i === active ? ' is-active' : ''}${selected && String(o.value) === String(value ?? '') ? ' is-selected' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(o) }}
                  onClick={() => pick(o)}
                >
                  <span className="ss-label">{o.label}</span>
                  {o.hint != null && o.hint !== '' && <span className="ss-hint">{o.hint}</span>}
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

/**
 * 列表上方的内联搜索框：用于「列表本身」的即时过滤（供应商详情的供货清单、
 * 产品详情里的货号表这类）。和 SearchSelect 同一套外观语言。
 */
export function SearchField({ value, onChange, placeholder = '搜索…', size = 'md', style, className = '' }) {
  return (
    <div className={`sf-root sf-${size}${className ? ` ${className}` : ''}`} style={style}>
      <span className="ss-icon" aria-hidden="true"><SearchIcon size={size === 'sm' ? 13 : 14} /></span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      {value !== '' && value != null && (
        <button
          type="button"
          className="ss-clear"
          title="清除"
          aria-label="清除"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
        >
          <CloseIcon size={12} />
        </button>
      )}
    </div>
  )
}

export default SearchSelect
