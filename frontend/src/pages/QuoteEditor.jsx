import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeftIcon, CartIcon, CheckIcon, CloseIcon, PlusCircleIcon, QuoteIcon, SearchIcon, UsersIcon
} from '../components/Icons'
import { buildCurrencyOptions, crossRate, currencyLabel, formatRate, parseAmount } from '../currencies'
import { SkuThumb } from '../components/SkuThumb'
import { useAuth, hasPermission } from '../auth'

/**
 * 汇总报价 —— 把小推车里的货号变成一张正式报价单。
 *
 * 页面顺序刻意做成「先客户、后货、再条款」：
 * 报价单是发给客户的凭证，抬头必须先立住（公司、地址、联系方式），
 * 后面所有条款都是围绕这个抬头展开的。
 *
 * 单价口径与询盘报价完全一致：采购价 ÷ 汇率 × (1 + 加价率)，
 * 汇率是「1 报价币 = ? 采购币(CNY)」。不要在这里另立一套算法。
 */

const API = '/api'
const SKU_API = '/api/sku'

function today() {
  return new Date().toISOString().slice(0, 10)
}
/** 从某个日期键（YYYY-MM-DD）往后推 n 天 */
function addDays(dateKey, days) {
  const base = Date.parse(dateKey)
  if (!Number.isFinite(base)) return ''
  return new Date(base + Number(days) * 86400000).toISOString().slice(0, 10)
}

/* 条款选项 —— 都是外贸报价里最常用的几种，不做成自由填空 */
const PAYMENT_METHODS = ['T/T', 'L/C', 'D/P', 'D/A', 'O/A', 'Western Union', 'PayPal']
const DEPOSIT_OPTIONS = [30, 50, 70, 100]
const DELIVERY_METHODS = ['EXW', 'FOB', 'CIF', 'CFR', 'DDP', 'DAP', 'FCA']
function money(value, digits = 2) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/* ------------------------------------------------------------------ */
/* 客户搜索选择                                                        */
/* ------------------------------------------------------------------ */
function CustomerPicker({ customers, selectedId, onSelect, onCreateNew, canEditCustomer }) {
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
    const term = keyword.trim().toLowerCase()
    if (!term) return customers.slice(0, 60)
    return customers
      .filter(c => [c.company, c.company_en, c.country, c.email, c.phone].filter(Boolean).join(' ').toLowerCase().includes(term))
      .slice(0, 60)
  }, [customers, keyword])

  const selected = customers.find(c => c.id === selectedId)

  return (
    <div className="quote-customer-picker" ref={boxRef}>
      <button type="button" className={`quote-customer-btn${open ? ' is-open' : ''}`} onClick={() => setOpen(v => !v)}>
        <UsersIcon size={17} />
        <span className="quote-customer-btn-text">
          {selected
            ? <><b>{selected.company}</b><em>{[selected.country, selected.email].filter(Boolean).join(' · ') || '未填联系方式'}</em></>
            : '选择客户'}
        </span>
        <span className="quote-customer-btn-hint">搜索 / 更换</span>
      </button>

      {open && (
        <div className="quote-customer-pop">
          <div className="quote-customer-search">
            <SearchIcon size={15} />
            <input
              ref={inputRef}
              type="text"
              value={keyword}
              onChange={event => setKeyword(event.target.value)}
              placeholder="搜索公司 / 国家 / 邮箱"
              aria-label="搜索客户"
            />
          </div>
          <div className="quote-customer-list">
            {filtered.length === 0 ? (
              <div className="quote-customer-empty">
                <p>{customers.length === 0 ? '还没有客户' : '没有匹配的客户'}</p>
                {canEditCustomer && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => { setOpen(false); onCreateNew(keyword.trim()) }}>
                    <PlusCircleIcon size={14} /> 新建客户
                  </button>
                )}
              </div>
            ) : (
              <>
                {filtered.map(c => (
                  <button
                    type="button"
                    key={c.id}
                    className={`quote-customer-item${c.id === selectedId ? ' active' : ''}`}
                    onClick={() => { onSelect(c.id); setOpen(false) }}
                  >
                    <b>{c.company}</b>
                    <span>{[c.country, c.email, c.phone].filter(Boolean).join(' · ') || '未填联系方式'}</span>
                  </button>
                ))}
                {canEditCustomer && (
                  <button type="button" className="quote-customer-new" onClick={() => { setOpen(false); onCreateNew(keyword.trim()) }}>
                    <PlusCircleIcon size={14} /> 找不到？新建客户
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 客户抬头（自动带出地址与联系方式）                                    */
/* ------------------------------------------------------------------ */
function CustomerCard({ customer, contacts, onChangeCustomer }) {
  if (!customer) return null
  const primary = contacts?.[0]
  const rows = [
    ['公司名称', customer.company],
    ['英文名称', customer.company_en],
    ['国家 / 地区', customer.country],
    ['地址', customer.address],
    ['邮箱', customer.email],
    ['电话', customer.phone],
    ['联系人', primary ? [primary.name, primary.position].filter(Boolean).join(' · ') : null],
    ['联系人邮箱', primary?.email],
    ['联系人电话', primary?.phone]
  ]

  return (
    <div className="quote-head">
      <div className="quote-head-top">
        <div>
          <span className="quote-head-company">{customer.company}</span>
          {customer.company_en && <span className="quote-head-company-en">{customer.company_en}</span>}
        </div>
        <div className="quote-head-actions">
          {customer.status !== 'active' && <span className="pill pill-warn">未启用</span>}
          <button type="button" className="btn btn-sm" onClick={onChangeCustomer}>更换客户</button>
        </div>
      </div>
      <dl className="quote-head-grid">
        {rows.map(([label, value]) => (
          <div className="quote-head-cell" key={label}>
            <dt>{label}</dt>
            <dd className={value ? '' : 'is-empty'}>{value || '未填写'}</dd>
          </div>
        ))}
      </dl>
      <p className="quote-head-note">以上信息取自客户档案，开单时会一并写入报价单抬头。</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 新建客户                                                            */
/* ------------------------------------------------------------------ */
function NewCustomerModal({ initialCompany, onClose, onCreated, canEditCustomer }) {
  const [form, setForm] = useState({
    company: initialCompany || '',
    company_en: '',
    country: '',
    address: '',
    email: '',
    phone: '',
    contact_name: '',
    contact_position: '',
    notes: ''
  })
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')

  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))

  /**
   * @param {'active'|'inactive'} status
   *   active   = 保存并启用（立刻可作为正式客户继续跟进）
   *   inactive = 仅保存（先建档，还没确认要不要投入跟进）
   */
  const save = async status => {
    if (!form.company.trim()) { setError('公司名称不能为空'); return }
    setError('')
    setSaving(status)
    try {
      const { data } = await axios.post(`${API}/customers`, {
        company: form.company.trim(),
        company_en: form.company_en.trim() || null,
        country: form.country.trim() || null,
        address: form.address.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
        source: '报价单',
        status
      })
      /* 填了联系人姓名就顺手建一条主联系人 —— 报价单抬头要用 */
      if (form.contact_name.trim()) {
        try {
          await axios.post(`${API}/customers/${data.id}/contacts`, {
            name: form.contact_name.trim(),
            position: form.contact_position.trim() || null,
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            is_primary: true
          })
        } catch { /* 联系人建失败不该拦住客户本身 */ }
      }
      onCreated(data.id)
    } catch (err) {
      setError(err?.response?.data?.error || err.message)
      setSaving('')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-wide" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <h2>新建客户</h2>
          <button type="button" className="modal-close" onClick={onClose}><CloseIcon size={16} /></button>
        </div>

        <div className="modal-body">
          {error && <div className="notice-inline">{error}</div>}
          <div className="form-group">
            <label>公司名称 *</label>
            <input type="text" value={form.company} onChange={e => set('company', e.target.value)} placeholder="客户公司全称" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>英文名称</label>
              <input type="text" value={form.company_en} onChange={e => set('company_en', e.target.value)} />
            </div>
            <div className="form-group">
              <label>国家 / 地区</label>
              <input type="text" value={form.country} onChange={e => set('country', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>地址</label>
            <input type="text" value={form.address} onChange={e => set('address', e.target.value)} placeholder="用于报价单抬头" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>邮箱</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div className="form-group">
              <label>电话</label>
              <input type="text" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>联系人</label>
              <input type="text" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label>联系人职务</label>
              <input type="text" value={form.contact_position} onChange={e => set('contact_position', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>备注</label>
            <textarea rows="2" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>取消</button>
          <span style={{ flex: 1 }} />
          {canEditCustomer && (
            <button type="button" className="btn" onClick={() => save('inactive')} disabled={!!saving}>
              {saving === 'inactive' ? '保存中…' : '仅保存'}
            </button>
          )}
          {canEditCustomer && (
            <button type="button" className="btn btn-primary" onClick={() => save('active')} disabled={!!saving}>
              {saving === 'active' ? '保存中…' : '保存并启用'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 主页面                                                              */
/* ------------------------------------------------------------------ */
function QuoteEditor() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canEditQuote = hasPermission(user, 'quote.edit')
  const canEditCustomer = hasPermission(user, 'customer.edit')

  const [cart, setCart] = useState([])
  const [customers, setCustomers] = useState([])
  const [contacts, setContacts] = useState([])
  const [customerId, setCustomerId] = useState(null)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [rates, setRates] = useState(null)
  const [loading, setLoading] = useState(true)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)
  const [newCustomerSeed, setNewCustomerSeed] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [header, setHeader] = useState({
    pi_no: '',
    quote_date: today(),
    /* 有效期以「距报价日期多少天」为准，截止日期由它推出来 */
    validity_days: '30',
    currency: 'USD',
    exchange_rate: '',
    markup_rate: '25',
    payment_method: 'T/T',
    deposit_percent: '30',
    delivery_method: 'FOB',
    delivery_port: 'Shanghai',
    order_notes: '',
    internal_notes: ''
  })
  const [qtyOverride, setQtyOverride] = useState({})

  const setField = (key, value) => setHeader(current => ({ ...current, [key]: value }))

  /* ---------- 初始数据：小推车 + 客户 + 汇率 ---------- */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [cartRes, customerRes, fxRes] = await Promise.all([
          axios.get(`${SKU_API}/cart`),
          axios.get(`${API}/customers`),
          axios.get(`${API}/fx/rates`).catch(() => null)
        ])
        if (!alive) return
        setCart(Array.isArray(cartRes.data) ? cartRes.data : [])
        setCustomers(Array.isArray(customerRes.data) ? customerRes.data : [])
        if (fxRes?.data?.ok && fxRes.data.rates) setRates(fxRes.data.rates)
      } catch (err) {
        if (alive) setError(err?.response?.data?.error || `加载数据失败：${err.message}`)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  /* ---------- 换了报价币种就把汇率换成实时值 ---------- */
  useEffect(() => {
    if (!rates || !header.currency) return
    const rate = crossRate(rates, header.currency, 'CNY')
    if (!rate) return
    setHeader(current => ({ ...current, exchange_rate: String(Number(rate.toFixed(4))) }))
  }, [rates, header.currency])

  /* ---------- 选中客户后拉它的地址 / 联系人 ---------- */
  const loadCustomer = useCallback(async id => {
    setCustomerId(id)
    try {
      const { data } = await axios.get(`${API}/customers/${id}`)
      setSelectedCustomer(data.customer)
      setContacts(data.contacts || [])
    } catch (err) {
      setError(err?.response?.data?.error || err.message)
    }
  }, [])

  /* ---------- 明细与单价 ---------- */
  const priceOf = useCallback(cost => {
    const rate = parseAmount(header.exchange_rate)
    const markup = parseAmount(header.markup_rate)
    const value = Number(cost)
    if (!Number.isFinite(value) || value <= 0 || !rate || rate <= 0) return null
    const factor = Number.isFinite(markup) ? markup / 100 : 0
    return value / rate * (1 + factor)
  }, [header.exchange_rate, header.markup_rate])

  const lines = useMemo(() => cart.map(row => {
    const cost = row.price == null ? null : Number(row.price)
    const rawQty = qtyOverride[row.sku] !== undefined ? qtyOverride[row.sku] : row.qty
    const qty = Number(rawQty) || 0
    const unit = priceOf(cost)
    return {
      key: row.sku,
      sku: row.display_sku || row.sku,
      rawSku: row.sku,
      /* 小推车接口带主图文件名，直接带到明细里给缩略图用 */
      image: row.image || null,
      product_name: row.product_name || row.display_sku || row.sku,
      spec: row.spec || null,
      cost,
      qty,
      unit,
      total: unit != null && qty > 0 ? unit * qty : null
    }
  }), [cart, priceOf, qtyOverride])

  const grandTotal = lines.reduce((sum, line) => sum + (line.total || 0), 0)
  const missingQty = lines.filter(line => !line.qty).length
  const missingPrice = lines.filter(line => line.unit == null).length

  /* 有效期：天数 → 截止日期。天数给人改，日期给人看，提交时两个都带上 */
  const validUntil = useMemo(
    () => addDays(header.quote_date, header.validity_days || 0),
    [header.quote_date, header.validity_days]
  )

  /* 分期付款：只有 T/T 走「预付 + 尾款」这套，尾款比例自动补足到 100% */
  const isTT = header.payment_method === 'T/T'
  const depositPercent = Number(header.deposit_percent)
  const splitPayment = isTT && Number.isFinite(depositPercent) && depositPercent > 0 && depositPercent <= 100
  const balancePercent = splitPayment ? Number((100 - depositPercent).toFixed(4)) : null
  const depositAmount = splitPayment ? grandTotal * depositPercent / 100 : null
  const balanceAmount = splitPayment ? grandTotal * (balancePercent || 0) / 100 : null

  const currencyOptions = useMemo(
    () => buildCurrencyOptions(rates, ['USD', 'CNY', 'EUR', 'GBP', 'HKD', 'JPY']),
    [rates]
  )

  const submit = async () => {
    setError('')
    setNotice('')
    if (!customerId) { setError('请先在顶部选择客户'); return }
    if (!lines.length) { setError('小推车是空的，先到产品管理里加入货号'); return }
    if (missingQty) { setError(`还有 ${missingQty} 行没填数量`); return }
    if (missingPrice) { setError('有明细算不出单价，请检查汇率与加价率是否填齐'); return }

    setSaving(true)
    try {
      const { data } = await axios.post(`${API}/quotes`, {
        customer_id: customerId,
        currency: header.currency,
        quote_date: header.quote_date,
        valid_until: validUntil || null,
        validity_days: Number(header.validity_days) || null,
        pi_no: header.pi_no || null,
        payment_method: header.payment_method || null,
        deposit_percent: splitPayment ? depositPercent : null,
        balance_percent: splitPayment ? balancePercent : null,
        delivery_method: header.delivery_method || null,
        delivery_port: header.delivery_port || null,
        notes: header.order_notes || null,
        internal_notes: header.internal_notes || null,
        status: 'draft',
        items: lines.map(line => ({
          sku: line.rawSku,
          product_name: line.product_name,
          spec: line.spec,
          qty: line.qty,
          unit_price: Number(line.unit.toFixed(4)),
          purchase_price: line.cost,
          exchange_rate: parseAmount(header.exchange_rate),
          markup_rate: (parseAmount(header.markup_rate) || 0) / 100
        }))
      })
      setNotice(`报价单 ${data.quote.quote_no} 已保存，正在跳转到报价单列表…`)
      window.setTimeout(() => navigate('/quotes'), 1100)
    } catch (err) {
      setError(err?.response?.data?.error || err.message)
      setSaving(false)
    }
  }

  if (loading) return <div className="page-container"><div className="loading"><span className="spinner" /> 正在读取小推车与客户…</div></div>

  return (
    <div className="page-container quote-editor">
      <div className="page-header quote-editor-header">
        <div className="quote-editor-title">
          <button type="button" className="btn btn-sm btn-icon" onClick={() => navigate(-1)} title="返回">
            <ArrowLeftIcon size={16} />
          </button>
          <div>
            <h1 className="page-title">汇总报价</h1>
          </div>
        </div>
        <div className="quote-editor-actions">
          <span className="secondary">{lines.length} 个货号</span>
          {canEditQuote && (
            <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
              <CheckIcon size={15} /> {saving ? '保存中…' : '保存报价单'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="notice-inline">{error}</div>}
      {notice && <div className="notice-inline notice-ok">{notice}</div>}

      {/* ---------- ① 客户抬头 ---------- */}
      <section className="panel">
        <div className="panel-title">客户</div>
        {selectedCustomer ? (
          <CustomerCard
            customer={selectedCustomer}
            contacts={contacts}
            onChangeCustomer={() => { setSelectedCustomer(null); setCustomerId(null); setContacts([]) }}
          />
        ) : (
          <div className="quote-customer-empty-state">
            <p>报价单要发给谁？先选一个客户 —— 选中后会自动带出地址与联系方式。</p>
            <CustomerPicker
              customers={customers}
              selectedId={customerId}
              onSelect={loadCustomer}
              onCreateNew={seed => { setNewCustomerSeed(seed); setNewCustomerOpen(true) }}
              canEditCustomer={canEditCustomer}
            />
          </div>
        )}
      </section>

      {/* ---------- ② 报价条件 ---------- */}
      <section className="panel">
        <div className="panel-title">报价条件</div>
        <div className="quote-terms-grid">
          <div className="form-group">
            <label>PI 号</label>
            <input
              type="text"
              value={header.pi_no}
              onChange={e => setField('pi_no', e.target.value)}
              placeholder="选填，例如 PI-20260914-01"
            />
          </div>
          <div className="form-group">
            <label>报价日期</label>
            <input type="date" value={header.quote_date} onChange={e => setField('quote_date', e.target.value)} />
          </div>
          <div className="form-group">
            <label>报价有效期（距报价日期天数）</label>
            <input
              type="number" min="1" step="1"
              value={header.validity_days}
              onChange={e => setField('validity_days', e.target.value)}
              placeholder="例如 30"
            />
            <span className="field-hint">
              {validUntil
                ? `自 ${header.quote_date} 起 ${header.validity_days} 天，有效期至 ${validUntil}`
                : '填一个大于 0 的天数'}
            </span>
          </div>
          <div className="form-group">
            <label>报价币种</label>
            <select value={header.currency} onChange={e => setField('currency', e.target.value)}>
              {currencyOptions.map(option => (
                <option key={option.code} value={option.code}>{currencyLabel(option.code)}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>汇率（1 {header.currency} = ? CNY）</label>
            <input
              type="text"
              inputMode="decimal"
              value={header.exchange_rate}
              onChange={e => setField('exchange_rate', e.target.value)}
              placeholder="自动取实时汇率"
            />
          </div>
          <div className="form-group">
            <label>加价率（%）</label>
            <input
              type="text"
              inputMode="decimal"
              value={header.markup_rate}
              onChange={e => setField('markup_rate', e.target.value)}
              placeholder="例如 25"
            />
          </div>
          <div className="form-group">
            <label>付款方式</label>
            <select value={header.payment_method} onChange={e => setField('payment_method', e.target.value)}>
              {PAYMENT_METHODS.map(method => <option key={method} value={method}>{method}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>交货方式</label>
            <div className="field-inline">
              <select value={header.delivery_method} onChange={e => setField('delivery_method', e.target.value)}>
                {DELIVERY_METHODS.map(method => <option key={method} value={method}>{method}</option>)}
              </select>
              <input
                type="text"
                value={header.delivery_port}
                onChange={e => setField('delivery_port', e.target.value)}
                placeholder="港口 / 地点，例如 Shanghai"
              />
            </div>
          </div>
        </div>

        {/* 选 T/T 才展开分期：预付款点一下定比例，尾款百分比与金额自动算出 */}
        {isTT && (
          <div className="payment-split">
            <div className="payment-split-head">
              <span>预付款比例</span>
            </div>
            <div className="payment-split-options">
              {DEPOSIT_OPTIONS.map(percent => (
                <button
                  key={percent}
                  type="button"
                  className={`payment-split-btn${depositPercent === percent ? ' active' : ''}`}
                  onClick={() => setField('deposit_percent', String(percent))}
                >
                  {percent}%
                </button>
              ))}
              <input
                type="number" min="1" max="100" step="1"
                className="payment-split-input"
                value={header.deposit_percent}
                onChange={e => setField('deposit_percent', e.target.value)}
                aria-label="自定义预付款比例"
              />
              <span className="payment-split-unit">% 自定义</span>
            </div>
            <div className="payment-split-result">
              {splitPayment ? (
                <>
                  <span>预付款 <b>{depositPercent}%</b><em>{money(depositAmount)} {header.currency}</em></span>
                  <span>尾款 <b>{balancePercent}%</b><em>{money(balanceAmount)} {header.currency}</em></span>
                  {balancePercent === 0 && <span className="payment-split-note">全额预付，无尾款</span>}
                </>
              ) : (
                <span className="quote-warn">预付款比例请填 1–100 之间的数字</span>
              )}
            </div>
          </div>
        )}

        <p className="quote-formula">
          单价 = 采购价 ÷ 汇率 ×（1 ＋ 加价率），与询盘报价同一套口径。
          {rates && header.exchange_rate
            ? ` 当前按 1 ${header.currency} = ${formatRate(parseAmount(header.exchange_rate) || 0)} CNY 换算。`
            : ' 汇率取不到时可以手动填。'}
        </p>
      </section>

      {/* ---------- ③ 报价明细 ---------- */}
      <section className="panel">
        <div className="panel-title">
          报价明细
          <span className="panel-title-hint">货号来自小推车，数量可在此微调（不会改动小推车）</span>
        </div>

        {lines.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><CartIcon size={40} /></div>
            <div className="empty-state-title">小推车是空的</div>
            <div className="empty-state-hint">先到「产品管理」里勾选货号加入小推车，再回来出报价单。</div>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>货号</th>
                    <th>产品 / 规格</th>
                    <th className="num">采购价</th>
                    <th className="num">数量</th>
                    <th className="num">单价</th>
                    <th className="num">小计</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(line => (
                    <tr key={line.key} className={line.qty ? '' : 'row-pending'}>
                      <td className="mono bold">
                        <span className="sku-cell">
                          <SkuThumb sku={line.sku} filename={line.image} size={30} />
                          {line.sku}
                        </span>
                      </td>
                      <td>
                        <div>{line.product_name}</div>
                        {line.spec && <div className="secondary">{line.spec}</div>}
                      </td>
                      <td className="num">
                        {line.cost == null ? <span className="secondary">无采购价</span> : <>¥{money(line.cost)}</>}
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          className="quote-qty-input"
                          value={qtyOverride[line.key] ?? line.qty ?? ''}
                          placeholder="必填"
                          onChange={event => setQtyOverride(current => ({ ...current, [line.key]: event.target.value }))}
                        />
                      </td>
                      <td className="num">
                        {line.unit == null ? <span className="secondary">—</span> : <b>{money(line.unit, 4)}</b>}
                      </td>
                      <td className="num">
                        {line.total == null ? <span className="secondary">—</span> : `${money(line.total)} ${header.currency}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="quote-total-bar">
              {missingQty > 0 && <span className="quote-warn">还有 {missingQty} 行没填数量</span>}
              {missingPrice > 0 && <span className="quote-warn">{missingPrice} 行算不出单价（汇率或加价率未填）</span>}
              <span style={{ flex: 1 }} />
              <span className="quote-grand-total">
                报价合计 <b>{money(grandTotal)} {header.currency}</b>
              </span>
            </div>
          </>
        )}
      </section>

      {/* ---------- ④ 备注：对外 / 对内分开 ---------- */}
      <section className="panel">
        <div className="panel-title">备注</div>
        <div className="quote-notes-grid">
          <div className="form-group">
            <label>订单备注 <span className="label-badge">会显示在报价单</span></label>
            <textarea
              rows="3"
              className="quote-notes"
              value={header.order_notes}
              onChange={e => setField('order_notes', e.target.value)}
              placeholder="给客户看的补充说明，例如包装要求、交期、唛头。导出时以 Notes: 开头"
            />
            {header.order_notes.trim() && (
              <span className="field-hint">报价单上呈现为：Notes: {header.order_notes.trim()}</span>
            )}
          </div>
          <div className="form-group">
            <label>系统备注 <span className="label-badge label-badge-internal">仅内部可见</span></label>
            <textarea
              rows="3"
              className="quote-notes"
              value={header.internal_notes}
              onChange={e => setField('internal_notes', e.target.value)}
              placeholder="内部备注：成本底线、客户砍价习惯、验厂情况等。不会出现在报价单上"
            />
            <span className="field-hint">系统备注只留在系统里，报价单和导出文件都不带它。</span>
          </div>
        </div>
      </section>

      <div className="quote-editor-footer">
        <button type="button" className="btn" onClick={() => navigate(-1)}>返回</button>
        {canEditQuote && (
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
            <QuoteIcon size={15} /> {saving ? '保存中…' : '保存报价单'}
          </button>
        )}
      </div>

      {newCustomerOpen && (
        <NewCustomerModal
          initialCompany={newCustomerSeed}
          onClose={() => setNewCustomerOpen(false)}
          onCreated={async id => {
            setNewCustomerOpen(false)
            const { data } = await axios.get(`${API}/customers`)
            setCustomers(Array.isArray(data) ? data : [])
            await loadCustomer(id)
            setNotice('客户已创建，抬头信息已带出')
          }}
          canEditCustomer={canEditCustomer}
        />
      )}
    </div>
  )
}

export default QuoteEditor
