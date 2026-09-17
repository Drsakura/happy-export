import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { CalculatorIcon, ChevronDownIcon, RefreshIcon, SwapIcon } from './Icons'
import CurrencyFlag from './CurrencyFlag'
import {
  buildPrimaryCurrencyOptions, crossRate, currencyLabel, formatAmount, formatRate, parseAmount
} from '../currencies'
import { amountToWords } from '../amountInWords'

const DEFAULT_FROM = 'USD'
const DEFAULT_TO = 'CNY'
const PAIR_STORAGE_KEY = 'happy.fxPair'
/** 面板开着时的自动刷新间隔（后端本身也有 1 小时缓存，这里只是保证长开着不会太旧）。 */
const AUTO_REFRESH_MS = 30 * 60 * 1000

function readStoredPair() {
  try {
    const raw = JSON.parse(localStorage.getItem(PAIR_STORAGE_KEY) || 'null')
    if (raw && /^[A-Z]{3}$/.test(raw.from) && /^[A-Z]{3}$/.test(raw.to)) return raw
  } catch { /* 用默认值 */ }
  return { from: DEFAULT_FROM, to: DEFAULT_TO }
}

/* ------------------------------------------------------------------ */
/* 币种选择器：面板内两侧各一个，带搜索                                   */
/* ------------------------------------------------------------------ */
function CurrencyPicker({ value, options, onChange, align }) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const boxRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) { setKeyword(''); return }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    const onPointerDown = event => {
      if (!boxRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => { window.clearTimeout(timer); document.removeEventListener('mousedown', onPointerDown) }
  }, [open])

  const filtered = useMemo(() => {
    const term = keyword.trim().toUpperCase()
    if (!term) return options
    const raw = keyword.trim()
    return options.filter(item =>
      item.code.includes(term)
      || (item.name && item.name.includes(raw))
      || (item.region && item.region.includes(raw))
    )
  }, [options, keyword])

  const labelOf = item => `${item.code} ${item.name}${item.region ? ` · ${item.region}` : ''}`

  return (
    <div className={`fx-picker ${align}`} ref={boxRef}>
      <button
        type="button"
        className={`fx-picker-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title={currencyLabel(value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CurrencyFlag code={value} width={20} />
        <b>{value}</b>
        <span>{currencyLabel(value).slice(4) || '—'}</span>
        <ChevronDownIcon size={13} />
      </button>
      {open && (
        <div className="fx-picker-pop">
          <input
            ref={inputRef}
            type="text"
            className="fx-picker-search"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="搜索币种 / 代码"
            aria-label="搜索币种"
          />
          <div className="fx-picker-list" role="listbox">
            {filtered.length === 0
              ? <div className="fx-picker-empty">没有匹配的币种</div>
              : filtered.map(item => (
                <button
                  key={item.code}
                  type="button"
                  role="option"
                  aria-selected={item.code === value}
                  title={labelOf(item)}
                  className={`fx-picker-item${item.code === value ? ' active' : ''}`}
                  onClick={() => { onChange(item.code); setOpen(false) }}
                >
                  <CurrencyFlag code={item.code} width={20} />
                  <b>{item.code}</b>
                  <span>{item.name || '—'}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 汇率计算器                                                          */
/* ------------------------------------------------------------------ */
function FxCalculator() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('idle')   // idle | loading | ready | error
  const [rates, setRates] = useState(null)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState('')
  const [pair, setPair] = useState(readStoredPair)
  /* 只存「用户正在输入的那一侧」的原始文本，另一侧永远是算出来的。
     这样不存在两个输入框互相改、改出抖动的可能。 */
  const [entry, setEntry] = useState({ value: '1000', side: 'from' })
  const [copied, setCopied] = useState(false)

  const panelRef = useRef(null)
  const loadedRef = useRef(false)

  const { from, to } = pair

  const loadRates = useCallback(async force => {
    setStatus(prev => (prev === 'ready' ? prev : 'loading'))
    try {
      const response = await axios.get('/api/fx/rates', { params: force ? { force: 1 } : {} })
      const data = response.data || {}
      if (!data.ok || !data.rates) throw new Error(data.error || '汇率数据不可用')
      setRates(data.rates)
      setMeta({
        source: data.sourceLabel || data.source || '',
        updatedAt: data.updatedAt,
        stale: !!data.stale,
        warning: data.warning || ''
      })
      setError('')
      setStatus('ready')
    } catch (err) {
      setError(err.response?.data?.error || err.message || '获取汇率失败')
      setStatus(prev => (rates ? 'ready' : 'error'))
    }
  }, [rates])

  /* 首次展开才去取数 —— 没打开过的用户不该为这个功能付一次请求。 */
  useEffect(() => {
    if (!open || loadedRef.current) return
    loadedRef.current = true
    loadRates(false)
  }, [open, loadRates])

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => loadRates(true), AUTO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [open, loadRates])

  /* 点面板外或按 Esc 关闭 */
  useEffect(() => {
    if (!open) return
    const onPointerDown = event => {
      if (!panelRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = event => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    try { localStorage.setItem(PAIR_STORAGE_KEY, JSON.stringify(pair)) } catch { /* 忽略 */ }
  }, [pair])

  /* 只给主流 13 种币种（见 currencies.js 的 PRIMARY_CURRENCIES），不跟随接口的全量列表 */
  const options = useMemo(() => buildPrimaryCurrencyOptions(), [])
  const rate = crossRate(rates, from, to)          // 1 from = ? to
  const inverse = crossRate(rates, to, from)       // 1 to  = ? from
  const num = parseAmount(entry.value)

  const fromDisplay = entry.side === 'from'
    ? entry.value
    : (num !== null && rate ? formatAmount(num / rate) : '')
  const toDisplay = entry.side === 'to'
    ? entry.value
    : (num !== null && rate ? formatAmount(num * rate) : '')

  /* 换币种时锁住「那一侧现在的数字」——符合直觉：1000 美元换成 1000 欧元的输入，
     再按新汇率算出右边。 */
  const changeFrom = code => {
    if (code === from) return
    const keep = fromDisplay
    setPair(cur => ({ ...cur, from: code }))
    setEntry({ value: keep, side: 'from' })
  }
  const changeTo = code => {
    if (code === to) return
    const keep = toDisplay
    setPair(cur => ({ ...cur, to: code }))
    setEntry({ value: keep, side: 'to' })
  }
  /* 互换：把右边的结果挪到左边，换算关系保持不变 */
  const swap = () => {
    setPair(cur => ({ from: cur.to, to: cur.from }))
    setEntry({ value: toDisplay, side: 'from' })
  }

  const updatedLabel = meta?.updatedAt
    ? new Date(meta.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''

  /* 英文大写金额跟随左侧（from）的金额与币种 —— 单证上写的就是报价币种那一侧 */
  const words = useMemo(() => {
    const value = parseAmount(fromDisplay)
    return value === null ? '' : amountToWords(value, from)
  }, [fromDisplay, from])

  const copyWords = async () => {
    if (!words) return
    try {
      await navigator.clipboard.writeText(words)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* 剪贴板不可用（非安全上下文等）时不打断使用，手动选中也能复制 */
    }
  }

  return (
    <div className="fx-calc" ref={panelRef}>
      <button
        type="button"
        className={`header-tool-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="汇率计算器"
        aria-label="汇率计算器"
        aria-expanded={open}
      >
        <CalculatorIcon size={19} />
      </button>

      {open && (
        <div className="fx-panel" role="dialog" aria-label="汇率计算器">
          <div className="fx-panel-head">
            <span className="fx-panel-title"><CalculatorIcon size={16} /> 汇率换算</span>
            <button
              type="button"
              className="fx-refresh"
              onClick={() => loadRates(true)}
              disabled={status === 'loading'}
              title="刷新汇率"
              aria-label="刷新汇率"
            >
              <RefreshIcon size={15} />
            </button>
          </div>

          <div className="fx-panel-body">
            <div className="fx-side">
              <input
                type="text"
                inputMode="decimal"
                className="fx-amount"
                value={fromDisplay}
                onChange={event => setEntry({ value: event.target.value, side: 'from' })}
                placeholder="0"
                aria-label={`金额（${from}）`}
              />
              <CurrencyPicker value={from} options={options} onChange={changeFrom} align="left" />
            </div>

            <button type="button" className="fx-swap" onClick={swap} title="互换货币" aria-label="互换货币">
              <SwapIcon size={16} />
            </button>

            <div className="fx-side">
              <input
                type="text"
                inputMode="decimal"
                className="fx-amount"
                value={toDisplay}
                onChange={event => setEntry({ value: event.target.value, side: 'to' })}
                placeholder="0"
                aria-label={`金额（${to}）`}
              />
              <CurrencyPicker value={to} options={options} onChange={changeTo} align="right" />
            </div>
          </div>

          <div className="fx-rate-line">
            {status === 'loading' && !rates
              ? '正在获取最新汇率…'
              : status === 'error'
                ? <span className="fx-error">{error}</span>
                : rate
                  ? <>1 {from} = <b>{formatRate(rate)}</b> {to}<em>· 1 {to} = {formatRate(inverse)} {from}</em></>
                  : '—'}
          </div>

          <div className="fx-words">
            <div className="fx-words-head">
              <span className="fx-words-label">英文大写金额</span>
              {words && (
                <button type="button" className="fx-copy" onClick={copyWords}>
                  {copied ? '已复制' : '复制'}
                </button>
              )}
            </div>
            <p className={`fx-words-text${words ? '' : ' is-empty'}`}>
              {words || '在左侧输入金额后自动生成'}
            </p>
          </div>

          <div className="fx-panel-foot">
            {meta?.warning
              ? <span className="fx-warn">{meta.warning}</span>
              : <span>数据源 {meta?.source || '—'}{updatedLabel ? ` · ${updatedLabel} 更新` : ''}{meta?.stale ? '（已过期）' : ''}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default FxCalculator
