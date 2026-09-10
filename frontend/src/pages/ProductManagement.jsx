import React, { useState, useEffect, useMemo, useCallback } from 'react'
import axios from 'axios'
import {
  CartIcon,
  ImageIcon,
  TrashIcon,
  PencilIcon,
  CloseIcon,
  PlusCircleIcon
} from '../components/Icons'

/**
 * 产品管理（原生 React 版）
 *
 * 由 SKU Manager 的「产品查询」视图迁移而来，功能对齐：
 * 检索 / 供应商与待核对筛选 / 反选批量 / 产品详情(货号×参数对比) / 产品与货号编辑
 * / 图片管理 / 小推车。数据统一经 /api/sku/* 同源代理，禁止硬编码 SKU 端口。
 */

const API = '/api/sku'
const ATTR_LIST_ID = 'sku-attr-names'

/* ------------------------------ 格式化工具 ------------------------------ */

const money = (n) => (n == null ? '—' : Number(n).toFixed(2))

function fmtDate(iso, withTime = false) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base
}

function priceRange(min, max) {
  if (min == null && max == null) return '—'
  if (min == null) return money(max)
  if (max == null || min === max) return money(min)
  return `${money(min)} ~ ${money(max)}`
}

function splitCats(text) {
  return String(text || '')
    .split(/[、,，;；/|\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

const thumbSrc = (filename) => `/product-images/${encodeURIComponent(filename)}`

/* ------------------------------ 小部件 ------------------------------ */

/** 关键：图片文件名来自后端，统一走同源代理地址，不拼 3300 */
function Thumb({ filename, count, size = 38 }) {
  const style = { width: size, height: size }
  if (!filename) {
    return (
      <span className="thumb thumb-empty" style={style}>
        <ImageIcon size={16} />
      </span>
    )
  }
  return (
    <span className="thumb-wrap" style={style}>
      <img className="thumb" style={style} src={thumbSrc(filename)} alt="" loading="lazy" />
      {count > 1 && <span className="thumb-badge">{count}</span>}
    </span>
  )
}

/** 参数编辑器：一组「参数名 / 值」，支持增删 */
function AttrEditor({ attrs, onChange }) {
  const list = Array.isArray(attrs) ? attrs : []
  const update = (i, key, val) =>
    onChange(list.map((a, idx) => (idx === i ? { ...a, [key]: val } : a)))
  const add = () => onChange([...list, { name: '', value: '' }])
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i))

  return (
    <div className="attr-editor">
      <div className="attr-rows">
        {list.map((a, i) => (
          <div className="attr-row" key={i}>
            <input
              type="text"
              className="attr-name"
              list={ATTR_LIST_ID}
              placeholder="参数名，如 夹紧力"
              value={a.name || ''}
              onChange={(e) => update(i, 'name', e.target.value)}
            />
            <input
              type="text"
              className="attr-value"
              placeholder="值，如 200kg"
              value={a.value || ''}
              onChange={(e) => update(i, 'value', e.target.value)}
            />
            <button type="button" className="icon-btn" title="删除这一行" onClick={() => remove(i)}>
              <CloseIcon size={14} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-sm" onClick={add}>
        <PlusCircleIcon size={14} /> 加一个参数
      </button>
    </div>
  )
}

/** 供应商下拉：空值 = 未指定 */
function SupplierSelect({ value, onChange, suppliers, style }) {
  return (
    <select value={value ?? ''} onChange={onChange} style={style}>
      <option value="">未指定供应商</option>
      {suppliers.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  )
}

/* ------------------------------ 抽屉外壳 ------------------------------ */

function Drawer({ wide, title, sub, onClose, headerExtra, footer, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className={`drawer${wide ? ' drawer-wide' : ''}`} role="dialog" aria-modal="true">
        <div className="drawer-header">
          <div className="drawer-head-main">
            <h2 className="drawer-title">{title}</h2>
            {sub && <p className="drawer-sub">{sub}</p>}
          </div>
          <div className="header-actions">
            {headerExtra}
            <button className="btn btn-sm btn-icon" onClick={onClose} title="关闭">
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-footer">{footer}</div>}
      </aside>
    </>
  )
}

/* ============================ 产品详情抽屉 ============================ */

function GroupDrawer({ groupId, highlightSku, suppliers, onClose, onChanged }) {
  const [data, setData] = useState(null)
  const [mode, setMode] = useState({ kind: 'view' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lightbox, setLightbox] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await axios.get(`${API}/group/${groupId}`)
      setData(res.data)
    } catch (e) {
      setError(e?.response?.data?.error || `加载产品失败：${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => { load() }, [load])

  const refresh = useCallback(async () => {
    await load()
    onChanged?.()
  }, [load, onChanged])

  const g = data?.group
  const items = data?.items || []
  const groupAttributes = data?.groupAttributes || []
  const images = data?.images || []

  // 列 = 所有货号参数名的并集，用于货号×参数对比
  const attrCols = useMemo(() => {
    const cols = []
    for (const it of items) for (const a of it.attributes || []) if (!cols.includes(a.name)) cols.push(a.name)
    return cols
  }, [items])

  const uploadImages = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const fd = new FormData()
    for (const f of files) fd.append('images', f)
    setBusy(true)
    setError('')
    try {
      await axios.post(`${API}/group/${groupId}/images`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      await refresh()
    } catch (err) {
      setError(err?.response?.data?.error || `上传失败：${err.message}`)
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  const setPrimary = async (id) => {
    try {
      await axios.post(`${API}/images/${id}/primary`)
      await refresh()
    } catch (err) {
      setError(err?.response?.data?.error || err.message)
    }
  }

  const removeImage = async (id) => {
    if (!window.confirm('删除这张图片？')) return
    try {
      await axios.delete(`${API}/images/${id}`)
      await refresh()
    } catch (err) {
      setError(err?.response?.data?.error || err.message)
    }
  }

  /* ------------------------------- 视图分支 ------------------------------- */

  if (loading) {
    return (
      <Drawer wide title="加载中…" onClose={onClose}>
        <div className="loading"><span className="spinner" /></div>
      </Drawer>
    )
  }

  if (!data || !g) {
    return (
      <Drawer wide title="产品详情" onClose={onClose}>
        {error && <div className="notice-inline">{error}</div>}
      </Drawer>
    )
  }

  const meta = [g.brand, g.category, g.supplier_name].filter(Boolean).join(' · ')

  let body = null
  let headerExtra = null
  let footer = null
  let title = g.name
  let sub = `${meta || '品牌/分类/供应商 未填写'} · ${items.length} 个货号`

  if (mode.kind === 'view') {
    headerExtra = (
      <button className="btn btn-sm" onClick={() => setMode({ kind: 'editGroup' })}>
        <PencilIcon size={14} /> 编辑产品
      </button>
    )

    body = (
      <>
        {error && <div className="notice-inline">{error}</div>}

        {g.description && (
          <div className="panel">
            <div className="panel-title">产品说明</div>
            <div className="spec-text">{g.description}</div>
          </div>
        )}

        {groupAttributes.length > 0 && (
          <div className="panel">
            <div className="panel-title">通用参数（全部货号共用）</div>
            <div className="chip-row">
              {groupAttributes.map((a) => (
                <span className="chip" key={a.name}><b>{a.name}</b>{a.value ? ` ${a.value}` : ''}</span>
              ))}
            </div>
          </div>
        )}

        <div className="panel">
          <div className="panel-title">货号与参数</div>
          <div className="table-container" style={{ maxHeight: 380 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>货号</th>
                  <th>规格</th>
                  <th style={{ textAlign: 'right' }}>采购价</th>
                  <th style={{ textAlign: 'right' }}>MOQ</th>
                  {attrCols.map((c) => <th key={c}>{c}</th>)}
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={5 + attrCols.length} className="secondary" style={{ textAlign: 'center' }}>还没有货号</td></tr>
                ) : items.map((it) => {
                  const attrMap = {}
                  for (const a of it.attributes || []) attrMap[a.name] = a.value
                  return (
                    <tr
                      key={it.sku}
                      className={highlightSku && it.sku === highlightSku ? 'row-hit' : ''}
                      onClick={() => setMode({ kind: 'editItem', sku: it.sku })}
                    >
                      <td className="mono bold">{it.display_sku || it.sku}</td>
                      <td className="secondary">{it.spec || '—'}</td>
                      <td className="number" style={{ textAlign: 'right' }}>
                        <span className="unit">¥</span>{money(it.price)}
                        {it.confidence === 'low' && <span className="pill pill-warn" style={{ marginLeft: 6 }}>待核对</span>}
                      </td>
                      <td className="number" style={{ textAlign: 'right' }}>{it.moq ?? '—'}</td>
                      {attrCols.map((c) => <td key={c} className="secondary">{attrMap[c] || '—'}</td>)}
                      <td><button className="btn btn-sm">编辑</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 11 }}>
            <button className="btn btn-sm" onClick={() => setMode({ kind: 'newItem' })}>
              <PlusCircleIcon size={14} /> 新增货号
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">产品图片</div>
          <div className="gallery">
            {images.map((img) => (
              <div className="gallery-item" key={img.id}>
                <img
                  src={thumbSrc(img.filename)}
                  alt={img.original_name || ''}
                  onClick={() => setLightbox(thumbSrc(img.filename))}
                />
                {img.is_primary === 1 && <span className="gallery-flag">封面</span>}
                <div className="gallery-actions">
                  {img.is_primary !== 1 && (
                    <button className="btn btn-sm" onClick={() => setPrimary(img.id)}>设封面</button>
                  )}
                  <button className="btn btn-sm btn-danger" onClick={() => removeImage(img.id)}>
                    <TrashIcon size={13} />
                  </button>
                </div>
              </div>
            ))}
            <label className="add-image">
              <PlusCircleIcon size={18} />
              <span>{busy ? '上传中…' : '添加图片'}</span>
              <input type="file" accept="image/*" multiple onChange={uploadImages} disabled={busy} />
            </label>
          </div>
        </div>
      </>
    )
  } else if (mode.kind === 'editGroup') {
    title = '编辑产品'
    sub = g.name
    body = (
      <GroupForm
        group={g}
        groupAttributes={groupAttributes}
        suppliers={suppliers}
        onCancel={() => setMode({ kind: 'view' })}
        onSaved={async () => { setMode({ kind: 'view' }); await refresh() }}
      />
    )
  } else if (mode.kind === 'newItem') {
    title = '新增货号'
    sub = g.name
    body = (
      <ItemForm
        groupId={groupId}
        group={g}
        items={items}
        onCancel={() => setMode({ kind: 'view' })}
        onSaved={async () => { setMode({ kind: 'view' }); await refresh() }}
      />
    )
  } else if (mode.kind === 'editItem') {
    title = '编辑货号'
    sub = mode.sku
    body = (
      <ItemEditor
        sku={mode.sku}
        groupId={groupId}
        suppliers={suppliers}
        onBack={() => setMode({ kind: 'view' })}
        onSaved={async () => { setMode({ kind: 'view' }); await refresh() }}
        onDeleted={async () => { onClose(); onChanged?.() }}
      />
    )
  }

  return (
    <>
      <Drawer wide title={title} sub={sub} onClose={onClose} headerExtra={headerExtra} footer={footer}>
        {body}
      </Drawer>
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox('')}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </>
  )
}

/* ---------------------------- 产品编辑表单 ---------------------------- */

function GroupForm({ group, groupAttributes, suppliers, onCancel, onSaved }) {
  const [form, setForm] = useState({
    name: group.name || '',
    brand: group.brand || '',
    category: group.category || '',
    supplier_id: group.supplier_id || '',
    description: group.description || ''
  })
  const [attrs, setAttrs] = useState(groupAttributes.map((a) => ({ name: a.name, value: a.value || '' })))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) { setError('产品名称不能为空'); return }
    setSaving(true)
    setError('')
    try {
      await axios.put(`${API}/group/${group.id}`, {
        name: form.name.trim(),
        brand: form.brand,
        category: form.category,
        supplier_id: form.supplier_id || null,
        description: form.description,
        attributes: attrs.filter((a) => a.name.trim())
      })
      await onSaved()
    } catch (e) {
      setError(e?.response?.data?.error || `保存失败：${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-title">编辑产品</div>
      {error && <div className="notice-inline">{error}</div>}

      <div className="form-group">
        <label>产品名称 *</label>
        <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>品牌</label>
          <input type="text" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
        </div>
        <div className="form-group">
          <label>分类</label>
          <input type="text" value={form.category} onChange={(e) => set('category', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>供应商</label>
        <SupplierSelect value={form.supplier_id} suppliers={suppliers} onChange={(e) => set('supplier_id', e.target.value)} />
      </div>
      <div className="form-group">
        <label>产品说明</label>
        <textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div className="form-group">
        <label>通用参数（全部货号共用，如 材质）</label>
        <AttrEditor attrs={attrs} onChange={setAttrs} />
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button className="btn" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </div>
  )
}

/* ---------------------------- 货号新增表单 ---------------------------- */

function ItemForm({ groupId, group, items, onCancel, onSaved }) {
  const [form, setForm] = useState({ sku: '', spec: '', price: '', moq: '', description: '' })
  const [attrs, setAttrs] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const copyFrom = (sku) => {
    const src = items.find((it) => it.sku === sku)
    setAttrs(src ? src.attributes.map((a) => ({ name: a.name, value: a.value || '' })) : [])
  }

  const save = async () => {
    if (!form.sku.trim()) { setError('货号不能为空'); return }
    setSaving(true)
    setError('')
    try {
      await axios.post(`${API}/group/${groupId}/items`, {
        sku: form.sku.trim(),
        spec: form.spec,
        price: form.price,
        moq: form.moq,
        description: form.description,
        name: group.name,
        attributes: attrs.filter((a) => a.name.trim())
      })
      await onSaved()
    } catch (e) {
      setError(e?.response?.data?.error || `创建失败：${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-title">新增货号 · {group.name}</div>
      {error && <div className="notice-inline">{error}</div>}

      <div className="form-row">
        <div className="form-group">
          <label>货号 *</label>
          <input type="text" placeholder="例如 FC-50200" value={form.sku} onChange={(e) => set('sku', e.target.value)} />
        </div>
        <div className="form-group">
          <label>规格</label>
          <input type="text" placeholder="例如 50×200mm" value={form.spec} onChange={(e) => set('spec', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>采购价</label>
          <input type="number" min="0" step="0.01" placeholder="可留空" value={form.price} onChange={(e) => set('price', e.target.value)} />
        </div>
        <div className="form-group">
          <label>起订量 MOQ</label>
          <input type="number" min="0" step="1" placeholder="可留空" value={form.moq} onChange={(e) => set('moq', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>交付标准与要求</label>
        <textarea rows={4} placeholder="材质、包装要求等" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      {items.length > 0 && (
        <div className="form-group">
          <label>从现有货号复制参数</label>
          <select defaultValue="" onChange={(e) => copyFrom(e.target.value)}>
            <option value="">不复制</option>
            {items.map((it) => (
              <option key={it.sku} value={it.sku}>{it.display_sku || it.sku}</option>
            ))}
          </select>
        </div>
      )}
      <div className="form-group">
        <label>货号参数（随尺寸变的，如 夹紧力 / 开口）</label>
        <AttrEditor attrs={attrs} onChange={setAttrs} />
      </div>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? '创建中…' : '创建'}
        </button>
        <button className="btn" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </div>
  )
}

/* ---------------------------- 货号编辑器 ---------------------------- */

function ItemEditor({ sku, groupId, suppliers, onBack, onSaved, onDeleted }) {
  const [product, setProduct] = useState(null)
  const [history, setHistory] = useState([])
  const [groupChoices, setGroupChoices] = useState([])
  const [form, setForm] = useState(null)
  const [attrs, setAttrs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await axios.get(`${API}/product/${encodeURIComponent(sku)}`)
        if (!alive) return
        const p = data.product
        setProduct(p)
        setHistory(data.history || [])
        setForm({
          price: p.price ?? '',
          moq: p.moq ?? '',
          name: p.name ?? '',
          spec: p.spec ?? '',
          description: p.description ?? '',
          group_id: String(p.group_id ?? '')
        })
        setAttrs((p.attributes || []).map((a) => ({ name: a.name, value: a.value || '' })))
      } catch (e) {
        if (alive) setError(e?.response?.data?.error || `加载货号失败：${e.message}`)
      } finally {
        if (alive) setLoading(false)
      }
      try {
        const { data } = await axios.get(`${API}/search`)
        if (alive) setGroupChoices(Array.isArray(data) ? data : [])
      } catch { /* 目标产品列表拉不到不影响编辑其他字段 */ }
    })()
    return () => { alive = false }
  }, [sku])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  if (loading) return <div className="loading"><span className="spinner" /></div>
  if (!product || !form) {
    return (
      <>
        {error && <div className="notice-inline">{error}</div>}
        <button className="btn" onClick={onBack}>返回</button>
      </>
    )
  }

  const priceEditable = !product.contract_id

  const save = async () => {
    setSaving(true)
    setError('')
    const payload = {
      name: form.name,
      spec: form.spec,
      description: form.description,
      moq: form.moq,
      attributes: attrs.filter((a) => a.name.trim())
    }
    if (priceEditable) payload.price = form.price
    if (String(form.group_id) !== String(product.group_id)) {
      payload.group_id = form.group_id === 'new' ? 'new' : form.group_id
    }
    try {
      await axios.put(`${API}/product/${encodeURIComponent(sku)}`, payload)
      await onSaved()
    } catch (e) {
      setError(e?.response?.data?.error || `保存失败：${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`删除货号「${product.display_sku || product.sku}」？\n\n调价历史会保留备查；所在产品若变空会一并清理。`)) return
    try {
      await axios.delete(`${API}/product/${encodeURIComponent(sku)}`)
      await onDeleted()
    } catch (e) {
      setError(e?.response?.data?.error || `删除失败：${e.message}`)
    }
  }

  return (
    <>
      {product.confidence === 'low' && (
        <div className="note note-warn">
          这条价格来自扫描件 OCR 识别，数字可能有误。报价前建议核对原始合同
          {product.source_contract ? ` ${product.source_contract}` : ''}。
        </div>
      )}
      <div className="note note-info">
        {priceEditable
          ? '这个货号是手工建的，采购价可以直接改，每次改动都会记进调价历史。'
          : `采购价不可手改 —— 它来自合同 ${product.source_contract || ''}，必须保持可追溯。其余字段随便改。`}
      </div>

      <div className="panel">
        <div className="panel-title">编辑货号 {product.display_sku || product.sku}</div>
        {error && <div className="notice-inline">{error}</div>}

        <div className="form-row">
          <div className="form-group">
            <label>采购价{priceEditable ? '' : '（合同锁定）'}</label>
            {priceEditable ? (
              <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} />
            ) : (
              <input type="text" value={`¥${money(product.price)}`} disabled />
            )}
          </div>
          <div className="form-group">
            <label>起订量 MOQ</label>
            <input type="number" min="0" step="1" value={form.moq} onChange={(e) => set('moq', e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>品名（该货号自己的叫法）</label>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="form-group">
            <label>规格</label>
            <input type="text" value={form.spec} onChange={(e) => set('spec', e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label>交付标准与要求</label>
          <textarea rows={5} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>

        <div className="form-group">
          <label>所属产品</label>
          <select value={form.group_id} onChange={(e) => set('group_id', e.target.value)}>
            {groupChoices.map((gc) => (
              <option key={gc.id} value={gc.id}>
                {gc.name}（{gc.item_count} 个货号）
              </option>
            ))}
            {String(product.group_id) && !groupChoices.some((gc) => String(gc.id) === String(product.group_id)) && (
              <option value={product.group_id}>{product.group_name || '当前产品'}</option>
            )}
            <option value="new">— 独立成新产品 —</option>
          </select>
        </div>

        <div className="form-group">
          <label>货号参数</label>
          <AttrEditor attrs={attrs} onChange={setAttrs} />
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button className="btn" onClick={onBack} disabled={saving}>返回</button>
          <button className="btn btn-danger" onClick={remove} disabled={saving}>
            <TrashIcon size={14} /> 删除货号
          </button>
        </div>
      </div>

      {product.contract_terms && (
        <div className="panel">
          <details className="terms">
            <summary>来源合同通用要求</summary>
            <div className="spec-text">{product.contract_terms}</div>
          </details>
        </div>
      )}

      <div className="panel">
        <div className="panel-title">调价记录</div>
        {history.length === 0 ? (
          <div className="secondary">还没有调价记录。</div>
        ) : (
          <div className="timeline">
            {history.map((h) => (
              <div className="timeline-item" key={h.id}>
                <div className="timeline-dot" />
                <div className="timeline-main">
                  <div className="timeline-title">
                    采购价 <b><span className="unit">¥</span>{money(h.old_price)}</b>
                    {' → '}
                    <b><span className="unit">¥</span>{money(h.new_price)}</b>
                    {h.old_moq !== h.new_moq && <span className="secondary"> · MOQ {h.old_moq ?? '—'} → {h.new_moq ?? '—'}</span>}
                  </div>
                  <div className="timeline-meta">
                    {fmtDate(h.changed_at, true)}
                    {h.source_contract ? ` · ${h.source_contract}` : ''}
                    {h.supplier_name ? ` · ${h.supplier_name}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

/* ---------------------------- 新增产品抽屉 ---------------------------- */

function NewProductDrawer({ suppliers, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', brand: '', category: '', supplier_id: '', description: '',
    sku: '', spec: '', price: '', moq: '', itemDesc: ''
  })
  const [attrs, setAttrs] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) { setError('产品名称不能为空'); return }
    if (!form.sku.trim()) { setError('至少需要一个货号'); return }
    setSaving(true)
    setError('')
    try {
      const { data } = await axios.post(`${API}/groups`, {
        name: form.name.trim(),
        brand: form.brand,
        category: form.category,
        supplier_id: form.supplier_id || null,
        description: form.description,
        item: {
          sku: form.sku.trim(),
          spec: form.spec,
          price: form.price,
          moq: form.moq,
          description: form.itemDesc,
          attributes: attrs.filter((a) => a.name.trim())
        }
      })
      onCreated?.(data.group_id)
    } catch (e) {
      setError(e?.response?.data?.error || `创建失败：${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      title="新增产品"
      sub="先建产品，再往里加货号；合同还没到的货也可以先建档"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '创建中…' : '创建'}
          </button>
          <button className="btn" onClick={onClose} disabled={saving}>取消</button>
        </>
      }
    >
      {error && <div className="notice-inline">{error}</div>}

      <div className="panel">
        <div className="panel-title">产品信息</div>
        <div className="form-group">
          <label>产品名称 *</label>
          <input type="text" placeholder="例如 重型F夹" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>品牌</label>
            <input type="text" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
          </div>
          <div className="form-group">
            <label>分类</label>
            <input type="text" value={form.category} onChange={(e) => set('category', e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>供应商</label>
          <SupplierSelect value={form.supplier_id} suppliers={suppliers} onChange={(e) => set('supplier_id', e.target.value)} />
        </div>
        <div className="form-group">
          <label>产品说明</label>
          <textarea rows={3} placeholder="所有尺寸共用的介绍，可留空" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">第一个货号</div>
        <div className="form-row">
          <div className="form-group">
            <label>货号 *</label>
            <input type="text" placeholder="例如 FC-50200" value={form.sku} onChange={(e) => set('sku', e.target.value)} />
          </div>
          <div className="form-group">
            <label>规格</label>
            <input type="text" placeholder="例如 50×200mm" value={form.spec} onChange={(e) => set('spec', e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>采购价</label>
            <input type="number" min="0" step="0.01" placeholder="可留空" value={form.price} onChange={(e) => set('price', e.target.value)} />
          </div>
          <div className="form-group">
            <label>起订量 MOQ</label>
            <input type="number" min="0" step="1" placeholder="可留空" value={form.moq} onChange={(e) => set('moq', e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>交付标准与要求</label>
          <textarea rows={3} placeholder="材质、包装要求等" value={form.itemDesc} onChange={(e) => set('itemDesc', e.target.value)} />
        </div>
        <div className="form-group">
          <label>货号参数（如 夹紧力 / 开口 / 功率）</label>
          <AttrEditor attrs={attrs} onChange={setAttrs} />
        </div>
      </div>
    </Drawer>
  )
}

/* ------------------------------ 小推车抽屉 ------------------------------ */

function CartDrawer({ onClose, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/cart`)
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e?.response?.data?.error || `加载小推车失败：${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const setQty = async (sku, qty) => {
    try {
      const { data } = await axios.patch(`${API}/cart/${encodeURIComponent(sku)}`, { qty })
      setRows(data.rows || [])
      onChanged?.()
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    }
  }

  const removeRow = async (sku) => {
    try {
      const { data } = await axios.delete(`${API}/cart/${encodeURIComponent(sku)}`)
      setRows(data.rows || [])
      onChanged?.()
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    }
  }

  const clear = async () => {
    if (!window.confirm(`清空小推车里的 ${rows.length} 个货号？\n\n只是清空清单，产品本身不受影响。`)) return
    try {
      const { data } = await axios.post(`${API}/cart/clear`)
      setRows(data.rows || [])
      onChanged?.()
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    }
  }

  const missingQty = rows.filter((r) => !r.qty).length
  const noPrice = rows.filter((r) => r.price == null).length
  const total = rows.reduce((s, r) => s + (r.price || 0) * (r.qty || 0), 0)

  return (
    <Drawer
      wide
      title="小推车"
      sub={loading ? '加载中…' : `${rows.length} 个货号`}
      onClose={onClose}
      footer={
        rows.length > 0 ? (
          <>
            <span className="cart-total">
              {missingQty > 0
                ? `还有 ${missingQty} 行没填数量，填齐后显示采购合计`
                : <>采购合计 <b className="price"><span className="unit">¥</span>{money(total)}</b></>}
              {noPrice > 0 && <span className="secondary" style={{ marginLeft: 10 }}>{noPrice} 个货号库里没有采购价</span>}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm btn-danger" onClick={clear}>清空</button>
            <button className="btn btn-primary" onClick={() => window.alert('汇总报价下一步接入：需要先定「从 CRM 选客户 / 自动带出单证字段」的方案，方案定了我就把报价单那步补上。')}>
              汇总报价 →
            </button>
          </>
        ) : null
      }
    >
      {error && <div className="notice-inline">{error}</div>}

      {loading ? (
        <div className="loading"><span className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><CartIcon size={40} /></div>
          <div className="empty-state-title">小推车是空的</div>
          <div className="empty-state-hint">在产品列表勾选后点「加入小推车」，就能一次性出报价单。</div>
        </div>
      ) : (
        <div className="cart-list">
          {rows.map((r) => {
            const name = r.product_name || r.display_sku || r.sku
            const meta = [r.spec, r.supplier_short || r.supplier_name].filter(Boolean).join(' · ')
            return (
              <div className="cart-row" key={r.sku}>
                <div className="cart-thumb"><Thumb filename={r.image} size={44} /></div>
                <div className="cart-main">
                  <div className="cart-name">{name}</div>
                  <div className="cart-meta">
                    <code>{r.display_sku || r.sku}</code>{meta ? ` · ${meta}` : ''}
                  </div>
                </div>
                <div className="cart-price number">
                  {r.price == null
                    ? <span className="secondary">无采购价</span>
                    : <><span className="unit">¥</span>{money(r.price)}</>}
                  {r.moq ? <div className="secondary" style={{ fontSize: 12 }}>MOQ {r.moq}</div> : null}
                </div>
                <label className="cart-qty">
                  <span>数量</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder={r.moq ? String(r.moq) : ''}
                    defaultValue={r.qty ?? ''}
                    onBlur={(e) => {
                      if (String(r.qty ?? '') !== e.target.value) setQty(r.sku, e.target.value)
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
                  />
                </label>
                <button className="btn btn-sm btn-icon btn-danger" title="移出小推车" onClick={() => removeRow(r.sku)}>
                  <CloseIcon size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Drawer>
  )
}

/* ============================== 主页面 ============================== */

function ProductManagement() {
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [noticeOk, setNoticeOk] = useState(false)

  const [suppliers, setSuppliers] = useState([])
  const [attrNames, setAttrNames] = useState([])
  const [cartCount, setCartCount] = useState(0)

  const [selected, setSelected] = useState(() => new Set())
  const [panel, setPanel] = useState(null)

  /* 关键词防抖 250ms */
  useEffect(() => {
    const t = setTimeout(() => setQuery(keyword.trim()), 250)
    return () => clearTimeout(t)
  }, [keyword])

  const refreshCart = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/cart`)
      setCartCount(Array.isArray(data) ? data.length : 0)
    } catch { /* 小推车拉不到不影响主流程 */ }
  }, [])

  const runSearch = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      const params = {}
      if (query) params.q = query
      if (supplierFilter) params.supplier_id = supplierFilter
      if (onlyLow) params.only_low = '1'
      const { data } = await axios.get(`${API}/search`, { params })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      // 结果集变了，原来选中的只保留还看得见的
      const visible = new Set(list.map((r) => r.id))
      setSelected((prev) => new Set([...prev].filter((id) => visible.has(id))))
    } catch (e) {
      setRows([])
      setNotice(e?.response?.data?.error || `检索失败：${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [query, supplierFilter, onlyLow])

  useEffect(() => { runSearch() }, [runSearch])

  useEffect(() => {
    ;(async () => {
      try {
        const { data } = await axios.get(`${API}/suppliers`)
        setSuppliers(Array.isArray(data) ? data : [])
      } catch { /* 下拉缺供应商仍可用 */ }
      try {
        const { data } = await axios.get(`${API}/attr-names`)
        setAttrNames(Array.isArray(data) ? data : [])
      } catch { /* 参数名提示拉不到不影响编辑 */ }
      refreshCart()
    })()
  }, [refreshCart])

  const afterMutate = useCallback(() => {
    runSearch()
    refreshCart()
  }, [runSearch, refreshCart])

  /* ----------------------------- 选择逻辑 ----------------------------- */

  const togglePick = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allPicked = rows.length > 0 && selected.size === rows.length
  const somePicked = selected.size > 0 && selected.size < rows.length

  const toggleAll = () => setSelected(allPicked ? new Set() : new Set(rows.map((r) => r.id)))
  const invert = () => setSelected(new Set(rows.map((r) => r.id).filter((id) => !selected.has(id))))
  const clearSel = () => setSelected(new Set())

  const addToCart = async () => {
    const ids = [...selected]
    if (!ids.length) return
    try {
      const { data } = await axios.post(`${API}/cart`, { group_ids: ids })
      await refreshCart()
      setNotice(data.added ? `已加入 ${data.added} 个货号到小推车` : '选中的货号都已经在小推车里了')
    } catch (e) {
      setNotice(e?.response?.data?.error || e.message)
    }
  }

  const deleteSelected = async () => {
    const ids = [...selected]
    if (!ids.length) return
    const names = rows.filter((r) => selected.has(r.id)).slice(0, 5).map((r) => r.name)
    const more = ids.length > names.length ? `\n…等共 ${ids.length} 个产品` : ''
    if (!window.confirm(`确定删除以下产品？连同它们下面的所有货号一并删除，不能撤销。\n\n${names.join('\n')}${more}\n\n（调价历史会保留）`)) return
    try {
      const { data } = await axios.post(`${API}/groups/delete`, { ids })
      setSelected(new Set())
      setNoticeOk(true)
      setNotice(`已删除 ${data.groups} 个产品 / ${data.items} 个货号`)
      afterMutate()
    } catch (e) {
      setNoticeOk(false)
      setNotice(e?.response?.data?.error || e.message)
    }
  }

  /* ------------------------------- 渲染 ------------------------------- */

  return (
    <div className="page-container">
      <datalist id={ATTR_LIST_ID}>
        {attrNames.map((n) => <option key={n} value={n} />)}
      </datalist>

      <div className="page-header">
        <div>
          <h1 className="page-title">产品管理</h1>
          <p className="page-sub">按货号、品名、规格或参数检索产品与采购价</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => setPanel({ kind: 'cart' })}>
            <CartIcon size={16} /> 小推车{cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
          <button className="btn btn-primary" onClick={() => setPanel({ kind: 'new' })}>
            <PlusCircleIcon size={16} /> 新增产品
          </button>
        </div>
      </div>

      {notice && <div className="notice-inline">{notice}</div>}

      <div className="toolbar">
        <input
          type="text"
          className="toolbar-search"
          placeholder="输入货号 / 品名 / 规格 / 参数 关键词…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
          <option value="">全部供应商</option>
          <option value="none">未分类（无供应商）</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="check-inline">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          只看待核对
        </label>
        <div className="toolbar-actions">
          <span className="secondary">共 {rows.length} 个产品</span>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="batch-bar">
          <span>已选 <b>{selected.size}</b> 个产品</span>
          <button className="btn btn-sm" onClick={invert}>反选</button>
          <button className="btn btn-sm" onClick={clearSel}>取消选择</button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-primary" onClick={addToCart}>加入小推车</button>
          <button className="btn btn-sm btn-danger" onClick={deleteSelected}>删除</button>
        </div>
      )}

      {loading ? (
        <div className="loading"><span className="spinner" /></div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><ImageIcon size={40} /></div>
          <div className="empty-state-title">
            {query || supplierFilter || onlyLow ? '没有匹配的记录' : '产品库还是空的'}
          </div>
          <div className="empty-state-hint">
            {query || supplierFilter || onlyLow
              ? '换个关键词试试，或者用右上角「新增产品」直接建一个。'
              : '到「合同导入」页把进货合同拖进来自动提取，或者用「新增产品」手工建档。'}
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table product-table">
            <thead>
              <tr>
                <th style={{ width: 42 }}>
                  <input
                    type="checkbox"
                    checked={allPicked}
                    ref={(el) => { if (el) el.indeterminate = somePicked }}
                    onChange={toggleAll}
                    title="全选 / 取消全选"
                  />
                </th>
                <th style={{ width: 56 }}></th>
                <th>产品</th>
                <th style={{ textAlign: 'right', width: 84 }}>货号数</th>
                <th style={{ textAlign: 'right', width: 160 }}>采购价</th>
                <th style={{ width: 150 }}>供应商</th>
                <th style={{ width: 120 }}>更新时间</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const picked = selected.has(g.id)
                const hits = (g.matched_items || []).slice(0, 6).map((m) => m.display_sku || m.sku).join('、')
                const meta = [g.brand, g.category].filter(Boolean).join(' · ')
                return (
                  <tr
                    key={g.id}
                    className={picked ? 'row-picked' : ''}
                    onClick={() => setPanel({ kind: 'group', groupId: g.id, highlightSku: g.matched_items?.[0]?.sku || null })}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() => togglePick(g.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td><Thumb filename={g.thumb} count={g.image_count} /></td>
                    <td>
                      <div className="bold">{g.name}</div>
                      {meta && <div className="secondary" style={{ fontSize: 12 }}>{meta}</div>}
                      {hits && (
                        <div className="hit-line">
                          命中货号：{hits}{g.matched_items.length > 6 ? ' …' : ''}
                        </div>
                      )}
                    </td>
                    <td className="number" style={{ textAlign: 'right' }}>{g.item_count}</td>
                    <td className="number" style={{ textAlign: 'right' }}>
                      <span className="unit">¥</span>{priceRange(g.price_min, g.price_max)}
                      {g.low_count > 0 && <span className="pill pill-warn" style={{ marginLeft: 6 }}>待核对</span>}
                    </td>
                    <td className="secondary">{g.supplier_name ? (g.supplier_short || g.supplier_name) : '未指定'}</td>
                    <td className="secondary">{fmtDate(g.last_updated)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {panel?.kind === 'group' && (
        <GroupDrawer
          groupId={panel.groupId}
          highlightSku={panel.highlightSku}
          suppliers={suppliers}
          onClose={() => setPanel(null)}
          onChanged={afterMutate}
        />
      )}

      {panel?.kind === 'new' && (
        <NewProductDrawer
          suppliers={suppliers}
          onClose={() => setPanel(null)}
          onCreated={() => { setPanel(null); afterMutate() }}
        />
      )}

      {panel?.kind === 'cart' && (
        <CartDrawer onClose={() => { setPanel(null); refreshCart() }} onChanged={refreshCart} />
      )}
    </div>
  )
}

export default ProductManagement
