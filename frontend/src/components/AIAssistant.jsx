import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { BotIcon, CloseIcon, MinusIcon, SendIcon, SparkIcon } from './Icons'

const POS_KEY = 'happy.aiPos'
const WIN_WIDTH = 348

const starterMessages = [
  { role: 'assistant', text: '我是小屁，你的外贸业务助理。可以帮你查客户、产品、供应商、订单、商机和待办，也能代你发起系统内的操作。' },
]

function readStoredPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
    if (raw && Number.isFinite(raw.left) && Number.isFinite(raw.top)) return { left: raw.left, top: raw.top }
  } catch { /* 存储不可用时用默认位置 */ }
  return null
}

/** 拖动或改窗口大小后，把窗口夹回视口，保证整窗（至少是标题栏）能点到 */
function clampPos(pos, height) {
  if (!pos) return pos
  const maxLeft = Math.max(8, window.innerWidth - WIN_WIDTH - 8)
  const usable = Math.min(height || 320, window.innerHeight - 60)
  const maxTop = Math.max(8, window.innerHeight - usable - 8)
  return {
    left: Math.min(Math.max(8, pos.left), maxLeft),
    top: Math.min(Math.max(8, pos.top), maxTop)
  }
}

/**
 * 小屁 —— 右上角浮动小窗。
 * 不是模态：没有遮罩、不 inert 主界面，所以可以一边让它干活一边自己点系统。
 */
function AIAssistant({ isOpen, onClose }) {
  const [messages, setMessages] = useState(starterMessages)
  const [input, setInput] = useState('')
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [pos, setPos] = useState(readStoredPos)

  const inputRef = useRef(null)
  const winRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => {
    if (isOpen && !minimized) inputRef.current?.focus()
  }, [isOpen, minimized])

  // Esc 只收窗，不做任何全局拦截
  useEffect(() => {
    if (!isOpen) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    axios.get('/api/assistant/context').then(response => setContext(response.data)).catch(() => setContext(null))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !pos) return undefined
    const onResize = () => setPos(current => clampPos(current, winRef.current?.offsetHeight))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isOpen, pos])

  const onDragStart = (event) => {
    if (event.target.closest('button')) return
    const rect = winRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 合成事件或指针已释放 */ }
  }

  const onDragMove = (event) => {
    if (!dragRef.current) return
    setPos(clampPos({ left: event.clientX - dragRef.current.dx, top: event.clientY - dragRef.current.dy }, winRef.current?.offsetHeight))
  }

  const onDragEnd = (event) => {
    if (!dragRef.current) return
    dragRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 指针已释放 */ }
    const rect = winRef.current?.getBoundingClientRect()
    if (rect) {
      try { localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top })) } catch { /* 仅本次会话 */ }
    }
  }

  const capabilities = useMemo(() => [
    '读取全局业务概览与实时统计',
    '检索客户、供应商、产品和订单',
    '查看商机、待办与近期活动',
    '发起已授权的新增、更新和状态操作'
  ], [])

  if (!isOpen) return null

  const sendMessage = async (text = input) => {
    const prompt = text.trim()
    if (!prompt || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: prompt }])
    setLoading(true)
    try {
      const response = await axios.post('/api/assistant/command', { prompt })
      setMessages(prev => [...prev, { role: 'assistant', text: response.data.reply || '我已收到指令，但当前还没有可执行的结果。', meta: response.data.meta }])
      if (response.data.context) setContext(response.data.context)
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: '暂时无法连接系统能力服务，请确认后端服务正在运行。' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <aside
      ref={winRef}
      className={`ai-window${minimized ? ' is-minimized' : ''}`}
      style={pos ? { left: pos.left, top: pos.top, right: 'auto' } : undefined}
      role="complementary"
      aria-labelledby="ai-assistant-title"
    >
      <div
        className="ai-window-bar"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onDoubleClick={() => setMinimized(value => !value)}
      >
        <div className="ai-panel-title">
          <span className="ai-orb"><BotIcon size={16} /></span>
          <div><span className="section-label">[COPILOT]</span><h2 id="ai-assistant-title">小屁</h2></div>
        </div>
        <div className="ai-window-actions">
          {!minimized && <span className="ai-live-dot" title="已连接系统业务层" />}
          <button
            type="button"
            className="ai-icon-btn"
            onClick={() => setMinimized(value => !value)}
            aria-label={minimized ? '展开小屁' : '最小化小屁'}
            title={minimized ? '展开' : '最小化（也可以双击标题栏）'}
          >
            {minimized ? <SparkIcon size={15} /> : <MinusIcon size={16} />}
          </button>
          <button type="button" className="ai-icon-btn" onClick={onClose} aria-label="关闭小屁" title="关闭">
            <CloseIcon size={15} />
          </button>
        </div>
      </div>

      {!minimized && (
        <React.Fragment>
          <div className="ai-panel-body">
            <div className="ai-access-banner"><span className="ai-live-dot" /><div><strong>已连接系统业务层</strong><small>可读取模块数据，敏感写操作会先请求确认</small></div></div>
            <div className="ai-capability-card"><div className="ai-capability-heading"><SparkIcon size={15} />我能帮你</div>{capabilities.map(capability => <div className="ai-capability-row" key={capability}><span>✓</span>{capability}</div>)}</div>
            {context && <div className="ai-context-strip"><span>当前数据快照</span><b>{context.stats?.customers || 0} 客户</b><b>{context.stats?.products || 0} 产品</b><b>{context.stats?.orders || 0} 订单</b></div>}
            <div className="ai-message-list">
              {messages.map((message, index) => <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}><div className="ai-message-avatar">{message.role === 'assistant' ? <BotIcon size={15} /> : 'W'}</div><div className="ai-message-content"><p>{message.text}</p>{message.meta && <small>{message.meta}</small>}</div></div>)}
              {loading && <div className="ai-message assistant"><div className="ai-message-avatar"><BotIcon size={15} /></div><div className="ai-message-content ai-thinking"><span /><span /><span /></div></div>}
            </div>
          </div>

          <div className="ai-suggestion-row"><button onClick={() => sendMessage('汇总今天最重要的事项')}>汇总今天事项</button><button onClick={() => sendMessage('查看系统数据概览')}>查看系统概览</button></div>
          <form className="ai-input-row" onSubmit={event => { event.preventDefault(); sendMessage() }}><input ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder="告诉小屁你要查什么或做什么…" aria-label="输入给小屁的内容" /><button type="submit" disabled={!input.trim() || loading} aria-label="发送"><SendIcon size={18} /></button></form>
          <div className="ai-panel-footer">小屁会先说明将要执行的操作，再进行需要写入数据的动作。</div>
        </React.Fragment>
      )}
    </aside>
  )
}

export default AIAssistant
