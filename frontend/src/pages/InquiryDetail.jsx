import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import axios from 'axios'
import Drawer from '../components/Drawer'
import SkuPicker from '../components/SkuPicker'
import { SkuThumb, useSkuThumbs } from '../components/SkuThumb'
import {
  PlusCircleIcon, PencilIcon, TrashIcon, PackageIcon, ClockIcon,
  InquiryIcon, DollarIcon, RefreshIcon
} from '../components/Icons'
import { useAuth, hasPermission } from '../auth'

const STATUS_LABELS = {
  draft: '草稿',
  quoting: '报价中',
  quoted: '已报价',
  won: '已成交',
  lost: '已流失',
  closed: '已关闭'
}
const STATUS_TONE = {
  draft: 'mute',
  quoting: 'warn',
  quoted: 'ok',
  won: 'ok',
  lost: 'danger',
  closed: 'mute'
}

const CURRENCIES = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD']

/**
 * 报价合计。
 * 口径说明：inquiry_items.currency 存的是「采购币种」，而 EXW 是拿采购价除以汇率算出来的，
 * 所以 EXW / 小计 / 合计都落在「报价币种」上，也就是 inquiry.currency。
 * 这里不做跨币种换算 —— 一张询盘的报价币种是固定的（汇率那一栏的分母就是它）。
 */
function summarize(items) {
  return items.reduce((sum, item) => sum + Number(item.exw || 0) * Number(item.quantity || 0), 0)
}

function money(value, digits = 2) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return number.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 包装快照读出来做「一行摘要」，让报价行不用展开就知道箱规 */
function packagingBrief(snapshot) {
  if (!snapshot) return null
  let data = null
  try { data = JSON.parse(snapshot) } catch { return null }
  if (!data) return null
  const parts = []
  if (data.carton_qty) parts.push(`${data.carton_qty} pcs/箱`)
  if (data.carton_length && data.carton_width && data.carton_height) {
    parts.push(`${data.carton_length}×${data.carton_width}×${data.carton_height} cm`)
  }
  if (data.carton_weight) parts.push(`毛重 ${data.carton_weight} kg`)
  if (data.packaging_material) parts.push(data.packaging_material)
  return parts.length ? parts : null
}

/**
 * 询盘明细编辑器。
 * 两种输入方式：
 *   自动 —— 填加价率，EXW 由「采购价 ÷ 汇率 ×（1＋加价率）」算出（这是报价的标准姿势）
 *   手动 —— 直接给 EXW，反算加价率（客户先给目标价时用）
 * 两者互斥，切换时保留当前能推导的量，避免把用户已经填好的数字清掉。
 */
function ItemEditor({ inquiry, item, existingSkus = [], onClose, onSaved, canEdit }) {
  const isNew = !item
  const [skuChoice, setSkuChoice] = useState(isNew ? null : { sku: item.sku, display_sku: item.sku, source: 'existing' })
  const [pickerOpen, setPickerOpen] = useState(isNew)
  const [mode, setMode] = useState('auto')
  const [form, setForm] = useState(() => ({
    purchase_price: item ? String(item.purchase_price ?? '') : '',
    // 采购币种默认取人民币 —— 供应商报价绝大多数是 CNY，拿询盘的报价币种当默认值会把人带偏
    currency: item?.currency || 'CNY',
    exchange_rate: item ? String(item.exchange_rate ?? '') : '',
    markup_rate: item ? String(((Number(item.markup_rate) || 0) * 100).toFixed(2).replace(/\.?0+$/, '')) : '25',
    manual_exw: '',
    quantity: item ? String(item.quantity ?? '') : '1'
  }))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const purchasePrice = Number(form.purchase_price)
  const exchangeRate = Number(form.exchange_rate)
  const markupRate = Number(form.markup_rate) / 100
  const manualExw = Number(form.manual_exw)

  const base = Number.isFinite(purchasePrice) && Number.isFinite(exchangeRate) && exchangeRate > 0
    ? purchasePrice / exchangeRate
    : null

  const preview = useMemo(() => {
    if (base === null) return null
    if (mode === 'manual') {
      if (!Number.isFinite(manualExw) || manualExw <= 0) return null
      return { exw: manualExw, markup: manualExw / base - 1 }
    }
    if (!Number.isFinite(markupRate) || markupRate < -1) return null
    return { exw: base * (1 + markupRate), markup: markupRate }
  }, [mode, base, manualExw, markupRate])

  const pickSku = async (choice) => {
    setSkuChoice(choice)
    setPickerOpen(false)
    setError('')
    // 命中 SKU 服务时返回的是完整货号，顺手把采购价/币种带出来，省一次手输
    if (choice.source === 'manual') return
    setForm(current => ({
      ...current,
      purchase_price: choice.price === null || choice.price === undefined ? current.purchase_price : String(choice.price),
      currency: choice.currency || current.currency
    }))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!skuChoice?.sku) { setError('请先选择货号'); return }
    const quantity = Number(form.quantity)
    if (!Number.isInteger(quantity) || quantity <= 0) { setError('数量必须是大于 0 的整数'); return }
    if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) { setError('采购价必须是大于 0 的数字'); return }
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) { setError('汇率必须是大于 0 的数字'); return }

    const payload = {
      sku: skuChoice.sku,
      purchase_price: purchasePrice,
      currency: form.currency,
      exchange_rate: exchangeRate,
      quantity
    }
    if (mode === 'manual') {
      if (!Number.isFinite(manualExw) || manualExw <= 0) { setError('手动 EXW 必须是大于 0 的数字'); return }
      payload.manual_exw = manualExw
    } else {
      payload.markup_rate = markupRate
    }

    setSaving(true)
    setError('')
    try {
      if (isNew) await axios.post(`/api/inquiries/${inquiry.id}/items`, payload)
      else await axios.patch(`/api/inquiry-items/${item.id}`, payload)
      onSaved()
    } catch (saveError) {
      setError(saveError?.response?.data?.error || '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const brief = item ? packagingBrief(item.packaging_snapshot) : null

  return (
    <>
      <Drawer
        wide
        title={isNew ? '添加报价明细' : `编辑明细 · ${item.sku}`}
        sub={isNew ? `询盘 ${inquiry?.inquiry_no || ''}` : item.product_name}
        onClose={onClose}
        footer={(
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
            {canEdit && (
              <button type="submit" form="inquiry-item-form" className="btn btn-primary" disabled={saving}>
                {saving ? '保存中…' : '保存明细'}
              </button>
            )}
          </>
        )}
      >
        <form id="inquiry-item-form" onSubmit={submit}>
          <div className="panel-title">货号</div>
          <div className="sku-chosen">
            {skuChoice ? (
              <>
                <div className="sku-chosen-main">
                  <SkuThumb sku={skuChoice.sku} filename={skuChoice.thumb} size={36} />
                  <b>{skuChoice.display_sku || skuChoice.sku}</b>
                  <span>{skuChoice.name || skuChoice.spec || (skuChoice.source === 'manual' ? '手工输入货号' : '')}</span>
                </div>
                {canEdit && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(true)}>
                    更换货号
                  </button>
                )}
              </>
            ) : (
              <p className="muted-note">还没有选择货号。</p>
            )}
          </div>

          <div className="panel-title">报价参数</div>
          <div className="form-row">
            <div className="form-group">
              <label>采购价（含税单价）</label>
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={form.purchase_price}
                onChange={event => setForm({ ...form, purchase_price: event.target.value })}
              />
            </div>
            <div className="form-group">
              <label>采购币种</label>
              <select value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value })}>
                {CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>汇率（1 {inquiry?.currency || '报价币'} = ? {form.currency}）</label>
              <input
                type="number" min="0" step="0.0001" inputMode="decimal"
                value={form.exchange_rate}
                placeholder="例如 6.7"
                onChange={event => setForm({ ...form, exchange_rate: event.target.value })}
              />
            </div>
            <div className="form-group">
              <label>数量</label>
              <input
                type="number" min="1" step="1" inputMode="numeric"
                value={form.quantity}
                onChange={event => setForm({ ...form, quantity: event.target.value })}
              />
            </div>
          </div>

          <div className="panel-title">定价方式</div>
          <div className="mode-switch" role="tablist">
            <button
              type="button" role="tab" aria-selected={mode === 'auto'}
              className={mode === 'auto' ? 'is-active' : ''}
              onClick={() => setMode('auto')}
            >
              按加价率算 EXW
            </button>
            <button
              type="button" role="tab" aria-selected={mode === 'manual'}
              className={mode === 'manual' ? 'is-active' : ''}
              onClick={() => setMode('manual')}
            >
              手填 EXW 反算加价率
            </button>
          </div>

          <div className="form-row">
            {mode === 'auto' ? (
              <div className="form-group">
                <label>加价率</label>
                <span className="pkg-input">
                  <input
                    type="number" step="0.1" inputMode="decimal"
                    value={form.markup_rate}
                    placeholder="例如 25"
                    onChange={event => setForm({ ...form, markup_rate: event.target.value })}
                  />
                  <em>%</em>
                </span>
              </div>
            ) : (
              <div className="form-group">
                <label>目标 EXW 单价</label>
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={form.manual_exw}
                  placeholder="客户给的目标价"
                  onChange={event => setForm({ ...form, manual_exw: event.target.value })}
                />
              </div>
            )}
            <div className="form-group">
              <label>{mode === 'auto' ? '加价系数' : '反算加价系数'}</label>
              <div className="readout">
                {preview ? (preview.markup + 1).toFixed(4) : '—'}
              </div>
            </div>
          </div>

          <div className="exw-preview">
            <div className="exw-preview-formula">
              EXW = 采购价 ÷ 汇率 ×（1 ＋ 加价率）
            </div>
            <div className="exw-preview-main">
              <span>
                EXW 单价
                <em className="exw-preview-currency">报价币种 {inquiry?.currency || '—'}</em>
              </span>
              <strong>{preview ? `${money(preview.exw, 4)} ${inquiry?.currency || ''}` : '—'}</strong>
            </div>
            <div className="exw-preview-sub">
              {base === null ? (
                <span>填好采购价和汇率后自动计算。</span>
              ) : (
                <>
                  <span>采购价折报价币 <b>{money(base, 4)}</b></span>
                  <span>加价率 <b>{preview ? `${(preview.markup * 100).toFixed(2)}%` : '—'}</b></span>
                  <span>小计 <b>{preview ? `${money(preview.exw * Number(form.quantity || 0), 2)} ${inquiry?.currency || ''}` : '—'}</b></span>
                </>
              )}
            </div>
          </div>

          {brief && (
            <>
              <div className="panel-title">包装（本次报价时的快照）</div>
              <ul className="snapshot-list">
                {brief.map(text => <li key={text}><PackageIcon size={13} /> {text}</li>)}
              </ul>
              <p className="muted-note">快照在报价那一刻定格，之后产品包装信息再改也不会动这行报价。</p>
            </>
          )}

          {error && <p className="form-error">{error}</p>}
        </form>
      </Drawer>

      {pickerOpen && (
        <div className="modal-overlay" onClick={() => (isNew ? onClose() : setPickerOpen(false))}>
          <div className="modal-content sku-picker-modal" onClick={event => event.stopPropagation()}>
            <SkuPicker
              excludeSkus={existingSkus}
              onClose={() => (isNew ? onClose() : setPickerOpen(false))}
              onPick={pickSku}
            />
          </div>
        </div>
      )}
    </>
  )
}

function InquiryDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const canEdit = hasPermission(user, 'inquiry.edit')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState(null)   // { item } 或 { item: null } 表示新增
  const [expandedPackaging, setExpandedPackaging] = useState(null)

  /* 明细里的货号只在本地库里，图片得按货号批量问 SKU 服务要 */
  const itemThumbs = useSkuThumbs((data?.items || []).map(row => row.sku))

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await axios.get(`/api/inquiries/${id}`)
      setData(response.data)
    } catch (loadError) {
      setError(loadError?.response?.data?.error || '读取询盘失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const updateStatus = async (status) => {
    try {
      await axios.patch(`/api/inquiries/${id}`, { status })
      await load()
    } catch (statusError) {
      setError(statusError?.response?.data?.error || '更新状态失败')
    }
  }

  const removeItem = async (item) => {
    if (!window.confirm(`删除明细「${item.product_name || item.sku}」？删除后不可恢复。`)) return
    try {
      await axios.delete(`/api/inquiry-items/${item.id}`)
      await load()
    } catch (removeError) {
      setError(removeError?.response?.data?.error || '删除失败，请稍后重试')
    }
  }

  const inquiry = data?.inquiry
  const items = data?.items || []
  const totals = useMemo(() => summarize(items), [items])

  if (loading) return <div className="loading">加载询盘…</div>
  if (!inquiry) {
    return (
      <div className="page-container">
        <p className="notice-inline">{error || '询盘不存在'}</p>
        <Link className="btn btn-secondary btn-sm" to="/inquiries">返回询盘列表</Link>
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="breadcrumb">
        <Link to="/inquiries">询盘管理</Link>
        <span>/</span>
        <span className="mono">{inquiry.inquiry_no}</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{inquiry.title || '未命名询盘'}</h1>
          <p className="page-sub">
            <Link to={`/customers/${inquiry.customer_id}`}>{inquiry.customer_name || '未知客户'}</Link>
            {' · '}
            {inquiry.inquiry_date}
            {' · '}
            <span className={`pill pill-${STATUS_TONE[inquiry.status] || 'mute'}`}>
              {STATUS_LABELS[inquiry.status] || inquiry.status}
            </span>
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            <RefreshIcon size={14} /> 刷新
          </button>
          {canEdit && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditor({ item: null })}>
              <PlusCircleIcon size={15} /> 添加货号
            </button>
          )}
        </div>
      </div>

      <div className="stat-rail inquiry-rail">
        <div className="stat-line">
          <span className="stat-line-icon"><InquiryIcon size={17} /></span>
          <span>报价明细</span><strong>{items.length}</strong>
        </div>
        <div className="stat-line">
          <span className="stat-line-icon"><PackageIcon size={17} /></span>
          <span>总数量</span>
          <strong>{items.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString('zh-CN')}</strong>
        </div>
        <div className="stat-line">
          <span className="stat-line-icon"><DollarIcon size={17} /></span>
          <span>报价合计</span>
          <strong>
            {items.length ? `${money(totals, 2)} ${inquiry.currency || ''}` : '—'}
          </strong>
        </div>
      </div>

      {error && <p className="notice-inline">{error}</p>}

      <section className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div>
            <h2><DollarIcon size={17} /> 报价明细</h2>
          </div>
          <div className="header-actions">
            {canEdit ? (
              <label className="inline-field">
                <span>询盘状态</span>
                <select value={inquiry.status} onChange={event => updateStatus(event.target.value)}>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
            ) : (
              <span className={`pill pill-${STATUS_TONE[inquiry.status] || 'mute'}`}>
                {STATUS_LABELS[inquiry.status] || inquiry.status}
              </span>
            )}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state-title">这次询盘还没有报价行</p>
            <p className="empty-state-hint">点右上角「添加货号」，从已有 SKU 里选，或直接敲完整货号。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table quote-table">
              <thead>
                <tr>
                  <th>货号</th>
                  <th>产品 / 供应商</th>
                  <th className="num">采购价</th>
                  <th className="num">汇率</th>
                  <th className="num">加价率</th>
                  <th className="num">加价系数</th>
                  <th className="num">EXW<span className="th-unit">{inquiry.currency}</span></th>
                  <th className="num">数量</th>
                  <th className="num">小计<span className="th-unit">{inquiry.currency}</span></th>
                  <th>包装</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const brief = packagingBrief(item.packaging_snapshot)
                  const open = expandedPackaging === item.id
                  const subtotal = Number(item.exw || 0) * Number(item.quantity || 0)
                  return (
                    <React.Fragment key={item.id}>
                      <tr>
                        <td className="mono bold">
                          <span className="sku-cell">
                            <SkuThumb sku={item.sku} filename={itemThumbs[item.sku]} size={30} />
                            {item.sku}
                          </span>
                        </td>
                        <td>
                          <div>{item.product_name || '—'}</div>
                          <div className="cell-sub">{item.supplier_name || '未指派供应商'}</div>
                        </td>
                        <td className="num">{money(item.purchase_price, 2)} <span className="unit">{item.currency}</span></td>
                        <td className="num">{money(item.exchange_rate, 4)}</td>
                        <td className="num">{(Number(item.markup_rate || 0) * 100).toFixed(2)}%</td>
                        <td className="num">{money(item.markup_factor, 4)}</td>
                        <td className="num strong-cell">{money(item.exw, 4)}</td>
                        <td className="num">{Number(item.quantity || 0).toLocaleString('zh-CN')}</td>
                        <td className="num">{money(subtotal, 2)}</td>
                        <td>
                          {brief ? (
                            <button
                              type="button"
                              className={`packaging-chip${open ? ' is-open' : ''}`}
                              onClick={() => setExpandedPackaging(open ? null : item.id)}
                              title="展开包装快照"
                            >
                              <PackageIcon size={13} /> {brief[0]}
                            </button>
                          ) : (
                            <span className="muted-note">未维护</span>
                          )}
                        </td>
                        <td className="col-actions">
                          {canEdit && (
                            <button type="button" className="icon-btn" title="编辑明细" onClick={() => setEditor({ item })}>
                              <PencilIcon size={14} />
                            </button>
                          )}
                          {canEdit && (
                            <button type="button" className="icon-btn" title="删除明细" onClick={() => removeItem(item)}>
                              <TrashIcon size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && brief && (
                        <tr className="snapshot-row">
                          <td colSpan={11}>
                            <div className="snapshot-detail">
                              <span className="snapshot-detail-title"><PackageIcon size={13} /> 报价时的包装快照</span>
                              <ul className="snapshot-list">
                                {brief.map(text => <li key={text}>{text}</li>)}
                              </ul>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="dashboard-panel">
        <div className="dashboard-panel-header">
          <div>
            <h2><ClockIcon size={17} /> 跟进记录</h2>
          </div>
          <Link className="btn btn-secondary btn-sm" to={`/customers/${inquiry.customer_id}`}>
            去客户详情记录跟进
          </Link>
        </div>
        <p className="muted-note">
          跟进记录统一挂在客户身上，记录时可以在「关联询盘」里选中本次询盘（{inquiry.inquiry_no}），
          这样客户时间线和工作台待跟进都能对上。
        </p>
      </section>

      {editor && (
        <ItemEditor
          inquiry={inquiry}
          item={editor.item}
          existingSkus={items.filter(row => row.id !== editor.item?.id).map(row => row.sku)}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load() }}
          canEdit={canEdit}
        />
      )}
    </div>
  )
}

export default InquiryDetail
