import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { MoonIcon, SunIcon, TuneIcon, CheckIcon, CloseIcon, ExchangeIcon, SparkIcon, RefreshIcon } from './Icons'

function Settings({ isOpen, onClose, theme, onThemeChange, reducedMotion, onReducedMotionChange }) {
  const [activeCategory, setActiveCategory] = useState('appearance')

  const modalRef = useRef(null)
  useEffect(() => {
    if (!isOpen) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const modal = modalRef.current
    const focusable = () => [...modal.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length)
    modal.querySelector('.close-btn')?.focus()
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        const items = focusable()
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    modal.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      modal.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="settings-modal luxury-settings" onClick={(e) => e.stopPropagation()}>
        <aside className="settings-sidebar">
          <div className="settings-header">
            <div>
              <span className="section-label">[CONTROL CENTER]</span>
              <h2 id="settings-title">系统设置</h2>
            </div>
            <button className="close-btn" onClick={onClose} aria-label="关闭设置"><CloseIcon size={18} /></button>
          </div>
          <nav className="settings-nav" aria-label="设置分类">
            <button className={`settings-nav-item ${activeCategory === 'appearance' ? 'active' : ''}`} onClick={() => setActiveCategory('appearance')}>
              <span className="settings-nav-icon"><TuneIcon size={16} /></span>
              <span>外观与主题</span>
            </button>
            <button className={`settings-nav-item ${activeCategory === 'import-export' ? 'active' : ''}`} onClick={() => setActiveCategory('import-export')}>
              <span className="settings-nav-icon"><ExchangeIcon size={18} /></span>
              <span>数据交换</span>
            </button>
            <button className={`settings-nav-item ${activeCategory === 'ai-config' ? 'active' : ''}`} onClick={() => setActiveCategory('ai-config')}>
              <span className="settings-nav-icon"><SparkIcon size={18} /></span>
              <span>智能配置</span>
            </button>
            <button className={`settings-nav-item ${activeCategory === 'system-update' ? 'active' : ''}`} onClick={() => setActiveCategory('system-update')}>
              <span className="settings-nav-icon"><RefreshIcon size={18} /></span>
              <span>系统与更新</span>
            </button>
          </nav>
          <div className="settings-sidebar-status"><TuneIcon size={15} /><span>专注业务，自在掌控<small>TRADE MANAGEMENT</small></span></div>
        </aside>

        <section className="settings-content">
          {activeCategory === 'appearance' && <AppearanceSettings theme={theme} onThemeChange={onThemeChange} reducedMotion={reducedMotion} onReducedMotionChange={onReducedMotionChange} />}
          {activeCategory === 'import-export' && <ImportExportSettings />}
          {activeCategory === 'ai-config' && <AIConfigSettings />}
          {activeCategory === 'system-update' && <SystemUpdateSettings />}
        </section>
      </div>
    </div>
  )
}

function AppearanceSettings({ theme, onThemeChange, reducedMotion, onReducedMotionChange }) {
  return (
    <div className="settings-section">
      <span className="section-label">[APPEARANCE]</span>
      <h3>外观与主题</h3>
      <p className="settings-description">选择适合工作环境的显示模式，设置会自动保存在本机。</p>

      <div className="theme-selector" role="group" aria-label="界面主题">
        <button className={`theme-option ${theme === 'dark' ? 'active' : ''}`} aria-pressed={theme === 'dark'} onClick={() => onThemeChange('dark')}>
          <span className="theme-preview theme-preview-dark" aria-hidden="true"><span className="mini-sidebar"><i /><i /><i /></span><span className="mini-workspace"><MoonIcon size={18} /><span className="mini-stats"><i /><i /><i /></span><span className="mini-table"><i /><i /><i /></span></span></span>
          <span><strong>夜间控制台</strong><small>深色 · 低光环境</small></span>
          <span className="theme-check" aria-hidden="true">{theme === 'dark' && <CheckIcon size={14} />}</span>
        </button>
        <button className={`theme-option ${theme === 'light' ? 'active' : ''}`} aria-pressed={theme === 'light'} onClick={() => onThemeChange('light')}>
          <span className="theme-preview theme-preview-light" aria-hidden="true"><span className="mini-sidebar"><i /><i /><i /></span><span className="mini-workspace"><SunIcon size={18} /><span className="mini-stats"><i /><i /><i /></span><span className="mini-table"><i /><i /><i /></span></span></span>
          <span><strong>日间工作台</strong><small>淡色 · 明亮环境</small></span>
          <span className="theme-check" aria-hidden="true">{theme === 'light' && <CheckIcon size={14} />}</span>
        </button>
      </div>

      <div className="settings-group">
        <h4>显示偏好</h4>
        <div className="setting-info"><span><strong>清晰优先</strong><small>两种主题均保留高对比度文字与明确的状态标识。</small></span><span className="preference-badge">默认启用</span></div>
        <label className="setting-toggle"><span><strong>减少动效</strong><small>适用于需要稳定画面的工作环境</small></span><input type="checkbox" aria-label="减少动效" checked={reducedMotion} onChange={e => onReducedMotionChange(e.target.checked)} /><i aria-hidden="true" /></label>
      </div>
      <p className="appearance-note"><CheckIcon size={14} /> 即时生效 · 自动记住您的主题与动效偏好</p>
    </div>
  )
}

function ImportExportSettings() {
  return (
    <div className="settings-section">
      <span className="section-label">[DATA EXCHANGE]</span>
      <h3>导入 / 导出</h3>
      <p className="settings-description">管理业务数据的导入、导出与本地备份。</p>
      <div className="settings-group"><h4>导出数据</h4><div className="settings-actions"><button className="btn btn-secondary">导出供应商数据</button><button className="btn btn-secondary">导出产品数据</button><button className="btn btn-secondary">导出客户数据</button><button className="btn btn-secondary">导出订单数据</button></div></div>
      <div className="settings-group"><h4>导入数据</h4><div className="settings-actions"><label className="btn btn-secondary file-label">导入供应商数据<input type="file" accept=".csv,.xlsx" /></label><label className="btn btn-secondary file-label">导入产品数据<input type="file" accept=".csv,.xlsx" /></label><label className="btn btn-secondary file-label">导入客户数据<input type="file" accept=".csv,.xlsx" /></label></div><p className="help-text">支持 CSV 和 Excel 格式文件</p></div>
      <div className="settings-group"><h4>备份与恢复</h4><div className="settings-actions"><button className="btn btn-primary">创建完整备份</button><label className="btn btn-secondary file-label">恢复备份<input type="file" accept=".db,.backup" /></label></div><p className="help-text">建议定期备份数据库</p></div>
    </div>
  )
}

function AIConfigSettings() {
  return (
    <div className="settings-section">
      <span className="section-label">[INTELLIGENCE]</span>
      <h3>智能配置</h3>
      <p className="settings-description">配置 AI 功能相关参数与模型。</p>
      <div className="settings-group"><h4>API 密钥配置</h4><div className="form-group"><label>OpenAI API Key</label><input type="password" placeholder="sk-..." className="form-input" /></div><div className="form-group"><label>Claude API Key</label><input type="password" placeholder="sk-ant-..." className="form-input" /></div><p className="help-text">当前为配置界面预览，密钥保存和连接测试尚未接入。</p></div>
      <div className="settings-group"><h4>AI 功能开关</h4><label className="setting-toggle"><span><strong>启用合同智能解析</strong><small>自动提取合同关键字段</small></span><input type="checkbox" defaultChecked /><i /></label><label className="setting-toggle"><span><strong>启用客户画像分析</strong><small>辅助判断客户跟进优先级</small></span><input type="checkbox" defaultChecked /><i /></label><label className="setting-toggle"><span><strong>启用自动报价建议</strong><small>基于历史价格提供参考</small></span><input type="checkbox" /><i /></label></div>
      <div className="settings-group"><h4>模型选择</h4><div className="form-group"><label>OCR 模型</label><select className="form-select"><option>GPT-4 Vision</option><option>Claude 3 Opus</option><option>Claude 3 Sonnet</option></select></div><div className="form-group"><label>文本分析模型</label><select className="form-select"><option>GPT-4</option><option>Claude 3 Opus</option><option>GPT-3.5 Turbo</option></select></div></div>
      <div className="settings-actions"><button className="btn btn-primary">保存配置</button><button className="btn btn-secondary">测试连接</button></div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   系统与更新
   显示本机版本与运行环境，并从 GitHub 仓库检查是否有新版本。
   版本号以顶层 package.json 为准；远端取 Release（优先）或 tag。
--------------------------------------------------------------------------- */
function SystemUpdateSettings() {
  const [info, setInfo] = useState(null)
  const [repo, setRepo] = useState('')
  const [loadingInfo, setLoadingInfo] = useState(true)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [showNotes, setShowNotes] = useState(false)

  useEffect(() => {
    let alive = true
    axios
      .get('/api/system/info')
      .then(({ data }) => {
        if (!alive) return
        setInfo(data)
        setRepo(data.repo || '')
      })
      .catch((e) => {
        if (alive) setError(e?.response?.data?.error || e.message)
      })
      .finally(() => {
        if (alive) setLoadingInfo(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const check = async () => {
    setChecking(true)
    setError('')
    setResult(null)
    setShowNotes(false)
    try {
      const { data } = await axios.get('/api/system/check-update', { params: { repo, force: 1 } })
      setResult(data)
      if (!data.ok) setError(data.error || '检查更新失败')
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setChecking(false)
    }
  }

  const fmtTime = (value) => {
    if (!value) return ''
    try {
      return new Date(value).toLocaleString('zh-CN', { hour12: false })
    } catch {
      return String(value)
    }
  }

  return (
    <div className="settings-section">
      <span className="section-label">[SYSTEM]</span>
      <h3>系统与更新</h3>
      <p className="settings-description">查看当前版本与运行环境，并从官方仓库检查是否有新版本。</p>

      <div className="settings-group">
        <h4>当前版本</h4>
        <div className="setting-info">
          <span>
            <strong>{info ? `happy 出口通 v${info.version}` : '正在读取版本…'}</strong>
            <small>{info ? `运行环境 Node ${info.node} · ${info.platform} ${info.arch}` : '读取本机信息中'}</small>
          </span>
          <span className="preference-badge">正式版</span>
        </div>
        {info?.startedAt && <p className="help-text">服务启动于 {fmtTime(info.startedAt)}</p>}
      </div>

      <div className="settings-group">
        <h4>更新源</h4>
        <div className="form-group">
          <label>GitHub 仓库</label>
          <input
            type="text"
            className="form-input"
            value={repo}
            placeholder="owner/repo"
            onChange={(e) => setRepo(e.target.value)}
            disabled={checking}
          />
        </div>
        <p className="help-text">默认抓取官方仓库，也支持填完整地址（https://github.com/owner/repo）。</p>
      </div>

      <div className="settings-group">
        <h4>检查更新</h4>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={check} disabled={checking || loadingInfo}>
            {checking ? '检查中…' : '检查更新'}
          </button>
        </div>
        {!checking && result && (
          <p className="help-text">
            上次检查：{fmtTime(result.checkedAt)}
            {result.cached ? '（结果来自缓存）' : ''}
          </p>
        )}

        {checking && (
          <div className="update-status is-checking">
            <span className="spinner" />
            <span>正在连接 GitHub，请稍候…</span>
          </div>
        )}

        {!checking && error && (
          <div className="update-status is-error">
            <CloseIcon size={15} />
            <span>{error}</span>
          </div>
        )}

        {!checking && !error && result?.ok && result.hasUpdate && (
          <>
            <div className="update-status is-new">
              <SparkIcon size={15} />
              <span>
                发现新版本 <b>v{result.latest}</b>，当前 v{result.current}
              </span>
            </div>
            {result.publishedAt && <p className="help-text">发布于 {fmtTime(result.publishedAt)}</p>}
            {(result.url || result.notes) && (
              <div className="update-links">
                {result.url && (
                  <a className="btn-link" href={result.url} target="_blank" rel="noreferrer">
                    在 GitHub 上查看
                  </a>
                )}
                {result.notes && (
                  <button className="btn-link" onClick={() => setShowNotes((v) => !v)}>
                    {showNotes ? '收起更新说明' : '查看更新说明'}
                  </button>
                )}
              </div>
            )}
            {showNotes && result.notes && <pre className="update-notes">{result.notes}</pre>}
          </>
        )}

        {!checking && !error && result?.ok && !result.hasUpdate && (
          <>
            <div className="update-status is-ok">
              <CheckIcon size={15} />
              <span>已是最新版本（v{result.current}）</span>
            </div>
            {result.note && <p className="help-text">{result.note}</p>}
          </>
        )}
      </div>
    </div>
  )
}

export default Settings
