import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

/**
 * 年月拨盘（iOS 闹钟式滚轮）
 * - 两列各自滚动吸附，停稳后把最终值抛给父级（onChange）
 * - 支持鼠标滚轮 / 触摸板 / 按住拖动；点某一行直接跳到该行
 * - 外部值变化时反向同步滚动位置（且不会打回环）
 */

const ITEM_HEIGHT = 32 // 与 luxury.css 的 --wheel-item 保持一致
const SETTLE_DELAY = 140

function WheelColumn({ values, value, onSettle, format, ariaLabel }) {
  const listRef = useRef(null)
  const timerRef = useRef(null)
  const dragRef = useRef(null)
  const frameRef = useRef(0)
  const muteRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const index = Math.max(0, values.indexOf(value))
  const [centered, setCentered] = useState(index)

  // 滚动过程中实时算出居中那一行，用来做 iOS 拨盘那样的放大/淡出
  const syncCentered = useCallback(() => {
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = window.requestAnimationFrame(() => {
      const node = listRef.current
      if (!node) return
      setCentered(Math.min(values.length - 1, Math.max(0, Math.round(node.scrollTop / ITEM_HEIGHT))))
    })
  }, [values.length])

  const snapTo = useCallback((target, behavior) => {
    const node = listRef.current
    if (!node) return
    if (Math.abs(node.scrollTop - target) < 1) return
    muteRef.current = true
    node.scrollTo({ top: target, behavior })
    window.setTimeout(() => { muteRef.current = false }, behavior === 'smooth' ? 340 : 60)
  }, [])

  // 外部值变了（含父级纠正）就把滚轮挪到对应行
  useLayoutEffect(() => {
    snapTo(index * ITEM_HEIGHT, 'auto')
  }, [index, snapTo])

  // 值变化（含外部纠正）后，让居中高亮跟过来
  useLayoutEffect(() => {
    setCentered(index)
  }, [index])

  const settle = useCallback(() => {
    const node = listRef.current
    if (!node) return
    const next = Math.min(values.length - 1, Math.max(0, Math.round(node.scrollTop / ITEM_HEIGHT)))
    if (values[next] !== value) onSettle(values[next])
    snapTo(next * ITEM_HEIGHT, 'smooth')
  }, [onSettle, snapTo, value, values])

  const handleScroll = () => {
    if (muteRef.current || dragRef.current) return
    syncCentered()
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(settle, SETTLE_DELAY)
  }

  useEffect(() => () => {
    window.clearTimeout(timerRef.current)
    window.cancelAnimationFrame(frameRef.current)
  }, [])

  const onPointerDown = (event) => {
    const node = listRef.current
    if (!node || event.button > 0) return
    window.clearTimeout(timerRef.current)
    dragRef.current = { startY: event.clientY, startTop: node.scrollTop, moved: false }
    setDragging(true)
    try { node.setPointerCapture(event.pointerId) } catch { /* 忽略不支持捕获的浏览器 */ }
  }

  const onPointerMove = (event) => {
    if (!dragRef.current) return
    const node = listRef.current
    if (!node) return
    const delta = event.clientY - dragRef.current.startY
    if (Math.abs(delta) > 3) dragRef.current.moved = true
    node.scrollTop = dragRef.current.startTop - delta
    syncCentered()
  }

  const endDrag = () => {
    if (!dragRef.current) return
    const moved = dragRef.current.moved
    dragRef.current = null
    setDragging(false)
    if (moved) settle()
  }

  return (
    <div className="ymw-col" role="group" aria-label={ariaLabel}>
      <div
        className={`ymw-list${dragging ? ' is-dragging' : ''}`}
        ref={listRef}
        onScroll={handleScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="ymw-pad" aria-hidden="true" />
        {values.map((item, position) => {
          const distance = Math.abs(position - centered)
          return (
            <button
              type="button"
              key={item}
              className={`ymw-cell${distance === 0 ? ' is-active' : ''}`}
              style={{
                transform: `scale(${distance === 0 ? 1 : distance === 1 ? 0.92 : 0.84})`,
                opacity: distance === 0 ? 1 : distance === 1 ? 0.7 : 0.38
              }}
              tabIndex={-1}
              onClick={() => onSettle(item)}
            >
              {format(item)}
            </button>
          )
        })}
        <div className="ymw-pad" aria-hidden="true" />
      </div>
    </div>
  )
}

export default function MonthYearWheel({ year, month, onChange, onToday, minYear, maxYear }) {
  const years = useMemo(() => {
    const list = []
    for (let y = minYear; y <= maxYear; y += 1) list.push(y)
    return list
  }, [minYear, maxYear])
  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => index + 1), [])

  // 两列可能在同一帧内先后停稳，各自只认自己那一列时不能读渲染期闭包，
  // 否则后一次会用旧值覆盖前一次（滚到 2028年12月 会退回 2026年12月）。
  const latest = useRef({ year, month })
  latest.current = { year, month }

  const pickYear = useCallback((nextYear) => {
    latest.current = { ...latest.current, year: nextYear }
    onChange(latest.current.year, latest.current.month)
  }, [onChange])

  const pickMonth = useCallback((nextMonth) => {
    latest.current = { ...latest.current, month: nextMonth }
    onChange(latest.current.year, latest.current.month)
  }, [onChange])

  return (
    <div className="ymw-body">
      <div className="ymw-drum">
        <span className="ymw-highlight" aria-hidden="true" />
        <WheelColumn values={years} value={year} onSettle={pickYear} format={item => `${item}`} ariaLabel="年份" />
        <span className="ymw-unit">年</span>
        <WheelColumn values={months} value={month} onSettle={pickMonth} format={item => `${item}`} ariaLabel="月份" />
        <span className="ymw-unit">月</span>
      </div>
      <button type="button" className="ymw-today" onClick={onToday}>回到今天</button>
    </div>
  )
}
