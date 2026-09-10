import React, { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon, ClockIcon } from './Icons'
import {
  TIMEZONES, TIMEZONE_STORAGE_KEY, findTimeZone, formatDateIn, formatOffsetIn, formatTimeIn, readStoredTimeZone
} from '../timezones'

/**
 * 顶栏时钟：显示所选时区的时间，点一下可以换时区。
 *
 * 时间由父组件每秒 tick 后以 now 传入 —— 顶栏本来就在跑秒表，
 * 这里不再自己起一个 interval，避免同一屏里两个定时器各跳各的。
 */
function TimeZoneClock({ now }) {
  const [zoneKey, setZoneKey] = useState(readStoredTimeZone)
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  const listRef = useRef(null)

  const zone = findTimeZone(zoneKey)

  useEffect(() => {
    try { localStorage.setItem(TIMEZONE_STORAGE_KEY, zoneKey) } catch { /* 忽略 */ }
  }, [zoneKey])

  /* 列表比可视区高，打开时滚到当前选中的那一条，否则要自己翻半天找 */
  useEffect(() => {
    if (!open) return
    const active = listRef.current?.querySelector('.clock-zone-item.active')
    active?.scrollIntoView({ block: 'nearest' })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = event => {
      if (!boxRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = event => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const time = formatTimeIn(now, zone.key)
  const date = formatDateIn(now, zone.key)

  return (
    <div className="header-clock" ref={boxRef}>
      <button
        type="button"
        className={`clock-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title={`当前时区：${zone.zone}：${zone.cities} · 点击切换`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <ClockIcon size={17} />
        <span className="clock-zone">{zone.zone}：{zone.cities}</span>
        <ChevronDownIcon size={13} className="clock-caret" />
        <span className="clock-readout">
          <b className="clock-time">{time}</b>
          <em className="clock-date">{date}</em>
        </span>
      </button>

      {open && (
        <div className="clock-pop" role="listbox" aria-label="选择时区">
          <div className="clock-pop-head">客户所在地时间</div>
          <div className="clock-pop-list" ref={listRef}>
            {TIMEZONES.map(item => {
              const active = item.key === zoneKey
              return (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`clock-zone-item${active ? ' active' : ''}`}
                  onClick={() => { setZoneKey(item.key); setOpen(false) }}
                >
                  <span className="clock-zone-name">{item.zone}：{item.cities}</span>
                  <span className="clock-zone-right">
                    <b>{formatTimeIn(now, item.key)}</b>
                    <em>{formatOffsetIn(now, item.key)}</em>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default TimeZoneClock
