import React, { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { PackageIcon, RefreshIcon } from './Icons'

/* 常用柜型内容积（m³）。取行业常用的保守值，宁少不溢柜。 */
const CONTAINERS = [
  { key: '20GP', label: '20GP', volume: 28 },
  { key: '40GP', label: '40GP', volume: 58 },
  { key: '40HQ', label: '40HQ', volume: 68 }
]

const FIELDS = [
  { key: 'inner_pack_qty', label: '内盒装量', unit: 'pcs/内盒', group: 'pack' },
  { key: 'carton_qty', label: '外箱装量', unit: 'pcs/箱', group: 'pack' },
  { key: 'carton_length', label: '外箱长', unit: 'cm', group: 'carton' },
  { key: 'carton_width', label: '外箱宽', unit: 'cm', group: 'carton' },
  { key: 'carton_height', label: '外箱高', unit: 'cm', group: 'carton' },
  { key: 'carton_weight', label: '外箱毛重', unit: 'kg', group: 'carton' },
  { key: 'unit_length', label: '单品长', unit: 'cm', group: 'unit' },
  { key: 'unit_width', label: '单品宽', unit: 'cm', group: 'unit' },
  { key: 'unit_height', label: '单品高', unit: 'cm', group: 'unit' },
  { key: 'unit_weight', label: '单品净重', unit: 'kg', group: 'unit' }
]

const EMPTY = FIELDS.reduce((acc, field) => { acc[field.key] = ''; return acc }, { packaging_material: '', notes: '' })

/** 算外箱体积与各柜型装柜量；字段不全就返回 null，不猜。 */
function calcLoading(form) {
  const l = Number(form.carton_length)
  const w = Number(form.carton_width)
  const h = Number(form.carton_height)
  const perCarton = Number(form.carton_qty)
  if (![l, w, h].every(value => Number.isFinite(value) && value > 0)) return null
  const cartonVolume = (l * w * h) / 1000000
  if (!(cartonVolume > 0)) return null
  const rows = CONTAINERS.map(container => {
    const cartons = Math.floor(container.volume / cartonVolume)
    return {
      ...container,
      cartons,
      pieces: Number.isFinite(perCarton) && perCarton > 0 ? cartons * perCarton : null
    }
  })
  let totalWeight = null
  const gross = Number(form.carton_weight)
  if (Number.isFinite(gross) && gross > 0) totalWeight = rows.map(row => row.cartons * gross)
  return { cartonVolume, rows, totalWeight }
}

/** 把接口返回的对象转成受控表单值（null → 空串，避免 React 受控告警） */
function toForm(data) {
  const next = { ...EMPTY }
  FIELDS.forEach(field => {
    const value = data?.[field.key]
    next[field.key] = value === null || value === undefined ? '' : String(value)
  })
  next.packaging_material = data?.packaging_material || ''
  next.notes = data?.notes || ''
  return next
}

/**
 * 结构化包装信息面板。
 * 只负责给「包装」这块数据提供录入与展示，SKU 是否存在由调用方保证
 * （后端 PUT 会自己向 SKU 服务核验一次）。
 */
function PackagingPanel({ sku, readOnly = false, onSaved, canEdit }) {
  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [available, setAvailable] = useState(true)

  const load = useCallback(async () => {
    if (!sku) return
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get(`/api/products/${encodeURIComponent(sku)}/packaging`)
      setForm(toForm(data))
      setAvailable(true)
    } catch (loadError) {
      setAvailable(false)
      setError(loadError?.response?.data?.error || '读取包装信息失败')
    } finally {
      setLoading(false)
    }
  }, [sku])

  useEffect(() => { load() }, [load])
  useEffect(() => { setNotice('') }, [sku])

  const loadingPlan = useMemo(() => calcLoading(form), [form])

  // 空白输入一律按「未填」处理，不要变成 0 —— 0 和没填在装柜测算里含义完全不同
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))

  const save = async (event) => {
    event.preventDefault()
    if (!sku) return
    setSaving(true)
    setError('')
    setNotice('')
    const payload = {}
    FIELDS.forEach(field => {
      const raw = form[field.key]
      payload[field.key] = raw === '' ? null : Number(raw)
    })
    payload.packaging_material = form.packaging_material.trim() || null
    payload.notes = form.notes.trim() || null
    try {
      const { data } = await axios.put(`/api/products/${encodeURIComponent(sku)}/packaging`, payload)
      setForm(toForm(data.packaging))
      setNotice('包装信息已保存')
      if (onSaved) onSaved(data.packaging)
    } catch (saveError) {
      setError(saveError?.response?.data?.error || '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="pkg-loading">读取包装信息…</p>

  if (!available) {
    return (
      <div className="pkg-unavailable">
        <p>{error}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
          <RefreshIcon size={14} /> 重试
        </button>
      </div>
    )
  }

  return (
    <form className="pkg-panel" onSubmit={save}>
      <div className="pkg-section">
        <h4 className="pkg-section-title"><PackageIcon size={14} /> 装箱结构</h4>
        <div className="pkg-grid">
          {FIELDS.filter(field => field.group === 'pack').map(field => (
            <label className="pkg-field" key={field.key}>
              <span>{field.label}</span>
              <span className="pkg-input">
                <input
                  type="number" min="0" step="1" inputMode="numeric"
                  value={form[field.key]} disabled={readOnly}
                  onChange={event => set(field.key, event.target.value)}
                />
                <em>{field.unit}</em>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="pkg-section">
        <h4 className="pkg-section-title">外箱尺寸与重量</h4>
        <div className="pkg-grid">
          {FIELDS.filter(field => field.group === 'carton').map(field => (
            <label className="pkg-field" key={field.key}>
              <span>{field.label}</span>
              <span className="pkg-input">
                <input
                  type="number" min="0" step="0.1" inputMode="decimal"
                  value={form[field.key]} disabled={readOnly}
                  onChange={event => set(field.key, event.target.value)}
                />
                <em>{field.unit}</em>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="pkg-section">
        <h4 className="pkg-section-title">单品尺寸与重量</h4>
        <div className="pkg-grid">
          {FIELDS.filter(field => field.group === 'unit').map(field => (
            <label className="pkg-field" key={field.key}>
              <span>{field.label}</span>
              <span className="pkg-input">
                <input
                  type="number" min="0" step="0.1" inputMode="decimal"
                  value={form[field.key]} disabled={readOnly}
                  onChange={event => set(field.key, event.target.value)}
                />
                <em>{field.unit}</em>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="pkg-section">
        <h4 className="pkg-section-title">包装与备注</h4>
        <div className="pkg-grid">
          <label className="pkg-field pkg-field-wide">
            <span>包装材质</span>
            <input
              type="text" value={form.packaging_material} disabled={readOnly}
              placeholder="例如：彩盒 + 五层瓦楞纸箱"
              onChange={event => set('packaging_material', event.target.value)}
            />
          </label>
          <label className="pkg-field pkg-field-wide">
            <span>包装备注</span>
            <input
              type="text" value={form.notes} disabled={readOnly}
              placeholder="唛头要求、客户指定箱规等"
              onChange={event => set('notes', event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="pkg-section">
        <h4 className="pkg-section-title">装柜测算</h4>
        {!loadingPlan ? (
          <p className="pkg-loading-hint">填好外箱长宽高即可自动推算各柜型装柜量。</p>
        ) : (
          <>
            <p className="pkg-volume">
              单箱体积 <b>{loadingPlan.cartonVolume.toFixed(4)}</b> m³
            </p>
            <div className="pkg-container-grid">
              {loadingPlan.rows.map((row, index) => (
                <div className="pkg-container" key={row.key}>
                  <span className="pkg-container-name">{row.label}</span>
                  <span className="pkg-container-main">
                    <b>{row.cartons.toLocaleString('zh-CN')}</b> 箱
                  </span>
                  <span className="pkg-container-sub">
                    {row.pieces === null ? '装量未知' : `${row.pieces.toLocaleString('zh-CN')} pcs`}
                    {loadingPlan.totalWeight ? ` · 毛重 ${(loadingPlan.totalWeight[index] / 1000).toFixed(2)} t` : ''}
                  </span>
                </div>
              ))}
            </div>
            <p className="pkg-caveat">按柜内容积 28 / 58 / 68 m³ 估算，未计托盘与装载空隙，实际订舱请以货代确认为准。</p>
          </>
        )}
      </div>

      {error && <p className="pkg-error">{error}</p>}
      {notice && <p className="pkg-notice">{notice}</p>}

      {!readOnly && canEdit && (
        <div className="pkg-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={load} disabled={saving}>
            <RefreshIcon size={14} /> 还原
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
            {saving ? '保存中…' : '保存包装信息'}
          </button>
        </div>
      )}
    </form>
  )
}

export default PackagingPanel
