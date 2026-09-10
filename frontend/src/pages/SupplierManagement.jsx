import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { GridIcon, ListIcon } from '../components/Icons'

/**
 * 供应商管理（原生 React 版）
 *
 * 由 SKU Manager 的「供应商管理」视图迁移而来，功能对齐：
 * 卡片列表 · 未分类入口 · 新建/编辑 · 删除 · 详情（联系方式 / 供货清单 / 合同记录）。
 * 数据经 /api/sku/* 同源代理访问，禁止硬编码 SKU 的独立端口。
 */

const API = '/api/sku'

/* ------------------------------ 格式化工具 ------------------------------ */

const money = (n) => (n == null ? '—' : Number(n).toFixed(2))

function fmtDate(iso, withTime = true) {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base
}

function splitCats(text) {
  return String(text || '')
    .split(/[、,，;；/|\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** 从完整地址里抽出省市，卡片上只显示大致方位 */
function shortLocation(address) {
  const a = String(address || '').trim()
  if (!a) return ''
  const m = a.match(/^(.{2,4}?(?:省|市|自治区|特别行政区))?\s*(.{2,6}?(?:市|自治州|地区|县|区))?/)
  const parts = [m?.[1], m?.[2]].filter(Boolean)
  if (parts.length) return parts.join('')
  return a.length > 12 ? `${a.slice(0, 12)}…` : a
}

const FIELDS = [
  ['name', '供应商名称', true],
  ['short_name', '简称'],
  ['contact_person', '联系人'],
  ['phone', '电话'],
  ['email', '邮箱'],
  ['website', '网址'],
  ['payment_terms', '付款条件'],
  ['address', '地址']
]

const EMPTY_FORM = {
  name: '',
  short_name: '',
  contact_person: '',
  phone: '',
  email: '',
  website: '',
  payment_terms: '',
  address: '',
  main_categories: '',
  notes: ''
}

const FILE_TYPE_LABEL = {
  excel: 'Excel',
  'pdf-text': 'PDF 文字版',
  'pdf-scan': 'PDF 扫描件',
  unknown: '无法识别'
}

const STATUS_LABEL = { success: '成功', empty: '未识别到数据', failed: '失败' }
const STATUS_PILL = { success: 'pill pill-ok', empty: 'pill pill-mute', failed: 'pill pill-warn' }

/* -------------------------------- 小组件 -------------------------------- */

function CatChips({ text }) {
  const cats = splitCats(text)
  if (!cats.length) return <div className="chip-row"><span className="muted-note">未填主营类目</span></div>
  return (
    <div className="chip-row">
      {cats.map((c) => <span className="chip" key={c}>{c}</span>)}
    </div>
  )
}

function Kv({ label, value, mono }) {
  return (
    <div className="kv">
      <span className="kv-label">{label}</span>
      <span className={`kv-value${value ? '' : ' is-empty'}`} style={mono && value ? { fontFamily: 'var(--font-mono)' } : undefined}>
        {value || '未填写'}
      </span>
    </div>
  )
}

/* -------------------------------- 主页面 -------------------------------- */

function SupplierManagement() {
  const navigate = useNavigate()

  const [mode, setMode] = useState('list') // list | detail | form
  const [suppliers, setSuppliers] = useState([])
  const [unassigned, setUnassigned] = useState(0)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [keyword, setKeyword] = useState('')
  // 排列方式：卡片网格 / 横列表。选择记在本地，下次进来自动沿用。
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('happy.supplierView') || 'card' } catch { return 'card' }
  })

  const changeView = useCallback((next) => {
    setViewMode(next)
    try { localStorage.setItem('happy.supplierView', next) } catch { /* 隐私模式下忽略 */ }
  }, [])

  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')
  const [saving, setSaving] = useState(false)

  const loadList = useCallback(async () => {
    try {
      const [listRes, unassignedRes] = await Promise.all([
        axios.get(`${API}/suppliers`),
        axios.get(`${API}/suppliers/unassigned/count`).catch(() => ({ data: { count: 0 } }))
      ])
      setSuppliers(Array.isArray(listRes.data) ? listRes.data : [])
      setUnassigned(unassignedRes.data?.count || 0)
    } catch (err) {
      setNotice(err?.response?.data?.error || `加载供应商失败：${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return suppliers
    return suppliers.filter((s) =>
      [s.name, s.short_name, s.contact_person, s.phone, s.address, s.main_categories]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(kw)
    )
  }, [suppliers, keyword])

  const openDetail = useCallback(async (id) => {
    setMode('detail')
    setDetailLoading(true)
    setDetail(null)
    setNotice('')
    try {
      const { data } = await axios.get(`${API}/suppliers/${id}`)
      setDetail(data)
    } catch (err) {
      setNotice(err?.response?.data?.error || `加载详情失败：${err.message}`)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const startCreate = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setEditingName('')
    setNotice('')
    setMode('form')
  }

  const startEdit = (supplier) => {
    setForm({ ...EMPTY_FORM, ...Object.fromEntries(Object.entries(supplier).map(([k, v]) => [k, v ?? ''])) })
    setEditingId(supplier.id)
    setEditingName(supplier.name)
    setNotice('')
    setMode('form')
  }

  const save = async () => {
    const payload = {}
    for (const [key] of FIELDS) payload[key] = form[key]?.trim() || null
    payload.main_categories = form.main_categories?.trim() || null
    payload.notes = form.notes?.trim() || null

    if (!payload.name) {
      setNotice('供应商名称不能为空')
      return
    }

    setSaving(true)
    setNotice('')
    try {
      if (editingId) {
        await axios.put(`${API}/suppliers/${editingId}`, payload)
        await loadList()
        await openDetail(editingId)
      } else {
        const { data } = await axios.post(`${API}/suppliers`, payload)
        await loadList()
        await openDetail(data.id)
      }
    } catch (err) {
      setNotice(err?.response?.data?.error || `保存失败：${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const removeSupplier = async (id, name) => {
    const ok = window.confirm(
      `删除供应商「${name}」？\n\n该供应商名下的产品和价格会保留，只是变成「未指定供应商」。`
    )
    if (!ok) return
    try {
      await axios.delete(`${API}/suppliers/${id}`)
      await loadList()
      setDetail(null)
      setMode('list')
    } catch (err) {
      setNotice(err?.response?.data?.error || `删除失败：${err.message}`)
    }
  }

  /* ------------------------------- 列表视图 ------------------------------- */

  if (mode === 'list') {
    return (
      <div className="page-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">供应商管理</h1>
            <p className="page-sub">档案、联系方式、工厂所在地与主营类目</p>
          </div>
          <button className="btn btn-primary" onClick={startCreate}>+ 新建供应商</button>
        </div>

        {notice && <div className="notice-inline">{notice}</div>}

        <div className="toolbar">
          <input
            type="text"
            className="toolbar-search"
            placeholder="按名称 / 联系人 / 电话 / 地址搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <div className="toolbar-actions">
            <span className="secondary">共 {filtered.length} 家</span>
            <div className="view-toggle" role="group" aria-label="切换排列方式">
              <button
                type="button"
                className={viewMode === 'card' ? 'active' : ''}
                onClick={() => changeView('card')}
                title="卡片排列"
                aria-pressed={viewMode === 'card'}
              >
                <GridIcon size={16} />
              </button>
              <button
                type="button"
                className={viewMode === 'table' ? 'active' : ''}
                onClick={() => changeView('table')}
                title="列表排列"
                aria-pressed={viewMode === 'table'}
              >
                <ListIcon size={16} />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="loading">加载中…</div>
        ) : suppliers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏭</div>
            <div className="empty-state-title">还没有供应商档案</div>
            <div className="empty-state-hint">
              建好供应商后，导入合同时就能把价格归到对应供应商名下，查价时也能按供应商筛选。
            </div>
          </div>
        ) : viewMode === 'table' ? (
          <div className="table-container">
            <table className="data-table supplier-table">
              <thead>
                <tr>
                  <th>供应商</th>
                  <th>联系人</th>
                  <th>电话</th>
                  <th>工厂所在地</th>
                  <th>主营类目</th>
                  <th style={{ textAlign: 'right', width: 72 }}>产品</th>
                  <th style={{ textAlign: 'right', width: 72 }}>货号</th>
                  <th>付款条件</th>
                </tr>
              </thead>
              <tbody>
                {unassigned > 0 && (
                  <tr className="row-unassigned" onClick={() => navigate('/products')}>
                    <td className="bold">未分类</td>
                    <td className="secondary" colSpan={4}>还没归属供应商的产品</td>
                    <td className="number" style={{ textAlign: 'right' }}>{unassigned}</td>
                    <td className="number" style={{ textAlign: 'right' }}>—</td>
                    <td className="secondary">—</td>
                  </tr>
                )}
                {filtered.map((s) => (
                  <tr key={s.id} onClick={() => openDetail(s.id)}>
                    <td className="bold">{s.name}</td>
                    <td className="secondary">{s.contact_person || '—'}</td>
                    <td className="secondary mono">{s.phone || '—'}</td>
                    <td className="secondary" title={s.address || ''}>
                      {shortLocation(s.address) || '—'}
                    </td>
                    <td>
                      {splitCats(s.main_categories).length
                        ? <div className="chip-row">{splitCats(s.main_categories).map((c) => <span className="chip" key={c}>{c}</span>)}</div>
                        : <span className="muted-note">未填</span>}
                    </td>
                    <td className="number" style={{ textAlign: 'right' }}>{s.group_count ?? s.sku_count ?? 0}</td>
                    <td className="number" style={{ textAlign: 'right' }}>{s.sku_count ?? 0}</td>
                    <td className="secondary">{s.payment_terms || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="supplier-grid">
            {unassigned > 0 && (
              <div className="supplier-card is-unassigned" onClick={() => navigate('/products')}>
                <div className="sc-name">未分类</div>
                <div className="sc-contact"><span className="muted-note">还没归属供应商的产品</span></div>
                <div className="sc-foot">
                  <span className="sc-count"><b>{unassigned}</b> 个产品</span>
                </div>
              </div>
            )}
            {filtered.map((s) => {
              const contact = [s.contact_person, s.phone].filter(Boolean).join(' · ')
              const loc = shortLocation(s.address)
              return (
                <div className="supplier-card" key={s.id} onClick={() => openDetail(s.id)}>
                  <div className="sc-name">{s.name}</div>
                  <div className="sc-contact">
                    {contact || <span className="muted-note">未填联系人</span>}
                  </div>
                  <div className="sc-loc" title={s.address || ''}>
                    {loc || <span className="muted-note">未填工厂所在地</span>}
                  </div>
                  <CatChips text={s.main_categories} />
                  <div className="sc-foot">
                    <span className="sc-count">
                      <b>{s.group_count ?? s.sku_count}</b> 个产品 · {s.sku_count} 个货号
                    </span>
                    {s.payment_terms && <span className="chip">{s.payment_terms}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  /* ------------------------------- 详情视图 ------------------------------- */

  if (mode === 'detail') {
    const s = detail?.supplier
    const products = detail?.products || []
    const contracts = detail?.contracts || []

    return (
      <div className="page-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">{s?.name || '供应商详情'}</h1>
            {s && (
              <p className="page-sub">
                {s.short_name ? `${s.short_name} · ` : ''}
                供货 {products.length} 个货号 · {contracts.length} 份合同记录
              </p>
            )}
            {s && <CatChips text={s.main_categories} />}
          </div>
          <div className="header-actions">
            <button className="btn" onClick={() => { setDetail(null); setMode('list') }}>← 供应商列表</button>
            {s && <button className="btn btn-primary" onClick={() => startEdit(s)}>编辑档案</button>}
          </div>
        </div>

        {notice && <div className="notice-inline">{notice}</div>}

        {detailLoading || !s ? (
          <div className="loading">加载中…</div>
        ) : (
          <>
            <div className="card">
              <div className="card-header"><h2>联系方式</h2></div>
              <div className="kv-grid">
                <Kv label="联系人" value={s.contact_person} />
                <Kv label="电话" value={s.phone} mono />
                <Kv label="邮箱" value={s.email} mono />
                <Kv label="付款条件" value={s.payment_terms} />
                <Kv label="网址" value={s.website} mono />
                <Kv label="地址" value={s.address} />
              </div>
              {s.notes && (
                <div className="kv-grid" style={{ marginTop: 14 }}>
                  <Kv label="备注" value={s.notes} />
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <h2>供货清单</h2>
                <span className="secondary">{products.length} 条</span>
              </div>
              {products.length === 0 ? (
                <div className="empty-state" style={{ padding: '28px 12px' }}>
                  <div className="empty-state-hint">
                    还没有归到这家供应商的货号。导入合同时在「合同导入」页选上这家供应商即可。
                  </div>
                </div>
              ) : (
                <div className="table-container" style={{ maxHeight: 460 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 56 }}></th>
                        <th>货号</th>
                        <th>所属产品</th>
                        <th style={{ textAlign: 'right' }}>采购价</th>
                        <th style={{ textAlign: 'right' }}>起订量</th>
                        <th>更新时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p) => (
                        <tr key={`${p.sku}-${p.group_id ?? ''}`}>
                          <td>
                            {p.thumb
                              ? <img className="thumb" src={`/product-images/${p.thumb}`} alt="" loading="lazy" />
                              : <span className="thumb thumb-empty" />}
                          </td>
                          <td className="mono">{p.display_sku || p.sku}</td>
                          <td>{p.group_name || p.name || '—'}</td>
                          <td className="number" style={{ textAlign: 'right' }}>
                            <span className="secondary">¥</span>{money(p.price)}
                            {p.confidence === 'low' && <span className="pill pill-warn" style={{ marginLeft: 6 }}>待核对</span>}
                          </td>
                          <td className="number" style={{ textAlign: 'right' }}>{p.moq ?? '—'}</td>
                          <td className="secondary">{fmtDate(p.last_updated, false)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <h2>合同导入记录</h2>
                <span className="secondary">{contracts.length} 条</span>
              </div>
              {contracts.length === 0 ? (
                <div className="empty-state" style={{ padding: '28px 12px' }}>
                  <div className="empty-state-hint">还没有该供应商的合同导入记录。</div>
                </div>
              ) : (
                <div className="table-container" style={{ maxHeight: 340 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>文件名</th>
                        <th>类型</th>
                        <th style={{ textAlign: 'right' }}>新增</th>
                        <th style={{ textAlign: 'right' }}>更新</th>
                        <th>状态</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contracts.map((c) => (
                        <tr key={c.id}>
                          <td className="mono">
                            {c.has_file
                              ? <a href={`${API}/contracts/${c.id}/file`} title="下载原件">{c.filename}</a>
                              : c.filename}
                          </td>
                          <td className="secondary">{FILE_TYPE_LABEL[c.file_type] || c.file_type}</td>
                          <td className="number" style={{ textAlign: 'right' }}>{c.rows_new}</td>
                          <td className="number" style={{ textAlign: 'right' }}>{c.rows_matched}</td>
                          <td><span className={STATUS_PILL[c.status] || 'pill pill-mute'}>{STATUS_LABEL[c.status] || c.status}</span></td>
                          <td className="secondary">{fmtDate(c.processed_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  /* ------------------------------- 表单视图 ------------------------------- */

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">{editingId ? '编辑供应商' : '新建供应商'}</h1>
          <p className="page-sub">
            {editingId ? editingName : '填写基础档案，之后可以随时修改'}
          </p>
        </div>
        <button className="btn" onClick={() => (editingId ? openDetail(editingId) : setMode('list'))}>
          返回
        </button>
      </div>

      {notice && <div className="notice-inline">{notice}</div>}

      <div className="card" style={{ maxWidth: 860 }}>
        <div className="card-header"><h2>基础信息</h2></div>

        <div className="form-row">
          {FIELDS.map(([key, label, required]) => (
            <div className="form-group" key={key}>
              <label>{label}{required ? ' *' : ''}</label>
              <input
                type="text"
                value={form[key] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="form-group">
          <label>主营产品类目</label>
          <input
            type="text"
            placeholder="用顿号或逗号分隔，例如：长嘴钳、老虎钳、斜口钳、卡簧钳"
            value={form.main_categories}
            onChange={(e) => setForm((f) => ({ ...f, main_categories: e.target.value }))}
          />
        </div>

        <div className="form-group">
          <label>备注</label>
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
          {editingId && (
            <button
              className="btn btn-danger"
              onClick={() => removeSupplier(editingId, editingName)}
              disabled={saving}
            >
              删除该供应商
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default SupplierManagement
