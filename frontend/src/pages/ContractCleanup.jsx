import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  CleanupIcon, DownloadIcon, RefreshIcon, CheckIcon, CloseIcon, PencilIcon, SparkIcon, ContractIcon
} from '../components/Icons'
import { SkuThumb, useSkuThumbs } from '../components/SkuThumb'

const JOB_STATUS = {
  queued: { label: '排队中', tone: 'mute' },
  parsing: { label: '解析中', tone: 'warn' },
  pending_review: { label: '待复核', tone: 'warn' },
  reviewed: { label: '已复核', tone: 'ok' },
  parse_failed: { label: '解析失败', tone: 'danger' }
}

const ITEM_STATUS = {
  pending_review: { label: '待复核', tone: 'warn' },
  approved: { label: '已通过', tone: 'ok' },
  rejected: { label: '已驳回', tone: 'danger' }
}

/** 一条明细的状态显示：入库过的优先显示「已入库」——它比 approved 更具体 */
function itemStatusMeta(item) {
  if (item.committed_at) return { label: '已入库', tone: 'ok' }
  return ITEM_STATUS[item.status] || { label: item.status, tone: 'mute' }
}

function formatMoment(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 解析结果表头认了哪几列 —— 规则引擎唯一能自证的现场，认错了就看这里 */
function ColumnMapPanel({ raw }) {
  const map = useMemo(() => {
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      const entries = Object.entries(parsed || {})
      return entries.length ? entries : null
    } catch {
      return null
    }
  }, [raw])

  if (!map) {
    return <p className="muted-note">没有认出任一列 —— 可以用「AI 解析」或逐条手工补录。</p>
  }
  return (
    <div className="col-map">
      {map.map(([field, hit]) => (
        <span className="col-map-item" key={field}>
          <b>{field}</b>
          <span className="col-map-arrow">←</span>
          <span className="col-map-head">{hit.header}</span>
          <em>{hit.score} 分</em>
        </span>
      ))}
    </div>
  )
}

/** 单行复核编辑器：点「修正」后就地变成可编辑，避免为了改一个价格再开一层弹窗 */
function ReviewRow({ item, selected, onToggle, onReviewed, onCommitted, thumbs }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    sku: item.sku || '',
    product_name: item.product_name || '',
    spec: item.spec || '',
    purchase_price: item.purchase_price === null || item.purchase_price === undefined ? '' : String(item.purchase_price),
    currency: item.currency || '',
    quantity: item.quantity === null || item.quantity === undefined ? '' : String(item.quantity),
    moq: item.moq === null || item.moq === undefined ? '' : String(item.moq),
    review_note: item.review_note || ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setForm({
      sku: item.sku || '',
      product_name: item.product_name || '',
      spec: item.spec || '',
      purchase_price: item.purchase_price === null || item.purchase_price === undefined ? '' : String(item.purchase_price),
      currency: item.currency || '',
      quantity: item.quantity === null || item.quantity === undefined ? '' : String(item.quantity),
      moq: item.moq === null || item.moq === undefined ? '' : String(item.moq),
      review_note: item.review_note || ''
    })
    setEditing(false)
    setError('')
  }, [item])

  const payload = status => ({
    status,
    review_note: form.review_note.trim() || null,
    sku: form.sku.trim() || null,
    product_name: form.product_name.trim() || null,
    spec: form.spec.trim() || null,
    purchase_price: form.purchase_price === '' ? null : Number(form.purchase_price),
    currency: form.currency.trim() || null,
    quantity: form.quantity === '' ? null : Number(form.quantity),
    moq: form.moq === '' ? null : Number(form.moq)
  })

  /** 只改状态（驳回 / 放回待复核） */
  const send = async (status) => {
    setSaving(true)
    setError('')
    try {
      await axios.patch(`/api/contracts/import-items/${item.id}/review`, payload(status))
      setEditing(false)
      onReviewed()
    } catch (reviewError) {
      setError(reviewError?.response?.data?.error || '操作失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  /** 保存修正并直接入库：先把改过的字段存回队列，再走入库接口 */
  const saveAndCommit = async () => {
    setSaving(true)
    setError('')
    try {
      await axios.patch(`/api/contracts/import-items/${item.id}/review`, payload('pending_review'))
      await axios.post('/api/contracts/import-items/commit', { ids: [item.id] })
      setEditing(false)
      onCommitted()
    } catch (commitError) {
      setError(commitError?.response?.data?.error || '入库失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  /** 不改任何字段，直接把这一条入库 */
  const commitOne = async () => {
    setSaving(true)
    setError('')
    try {
      await axios.post('/api/contracts/import-items/commit', { ids: [item.id] })
      onCommitted()
    } catch (commitError) {
      setError(commitError?.response?.data?.error || '入库失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const statusMeta = itemStatusMeta(item)
  const committed = Boolean(item.committed_at)
  const renamed = committed && item.product_sku && item.sku && item.product_sku !== item.sku

  if (editing) {
    return (
      <tr className="import-row is-editing">
        <td />
        <td className="mono">{item.filename}{item.row_no ? `#${item.row_no}` : ''}</td>
        <td>
          <input className="cell-input" type="text" value={form.sku} placeholder="货号"
            onChange={event => setForm({ ...form, sku: event.target.value })} />
        </td>
        <td>
          <input className="cell-input" type="text" value={form.product_name} placeholder="产品名称"
            onChange={event => setForm({ ...form, product_name: event.target.value })} />
        </td>
        <td>
          <input className="cell-input" type="text" value={form.spec} placeholder="规格"
            onChange={event => setForm({ ...form, spec: event.target.value })} />
        </td>
        <td>
          <input className="cell-input" type="number" step="0.01" value={form.purchase_price} placeholder="采购价"
            onChange={event => setForm({ ...form, purchase_price: event.target.value })} />
        </td>
        <td>
          <input className="cell-input" type="text" value={form.currency} placeholder="币种"
            onChange={event => setForm({ ...form, currency: event.target.value })} />
        </td>
        <td>
          <input className="cell-input" type="number" step="1" value={form.quantity} placeholder="数量"
            onChange={event => setForm({ ...form, quantity: event.target.value })} />
        </td>
        <td>
          <input className="cell-input" type="number" step="1" value={form.moq} placeholder="起订量"
            onChange={event => setForm({ ...form, moq: event.target.value })} />
        </td>
        <td colSpan={2}>
          <input className="cell-input" type="text" value={form.review_note} placeholder="复核备注"
            onChange={event => setForm({ ...form, review_note: event.target.value })} />
          {error && <p className="form-error">{error}</p>}
        </td>
        <td className="col-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)} disabled={saving}>取消</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={saveAndCommit} disabled={saving}>
            {saving ? '入库中…' : '保存并入库'}
          </button>
        </td>
      </tr>
    )
  }

  return (
    <tr className={`import-row${item.status === 'rejected' ? ' is-rejected' : ''}${selected ? ' is-picked' : ''}`}>
      <td className="col-pick">
        <input
          className="pick-box" type="checkbox" checked={selected}
          onChange={() => onToggle(item.id)}
          aria-label={`选择 ${item.sku || item.filename + '#' + item.row_no}`}
        />
      </td>
      <td className="mono">
        <span className="cell-file" title={`${item.filename}${item.row_no ? ` #${item.row_no}` : ''}`}>
          {item.filename}{item.row_no ? `#${item.row_no}` : ''}
        </span>
      </td>
      <td className="mono bold">
        {item.sku ? (
          <span className="sku-cell">
            <SkuThumb sku={item.sku} filename={thumbs[item.sku]} size={30} />
            {item.sku}
            {renamed && <em className="sku-renamed" title="货号已存在，入库时自动落成副本">→ {item.product_sku}</em>}
          </span>
        ) : <span className="muted-note">未识别</span>}
      </td>
      <td>{item.product_name || <span className="muted-note">未识别</span>}</td>
      <td>{item.spec || <span className="muted-note">—</span>}</td>
      <td className="num">
        {item.purchase_price === null || item.purchase_price === undefined
          ? <span className="muted-note">—</span>
          : item.purchase_price}
      </td>
      <td>{item.currency || <span className="muted-note">—</span>}</td>
      <td className="num">{item.quantity === null || item.quantity === undefined ? '—' : item.quantity}</td>
      <td className="num">{item.moq === null || item.moq === undefined ? '—' : item.moq}</td>
      <td>
        <span className={`pill pill-${statusMeta.tone}`}>{statusMeta.label}</span>
        {item.parse_source === 'ai' && <span className="pill pill-mute src-pill">AI</span>}
      </td>
      <td className="import-note">{item.review_note || <span className="muted-note">—</span>}</td>
      <td className="col-actions">
        <button type="button" className="icon-btn" title="修正后入库" onClick={() => setEditing(true)}>
          <PencilIcon size={14} />
        </button>
        <button
          type="button" className="icon-btn" title="直接入库" disabled={committed || saving}
          onClick={commitOne}
        >
          <CheckIcon size={14} />
        </button>
        <button
          type="button" className="icon-btn" title="驳回" disabled={item.status === 'rejected' || saving}
          onClick={() => send('rejected')}
        >
          <CloseIcon size={14} />
        </button>
      </td>
    </tr>
  )
}

function ContractCleanup() {
  const [jobs, setJobs] = useState([])
  const [activeJobId, setActiveJobId] = useState(null)
  const [jobDetail, setJobDetail] = useState(null)
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [committing, setCommitting] = useState(false)
  const [aiRunning, setAiRunning] = useState(false)
  const [commitReport, setCommitReport] = useState(null)
  const [originals, setOriginals] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const fileInputRef = useRef(null)
  const headPickRef = useRef(null)

  const PAGE_LIMIT = 300

  const loadJobs = useCallback(async (preferId) => {
    setLoadingJobs(true)
    try {
      const { data } = await axios.get('/api/contracts/import-jobs')
      const rows = Array.isArray(data) ? data : []
      setJobs(rows)
      setActiveJobId(current => {
        if (preferId) return preferId
        if (current && rows.some(row => row.id === current)) return current
        return rows[0]?.id ?? null
      })
    } catch (loadError) {
      setError(loadError?.response?.data?.error || '读取导入任务失败')
    } finally {
      setLoadingJobs(false)
    }
  }, [])

  useEffect(() => { loadJobs() }, [loadJobs])

  const loadDetail = useCallback(async (jobId) => {
    if (!jobId) { setJobDetail(null); return }
    setLoadingDetail(true)
    try {
      const { data } = await axios.get(`/api/contracts/import-jobs/${jobId}`)
      setJobDetail(data)
    } catch (loadError) {
      setError(loadError?.response?.data?.error || '读取任务明细失败')
      setJobDetail(null)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    loadDetail(activeJobId)
    setSelected(new Set())
    setCommitReport(null)
    setStatusFilter('')
    setShowAll(false)
  }, [activeJobId, loadDetail])

  /* 原件只在服务器留 7 天，所以「还存在哪些原件」得单独问一次接口 */
  const loadOriginals = useCallback(async (jobId) => {
    if (!jobId) { setOriginals(null); return }
    try {
      const { data } = await axios.get(`/api/contracts/import-jobs/${jobId}/files`)
      setOriginals(data)
    } catch {
      setOriginals(null)
    }
  }, [])

  useEffect(() => { loadOriginals(activeJobId) }, [activeJobId, loadOriginals])

  const upload = async (fileList) => {
    const files = [...(fileList || [])]
    if (!files.length) return
    setUploading(true)
    setError('')
    setNotice('')
    try {
      const form = new FormData()
      files.forEach(file => form.append('files', file))
      const { data } = await axios.post('/api/contracts/import', form)
      const jobId = data?.job?.id
      await loadJobs(jobId)
      if (jobId) { await loadDetail(jobId); loadOriginals(jobId) }
      setNotice(`${files.length} 个文件已解析。${data?.message || ''}`)
    } catch (uploadError) {
      setError(uploadError?.response?.data?.error || '上传失败，请稍后重试')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const onDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    upload(event.dataTransfer?.files)
  }

  const refreshAfterReview = useCallback(async () => {
    await loadDetail(activeJobId)
    // 复核完最后一条，任务状态会从 pending_review 变 reviewed，列表也要跟着刷新
    await loadJobs(activeJobId)
  }, [activeJobId, loadDetail, loadJobs])

  const refreshAfterCommit = useCallback(async () => {
    setSelected(new Set())
    await loadDetail(activeJobId)
    await loadJobs(activeJobId)
  }, [activeJobId, loadDetail, loadJobs])

  const items = jobDetail?.items || []
  const filteredItems = useMemo(
    () => (statusFilter ? items.filter(item => item.status === statusFilter) : items),
    [items, statusFilter]
  )
  const shownItems = useMemo(
    () => (showAll ? filteredItems : filteredItems.slice(0, PAGE_LIMIT)),
    [filteredItems, showAll]
  )
  const counts = useMemo(() => {
    const result = { total: items.length, pending_review: 0, approved: 0, rejected: 0, committed: 0 }
    items.forEach(item => {
      result[item.status] = (result[item.status] || 0) + 1
      if (item.committed_at) result.committed += 1
    })
    return result
  }, [items])

  const thumbs = useSkuThumbs(items.map(item => item.sku).filter(Boolean))

  const pickableIds = useMemo(
    () => filteredItems.filter(item => !item.committed_at).map(item => item.id),
    [filteredItems]
  )
  const allPicked = pickableIds.length > 0 && pickableIds.every(id => selected.has(id))
  const somePicked = pickableIds.some(id => selected.has(id))

  useEffect(() => {
    if (headPickRef.current) headPickRef.current.indeterminate = somePicked && !allPicked
  }, [somePicked, allPicked])

  const togglePick = (id) => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const pickAll = () => setSelected(new Set(pickableIds))
  const invertPick = () => setSelected(current => {
    const next = new Set()
    pickableIds.forEach(id => { if (!current.has(id)) next.add(id) })
    return next
  })
  const clearPick = () => setSelected(new Set())

  const commitSelected = async () => {
    const ids = [...selected]
    if (!ids.length) { setError('请先勾选要入库的明细'); return }
    if (!window.confirm(`把勾选的 ${ids.length} 条写进产品库？\n\n已存在的货号会更新采购价并记入调价历史，库里没有的货号会新建。`)) return
    setCommitting(true)
    setError('')
    setNotice('')
    setCommitReport(null)
    try {
      const { data } = await axios.post('/api/contracts/import-items/commit', { ids })
      setCommitReport(data)
      setNotice(data?.message || '入库完成')
      await refreshAfterCommit()
    } catch (commitError) {
      setError(commitError?.response?.data?.error || '入库失败，请稍后重试')
    } finally {
      setCommitting(false)
    }
  }

  const runAiParse = async () => {
    if (!activeJobId) return
    if (!window.confirm('用模型重新解析这个任务？\n\n原来是规则解析出来的「待复核」行会被替换掉（已经复核或已入库的行不受影响）。')) return
    setAiRunning(true)
    setError('')
    setNotice('')
    try {
      const { data } = await axios.post(`/api/contracts/import-jobs/${activeJobId}/ai-parse`)
      setNotice(data?.message || 'AI 解析完成')
      await refreshAfterCommit()
    } catch (aiError) {
      setError(aiError?.response?.data?.error || 'AI 解析失败')
    } finally {
      setAiRunning(false)
    }
  }

  const downloadOriginal = async (name) => {
    try {
      const response = await axios.get(`/api/contracts/import-jobs/${activeJobId}/file`, {
        params: { name }, responseType: 'blob'
      })
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (downloadError) {
      setError('原件下载失败')
    }
  }

  const activeJob = jobDetail?.job
  const jobMeta = activeJob ? (JOB_STATUS[activeJob.status] || { label: activeJob.status, tone: 'mute' }) : null

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">合同清洗中心</h1>
          <p className="page-sub">
            供应商合同批量导入 → 按字符规则认列（不认行列位置）→ 人工审核入库。
            规则认不出来的，可以交给 AI 解析。原件只在服务器保留 7 天后自动清理。
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { loadJobs(activeJobId); loadDetail(activeJobId); loadOriginals(activeJobId) }}>
            <RefreshIcon size={14} /> 刷新
          </button>
        </div>
      </div>

      <section
        className={`drop-zone${dragging ? ' is-dragging' : ''}${uploading ? ' is-busy' : ''}`}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="drop-zone-icon"><DownloadIcon size={26} /></span>
        <div className="drop-zone-text">
          <strong>{uploading ? '正在上传并解析…' : '把供应商合同 / 报价单拖到这里'}</strong>
          <span>
            支持 xlsx / xls / csv / tsv / txt。按标题里的字符特征认列（中英文与常见缩写都认），
            表头不在第一行也能识别；认不准的可以改用 AI 解析或人工补录。
          </span>
        </div>
        <button
          type="button" className="btn btn-primary btn-sm"
          disabled={uploading} onClick={() => fileInputRef.current?.click()}
        >
          选择文件
        </button>
        <input
          ref={fileInputRef} type="file" multiple hidden
          accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm"
          onChange={event => upload(event.target.files)}
        />
      </section>

      {error && <p className="notice-inline">{error}</p>}
      {notice && <p className="notice-inline notice-ok">{notice}</p>}
      {commitReport?.skipped?.length > 0 && (
        <div className="notice-inline">
          <strong>有 {commitReport.skipped.length} 条没入库：</strong>
          <ul className="skip-list">
            {commitReport.skipped.slice(0, 8).map(row => (
              <li key={row.id}>#{row.id}{row.sku ? `（${row.sku}）` : ''}：{row.reason}</li>
            ))}
            {commitReport.skipped.length > 8 && <li>…还有 {commitReport.skipped.length - 8} 条</li>}
          </ul>
        </div>
      )}

      <div className="cleanup-layout">
        <aside className="cleanup-jobs">
          <div className="dashboard-panel-header">
            <div>
              <h2><CleanupIcon size={17} /> 导入任务</h2>
            </div>
          </div>
          {loadingJobs ? (
            <p className="muted-note">读取中…</p>
          ) : jobs.length === 0 ? (
            <p className="muted-note">还没有导入过合同。</p>
          ) : (
            <ul className="job-list">
              {jobs.map(job => {
                const meta = JOB_STATUS[job.status] || { label: job.status, tone: 'mute' }
                return (
                  <li key={job.id}>
                    <button
                      type="button"
                      className={`job-card${activeJobId === job.id ? ' is-active' : ''}`}
                      onClick={() => setActiveJobId(job.id)}
                    >
                      <span className="job-no mono">{job.job_no}</span>
                      <span className={`pill pill-${meta.tone}`}>{meta.label}</span>
                      {job.parse_source === 'ai' && <span className="pill pill-mute src-pill">AI</span>}
                      <span className="job-meta">
                        {job.file_count} 个文件 · {formatMoment(job.created_at)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <section className="cleanup-detail dashboard-panel">
          {!activeJob ? (
            <div className="empty-state">
              <p className="empty-state-title">选一个导入任务</p>
              <p className="empty-state-hint">左边点一个任务，这里会列出逐条解析结果供复核入库。</p>
            </div>
          ) : loadingDetail ? (
            <p className="muted-note">读取明细中…</p>
          ) : (
            <>
              <div className="dashboard-panel-header">
                <div>
                  <h2 className="mono">{activeJob.job_no} <span className={`pill pill-${jobMeta.tone}`}>{jobMeta.label}</span></h2>
                  <p className="panel-sub">
                    解析方式 {activeJob.parse_source === 'ai' ? 'AI 模型' : '字符规则'} · 规则版本 {activeJob.rule_version} · 创建 {formatMoment(activeJob.created_at)}
                  </p>
                </div>
                <div className="chip-filters">
                  <button
                    type="button" className={`chip-filter${statusFilter === '' ? ' is-active' : ''}`}
                    onClick={() => setStatusFilter('')}
                  >
                    全部 <b>{counts.total}</b>
                  </button>
                  {Object.entries(ITEM_STATUS).map(([value, meta]) => (
                    counts[value] ? (
                      <button
                        type="button" key={value}
                        className={`chip-filter${statusFilter === value ? ' is-active' : ''}`}
                        onClick={() => setStatusFilter(value)}
                      >
                        {meta.label} <b>{counts[value]}</b>
                      </button>
                    ) : null
                  ))}
                  {counts.committed > 0 && (
                    <span className="chip-filter is-static">已入库 <b>{counts.committed}</b></span>
                  )}
                </div>
              </div>

              {activeJob.status === 'parse_failed' && activeJob.notes && (
                <p className="notice-inline">上一次解析中断在：{activeJob.notes}。可以修正文件表头后重新导入。</p>
              )}

              <div className="cleanup-toolbar">
                <div className="cleanup-toolbar-left">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={pickAll} disabled={!pickableIds.length}>
                    全选 <b>{pickableIds.length}</b>
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={invertPick} disabled={!pickableIds.length}>反选</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={clearPick} disabled={!selected.size}>清空</button>
                  <span className="muted-note">已勾选 {selected.size} 条</span>
                </div>
                <div className="cleanup-toolbar-right">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={runAiParse} disabled={aiRunning}>
                    <SparkIcon size={14} /> {aiRunning ? 'AI 解析中…' : 'AI 解析'}
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={commitSelected} disabled={committing || !selected.size}>
                    <CheckIcon size={14} /> {committing ? '入库中…' : `入库选中（${selected.size}）`}
                  </button>
                </div>
              </div>

              <details className="cleanup-meta" open={!counts.total}>
                <summary>解析详情（认了哪几列 / 原件留存）</summary>
                <div className="cleanup-meta-body">
                  <div>
                    <span className="meta-label">本次认列结果</span>
                    <ColumnMapPanel raw={activeJob.column_map} />
                  </div>
                  <div>
                    <span className="meta-label">原件留存</span>
                    {originals?.files?.length ? (
                      <div className="originals">
                        {originals.files.map(file => (
                          <button type="button" key={file.name} className="original-chip"
                            onClick={() => downloadOriginal(file.name)} title="下载原件核对">
                            <ContractIcon size={13} /> {file.name}
                            <em>{fmtSize(file.size)}</em>
                          </button>
                        ))}
                        <span className="muted-note">
                          服务器只保留 {originals.retention_days} 天
                          {originals.expires_at ? `（${new Date(originals.expires_at).toLocaleDateString('zh-CN')} 起自动清理）` : ''}
                        </span>
                      </div>
                    ) : (
                      <p className="muted-note">
                        {originals?.expired
                          ? `原件已过保留期（${originals.retention_days} 天）被自动清理 —— 解析结果与已入库的价格不受影响。`
                          : '没有留存的原件。'}
                      </p>
                    )}
                  </div>
                </div>
              </details>

              {counts.pending_review === 0 && counts.total > 0 && (
                <p className="notice-inline notice-ok">
                  这个任务已经处理完毕{counts.committed ? `，其中 ${counts.committed} 条已入库` : ''}。
                </p>
              )}

              {filteredItems.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-state-title">
                    {items.length ? '当前筛选下没有明细' : '这个任务没有解析出任何行'}
                  </p>
                  <p className="empty-state-hint">
                    {items.length
                      ? '换个状态筛选看看。'
                      : '规则没认出来。可以点上面的「AI 解析」让模型试一次，或点「修正」手工补录。'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="data-table import-table">
                      <thead>
                        <tr>
                          <th className="col-pick">
                            <input
                              ref={headPickRef} className="pick-box" type="checkbox"
                              checked={allPicked} onChange={() => (allPicked ? clearPick() : pickAll())}
                              aria-label="全选"
                            />
                          </th>
                          <th>来源</th><th>货号</th><th>产品名称</th><th>规格</th>
                          <th className="num">采购价</th><th>币种</th><th className="num">数量</th><th className="num">起订量</th>
                          <th>状态</th><th>复核备注</th>
                          <th className="col-actions">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shownItems.map(item => (
                          <ReviewRow
                            key={item.id} item={item} thumbs={thumbs}
                            selected={selected.has(item.id)} onToggle={togglePick}
                            onReviewed={refreshAfterReview} onCommitted={refreshAfterCommit}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredItems.length > shownItems.length && (
                    <p className="muted-note table-more">
                      还有 {filteredItems.length - shownItems.length} 条未显示
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAll(true)}>全部显示</button>
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default ContractCleanup
