import React, { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  SparkIcon, PlusIcon, RefreshIcon, CheckIcon, CloseIcon, SaveIcon, SendIcon
} from './Icons'

/**
 * 智能配置 —— 多模型接入与用途分配。
 *
 * 交互主线（Wayne 2026-09-15 定的四步）：
 *   1. 选一个常用接口预设（自动填地址/兼容模式/推荐模型）
 *   2. 填密钥 → 保存（保存后自动跑一次连通性测试）
 *   3. 「获取模型」→ 勾选这个接入要用哪些模型
 *   4. 到「按用途分配」把不同活派给不同模型（可以同时接多家）
 *
 * 所有配置都在后端，前端不做任何本地持久化 —— 换台电脑登录照样是这套配置。
 */

const VALUE_SEP = '::'
const encodeChoice = (providerId, model) => (providerId && model ? `${providerId}${VALUE_SEP}${model}` : '')
const decodeChoice = (value) => {
  if (!value) return null
  const index = value.indexOf(VALUE_SEP)
  if (index < 0) return null
  return { provider_id: value.slice(0, index), model: value.slice(index + VALUE_SEP.length) }
}

function fmtTime(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(value)
  }
}

/**
 * Base URL 的即时体检。
 *
 * 两种兼容模式的地址写法**不一样**，这里拦最常见的两类填错：
 *   ① 把完整接口路径也填了进来（/chat/completions、/messages）—— 系统还会再拼一次；
 *   ② Anthropic 协议漏了 /v1 —— 各家 SDK 文档里的 base_url 是写到 /anthropic 为止的
 *      （SDK 自己补 /v1），本系统不补，直接照抄必然 404。
 */
function baseUrlAdvice(mode, value) {
  const url = String(value || '').trim()
  if (!url) return null
  const tail = url.replace(/\/+$/, '')
  if (/\/(chat\/completions|completions)$/i.test(tail)) {
    return { level: 'error', text: '不要带 /chat/completions —— 系统会自动拼上它，填到服务根路径就行。' }
  }
  if (/\/messages$/i.test(tail)) {
    return { level: 'error', text: '不要带 /messages —— 系统会自动拼上它，填到服务根路径就行。' }
  }
  if (mode === 'anthropic' && !/\/v1$/i.test(tail)) {
    return {
      level: 'warn',
      text: 'Anthropic 协议通常要写到 /v1 结尾（如 …/anthropic/v1）—— 系统是在这一层的后面拼 /messages，'
        + '漏掉 /v1 多半会 404。'
    }
  }
  return null
}

function AIConfigSettings() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [config, setConfig] = useState({
    presets: [], modes: [], purposes: [], providers: [], assignments: {}, overview: {}
  })
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState('')
  const [modelPanel, setModelPanel] = useState(null)
  const [draft, setDraft] = useState({})
  const [probe, setProbe] = useState({ prompt: '', reply: '', error: '', busy: false })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/ai/config')
      setConfig(data)
      const next = {}
      for (const [purpose, value] of Object.entries(data.assignments || {})) {
        next[purpose] = encodeChoice(value.provider_id, value.model)
      }
      setDraft(next)
      setError('')
    } catch (err) {
      setError(err?.response?.data?.error || '读取智能配置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (text) => {
    setNotice(text)
    window.setTimeout(() => setNotice(''), 3500)
  }

  /* 所有启用中的接入 × 它们的模型，供用途分配下拉用 */
  const choices = useMemo(() => (config.providers || [])
    .filter(provider => provider.enabled)
    .map(provider => ({
      provider,
      models: provider.models || [],
      label: `${provider.name}${provider.has_key ? '' : '（未填密钥）'}`
    })), [config.providers])

  const assignedCount = useMemo(
    () => Object.values(draft).filter(Boolean).length,
    [draft]
  )

  /* ---------------------------------------------------------------- 接入 */

  const openCreate = (presetKey = '') => {
    const preset = (config.presets || []).find(item => item.key === presetKey) || null
    setEditor({
      mode: 'create',
      form: {
        preset: preset?.key || 'openai',
        name: preset?.label || '',
        base_url: preset?.base_url || '',
        mode: preset?.mode || 'openai',
        api_key: '',
        note: '',
        enabled: true
      },
      modelsText: (preset?.models || []).join('\n')
    })
  }

  const openEdit = (provider) => {
    setEditor({
      mode: 'edit',
      id: provider.id,
      form: {
        preset: provider.preset,
        name: provider.name,
        base_url: provider.base_url,
        mode: provider.mode,
        api_key: '',
        note: provider.note || '',
        enabled: provider.enabled
      },
      keyMasked: provider.key_masked,
      modelsText: (provider.models || []).join('\n')
    })
  }

  const changePreset = (presetKey) => {
    const preset = (config.presets || []).find(item => item.key === presetKey)
    if (!preset) return
    setEditor(current => ({
      ...current,
      form: {
        ...current.form,
        preset: preset.key,
        name: preset.label,
        base_url: preset.base_url,
        mode: preset.mode
      },
      modelsText: (preset.models || []).join('\n')
    }))
  }

  const saveProvider = async (event) => {
    event.preventDefault()
    if (!editor) return
    setBusy('save-provider')
    try {
      const payload = {
        ...editor.form,
        models: editor.modelsText.split('\n').map(line => line.trim()).filter(Boolean)
      }
      if (editor.mode === 'edit' && !payload.api_key) delete payload.api_key
      const { data } = editor.mode === 'edit'
        ? await axios.patch(`/api/ai/providers/${editor.id}`, payload)
        : await axios.post('/api/ai/providers', payload)
      setEditor(null)
      await load()
      flash(`「${data.provider.name}」已保存`)
      /* 保存完顺手测一次：用户填完 key 最想知道的就是「通不通」 */
      await runTest(data.provider.id, { silent: true })
    } catch (err) {
      setError(err?.response?.data?.error || '保存模型接入失败')
    } finally {
      setBusy('')
    }
  }

  const runTest = async (id, { silent } = {}) => {
    setBusy(`test:${id}`)
    try {
      const { data } = await axios.post(`/api/ai/providers/${id}/test`)
      if (!silent) {
        flash(data.result.ok
          ? `连通正常（${data.result.latency_ms}ms）：${data.result.detail}`
          : `连通失败：${data.result.detail}`)
      }
      setConfig(current => ({
        ...current,
        providers: current.providers.map(item => (item.id === id ? data.provider : item))
      }))
      return data.result
    } catch (err) {
      const text = err?.response?.data?.error || '测试失败'
      if (!silent) setError(text)
      return { ok: false, detail: text }
    } finally {
      setBusy('')
    }
  }

  const fetchModels = async (provider) => {
    setBusy(`models:${provider.id}`)
    try {
      const { data } = await axios.post(`/api/ai/providers/${provider.id}/models`)
      /* 勾选默认值：优先沿用之前存过的模型；一个都没对上（换了服务商/换了模型名）就全选，
         否则用户会看到一个「获取成功但一个都没勾」的空面板，还得手工点一遍。 */
      const previous = (provider.models || []).filter(model => data.models.includes(model))
      setModelPanel({
        providerId: provider.id,
        providerName: provider.name,
        detail: data.detail,
        source: data.source,
        selected: previous.length ? previous : data.models,
        models: data.models
      })
    } catch (err) {
      setError(err?.response?.data?.error || '获取模型清单失败')
    } finally {
      setBusy('')
    }
  }

  const saveModels = async () => {
    if (!modelPanel) return
    setBusy('save-models')
    try {
      await axios.patch(`/api/ai/providers/${modelPanel.providerId}`, { models: modelPanel.selected })
      setModelPanel(null)
      await load()
      flash('可用模型已更新')
    } catch (err) {
      setError(err?.response?.data?.error || '保存模型清单失败')
    } finally {
      setBusy('')
    }
  }

  const toggleProvider = async (provider) => {
    setBusy(`toggle:${provider.id}`)
    try {
      await axios.patch(`/api/ai/providers/${provider.id}`, { enabled: !provider.enabled })
      await load()
      flash(`「${provider.name}」已${provider.enabled ? '停用' : '启用'}`)
    } catch (err) {
      setError(err?.response?.data?.error || '操作失败')
    } finally {
      setBusy('')
    }
  }

  const removeProvider = async (provider) => {
    if (!window.confirm(`移除模型接入「${provider.name}」？\n\n指向它的用途分配会一起清掉。`)) return
    setBusy(`remove:${provider.id}`)
    try {
      await axios.delete(`/api/ai/providers/${provider.id}`)
      await load()
      flash(`「${provider.name}」已移除`)
    } catch (err) {
      setError(err?.response?.data?.error || '移除失败')
    } finally {
      setBusy('')
    }
  }

  /* ---------------------------------------------------------------- 分配 */

  const saveAssignments = async () => {
    setBusy('assignments')
    try {
      const assignments = {}
      for (const [purpose, value] of Object.entries(draft)) {
        const choice = decodeChoice(value)
        if (choice) assignments[purpose] = choice
      }
      const { data } = await axios.put('/api/ai/assignments', { assignments })
      setConfig(current => ({ ...current, assignments: data.assignments, overview: data.overview }))
      flash('用途分配已保存')
    } catch (err) {
      setError(err?.response?.data?.error || '保存分配失败')
    } finally {
      setBusy('')
    }
  }

  const runProbe = async () => {
    const prompt = probe.prompt.trim()
    if (!prompt) return
    setProbe(current => ({ ...current, busy: true, reply: '', error: '' }))
    try {
      const { data } = await axios.post('/api/ai/chat', { prompt, purpose: 'assistant_chat' })
      setProbe(current => ({ ...current, busy: false, reply: data.text || '(模型返回空内容)' }))
    } catch (err) {
      setProbe(current => ({
        ...current,
        busy: false,
        error: err?.response?.data?.error || '试跑失败'
      }))
    }
  }

  /* ---------------------------------------------------------------- 渲染 */

  if (loading) {
    return (
      <div className="settings-section">
        <h3>智能配置</h3>
        <p className="settings-description">正在读取模型接入配置…</p>
      </div>
    )
  }

  const { overview = {} } = config

  /* 编辑弹窗里跟着「接口兼容模式」走派生值：示例、后缀说明、填错提示 */
  const activeMode = editor
    ? (config.modes || []).find(item => item.value === editor.form.mode) || null
    : null
  const baseAdvice = editor ? baseUrlAdvice(editor.form.mode, editor.form.base_url) : null

  return (
    <div className="settings-section">
      <h3>智能配置</h3>
      <p className="settings-description">
        接入一家或多家大模型服务，再把不同用途派给不同模型 —— 合同解析用长文本强的，
        图片识别用多模态的，日常对话用便宜的。全部配置存在本机数据库，换电脑登录即生效。
      </p>

      <div className="ai-overview">
        <div><strong>{overview.provider_count || 0}</strong><small>已接入</small></div>
        <div><strong>{overview.healthy_count || 0}</strong><small>测试通过</small></div>
        <div><strong>{overview.assigned_purposes?.length || 0}/{config.purposes.length}</strong><small>用途已分配</small></div>
        <div><strong>{overview.last_test_at ? fmtTime(overview.last_test_at).slice(5, 16) : '—'}</strong><small>最近测试</small></div>
      </div>

      {notice && <p className="ai-banner is-ok"><CheckIcon size={14} /> {notice}</p>}
      {error && <p className="ai-banner is-error"><CloseIcon size={14} /> {error}</p>}

      {/* ---------------- 模型接入 ---------------- */}
      <div className="settings-group">
        <div className="ai-group-head">
          <h4>模型接入</h4>
          <div className="ai-group-actions">
            <button className="btn btn-secondary btn-sm" onClick={load} disabled={Boolean(busy)}>
              <RefreshIcon size={14} /> 刷新
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => openCreate('deepseek')}>
              <PlusIcon size={14} /> 新增接入
            </button>
          </div>
        </div>

        {config.providers.length === 0
          ? <p className="help-text">
              还没有接入任何模型服务。可以从下面的常用预设开始（DeepSeek / 通义 / Kimi / Claude / 本地 Ollama 等），
              也可以完全自定义。不接也能用系统 —— 只是「小皮」会退回到本地规则直答。
            </p>
          : (
            <ul className="ai-provider-list">
              {config.providers.map(provider => {
                const test = provider.last_test
                return (
                  <li key={provider.id} className={`ai-provider${provider.enabled ? '' : ' is-off'}`}>
                    <div className="ai-provider-main">
                      <div className="ai-provider-title">
                        <strong>{provider.name}</strong>
                        <span className="ai-tag">{provider.preset_label}</span>
                        <span className="ai-tag is-mode">{provider.mode === 'anthropic' ? 'Anthropic 协议' : 'OpenAI 兼容'}</span>
                        {!provider.enabled && <span className="ai-tag is-off">已停用</span>}
                      </div>
                      <div className="ai-provider-meta">
                        <code>{provider.base_url}</code>
                        <span>密钥 {provider.has_key ? provider.key_masked : '（未填写，本地服务可留空）'}</span>
                        <span>{provider.models.length} 个可用模型</span>
                      </div>
                      {test && (
                        <div className={`ai-provider-test${test.ok ? ' is-ok' : ' is-error'}`}>
                          {test.ok ? <CheckIcon size={13} /> : <CloseIcon size={13} />}
                          <span>{test.detail}</span>
                          <small>{fmtTime(test.at)} · {test.latency_ms}ms</small>
                        </div>
                      )}
                    </div>
                    <div className="ai-provider-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => runTest(provider.id)}
                        disabled={Boolean(busy)}
                      >
                        {busy === `test:${provider.id}` ? '测试中…' : '连通性测试'}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => fetchModels(provider)}
                        disabled={Boolean(busy)}
                      >
                        {busy === `models:${provider.id}` ? '获取中…' : '获取模型'}
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(provider)} disabled={Boolean(busy)}>
                        编辑
                      </button>
                      <button className="btn-link" onClick={() => toggleProvider(provider)} disabled={Boolean(busy)}>
                        {provider.enabled ? '停用' : '启用'}
                      </button>
                      <button className="btn-link is-danger" onClick={() => removeProvider(provider)} disabled={Boolean(busy)}>
                        移除
                      </button>
                    </div>

                    {modelPanel?.providerId === provider.id && (
                      <div className="ai-model-panel">
                        <div className="ai-model-panel-head">
                          <span>可用模型（{modelPanel.models.length}）</span>
                          <small>{modelPanel.detail}{modelPanel.source === 'preset' ? ' · 预设推荐' : ''}</small>
                        </div>
                        <div className="ai-model-grid">
                          {modelPanel.models.map(model => {
                            const checked = modelPanel.selected.includes(model)
                            return (
                              <label key={model} className={`ai-model-item${checked ? ' is-on' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => setModelPanel(current => ({
                                    ...current,
                                    selected: checked
                                      ? current.selected.filter(item => item !== model)
                                      : [...current.selected, model]
                                  }))}
                                />
                                <span>{model}</span>
                              </label>
                            )
                          })}
                        </div>
                        <div className="ai-model-panel-foot">
                          <button className="btn btn-secondary btn-sm" onClick={() => setModelPanel(null)}>取消</button>
                          <button className="btn btn-primary btn-sm" onClick={saveModels} disabled={busy === 'save-models'}>
                            <SaveIcon size={14} /> 保存为可用模型（{modelPanel.selected.length}）
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
      </div>

      {/* ---------------- 用途分配 ---------------- */}
      <div className="settings-group">
        <div className="ai-group-head">
          <h4>按用途分配模型</h4>
          <div className="ai-group-actions">
            <span className="help-text">已分配 {assignedCount}/{config.purposes.length}</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={saveAssignments}
              disabled={Boolean(busy) || config.providers.length === 0}
            >
              <SaveIcon size={14} /> {busy === 'assignments' ? '保存中…' : '保存分配'}
            </button>
          </div>
        </div>

        {config.providers.length === 0
          ? <p className="help-text">先在上面接入至少一家模型服务，这里就能选了。</p>
          : (
            <table className="data-table ai-assign-table">
              <thead>
                <tr><th>用途</th><th>说明</th><th>使用的模型</th><th /></tr>
              </thead>
              <tbody>
                {config.purposes.map(purpose => (
                  <tr key={purpose.key}>
                    <td>
                      <strong>{purpose.label}</strong>
                      {purpose.vision && <span className="ai-tag is-vision">需多模态</span>}
                    </td>
                    <td className="ai-assign-hint">{purpose.hint}</td>
                    <td>
                      <select
                        className="form-select"
                        value={draft[purpose.key] || ''}
                        onChange={event => setDraft(current => ({ ...current, [purpose.key]: event.target.value }))}
                      >
                        <option value="">—— 未分配（走本地规则）——</option>
                        {choices.map(group => (
                          <optgroup key={group.provider.id} label={group.label}>
                            {group.models.length === 0 && (
                              <option value="" disabled>（该接入还没有可用模型，先点「获取模型」）</option>
                            )}
                            {group.models.map(model => (
                              <option key={model} value={encodeChoice(group.provider.id, model)}>
                                {model}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td>
                      {draft[purpose.key] && (
                        <button
                          className="btn-link"
                          onClick={() => setDraft(current => ({ ...current, [purpose.key]: '' }))}
                        >
                          清空
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>

      {/* ---------------- 试跑 ---------------- */}
      <div className="settings-group">
        <h4>验证一下</h4>
        <p className="help-text">
          用「智能助手对话」分配到的模型发一句话，确认配置真的通了。未分配时会提示先去做分配。
        </p>
        <div className="ai-probe">
          <input
            type="text"
            className="form-input"
            placeholder="例如：用一句话介绍我这边的客户情况"
            value={probe.prompt}
            onChange={event => setProbe(current => ({ ...current, prompt: event.target.value }))}
            onKeyDown={event => { if (event.key === 'Enter') runProbe() }}
          />
          <button className="btn btn-primary" onClick={runProbe} disabled={probe.busy || !probe.prompt.trim()}>
            <SendIcon size={14} /> {probe.busy ? '调用中…' : '试跑'}
          </button>
        </div>
        {probe.reply && <pre className="ai-probe-reply">{probe.reply}</pre>}
        {probe.error && <p className="ai-banner is-error"><CloseIcon size={14} /> {probe.error}</p>}
      </div>

      <p className="appearance-note">
        <SparkIcon size={14} /> 密钥以明文保存在本机数据库文件里，请勿把 data/trade.db 外发；
        对外接口只会返回打码后的密钥。
      </p>

      {/* ---------------- 新增 / 编辑弹窗 ---------------- */}
      {editor && (
        <div className="modal-overlay" onClick={() => !busy && setEditor(null)}>
          <div className="modal-content" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2>{editor.mode === 'edit' ? `编辑接入「${editor.form.name}」` : '新增模型接入'}</h2>
              <button className="close-btn" onClick={() => setEditor(null)} aria-label="关闭">
                <CloseIcon size={18} />
              </button>
            </div>
            <form onSubmit={saveProvider}>
              <div className="form-group">
                <label>常用接口预设</label>
                <select
                  value={editor.form.preset}
                  onChange={event => changePreset(event.target.value)}
                >
                  {config.presets.map(preset => (
                    <option key={preset.key} value={preset.key}>{preset.label}</option>
                  ))}
                </select>
                {(() => {
                  const preset = config.presets.find(item => item.key === editor.form.preset)
                  if (!preset?.note) return null
                  return (
                    <p className="form-hint">
                      {preset.note}
                      {preset.docs && (
                        <>
                          {' · '}
                          <a href={preset.docs} target="_blank" rel="noreferrer">去申请密钥</a>
                        </>
                      )}
                    </p>
                  )
                })()}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>接入名称</label>
                  <input
                    type="text"
                    value={editor.form.name}
                    onChange={event => setEditor(current => ({ ...current, form: { ...current.form, name: event.target.value } }))}
                    placeholder="例如 DeepSeek 生产"
                  />
                </div>
                <div className="form-group">
                  <label>接口兼容模式</label>
                  <select
                    value={editor.form.mode}
                    onChange={event => setEditor(current => ({ ...current, form: { ...current.form, mode: event.target.value } }))}
                  >
                    {config.modes.map(mode => (
                      <option key={mode.value} value={mode.value}>{mode.label} —— {mode.hint}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>
                  接口地址（Base URL）
                  {activeMode?.base_suffix && <span className="ai-url-suffix">系统会自动拼 {activeMode.base_suffix}</span>}
                </label>
                <input
                  type="text"
                  value={editor.form.base_url}
                  onChange={event => setEditor(current => ({ ...current, form: { ...current.form, base_url: event.target.value } }))}
                  placeholder={activeMode?.base_placeholder || 'https://api.example.com/v1'}
                />
                {activeMode?.base_hint && <p className="form-hint">{activeMode.base_hint}</p>}
                {baseAdvice && (
                  <p className={`form-hint is-${baseAdvice.level}`}>{baseAdvice.text}</p>
                )}
                {activeMode?.base_examples?.length > 0 && (
                  <div className="ai-url-examples">
                    <span className="ai-url-examples-label">{activeMode.label}常见地址（点一下填入）：</span>
                    {activeMode.base_examples.map(item => (
                      <button
                        key={item.url}
                        type="button"
                        className="ai-url-chip"
                        title={`填入 ${item.url}`}
                        onClick={() => setEditor(current => ({
                          ...current,
                          form: { ...current.form, base_url: item.url }
                        }))}
                      >
                        <em>{item.label}</em>
                        <code>{item.url}</code>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>API Key</label>
                <input
                  type="password"
                  value={editor.form.api_key}
                  onChange={event => setEditor(current => ({ ...current, form: { ...current.form, api_key: event.target.value } }))}
                  placeholder={editor.mode === 'edit' && editor.keyMasked
                    ? `已保存：${editor.keyMasked}（留空表示不修改）`
                    : 'sk-...'}
                />
              </div>

              <div className="form-group">
                <label>可用模型（一行一个；也可以保存后点「获取模型」自动填充）</label>
                <textarea
                  className="ai-models-textarea"
                  rows={5}
                  value={editor.modelsText}
                  onChange={event => setEditor(current => ({ ...current, modelsText: event.target.value }))}
                  placeholder={'deepseek-chat\ndeepseek-reasoner'}
                />
              </div>

              <div className="form-group">
                <label>备注</label>
                <input
                  type="text"
                  value={editor.form.note}
                  onChange={event => setEditor(current => ({ ...current, form: { ...current.form, note: event.target.value } }))}
                  placeholder="例如：给合同解析用"
                />
              </div>

              <label className="setting-toggle">
                <span><strong>启用该接入</strong><small>停用后不会被任何用途调用</small></span>
                <input
                  type="checkbox"
                  checked={editor.form.enabled}
                  onChange={event => setEditor(current => ({ ...current, form: { ...current.form, enabled: event.target.checked } }))}
                />
                <i aria-hidden="true" />
              </label>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditor(null)} disabled={Boolean(busy)}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary" disabled={Boolean(busy)}>
                  {busy === 'save-provider' ? '保存中…' : '保存并测试连通性'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default AIConfigSettings
