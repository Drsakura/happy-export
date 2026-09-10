import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { BotIcon, CloseIcon, SendIcon, SparkIcon } from './Icons'

const starterMessages = [
  { role: 'assistant', text: '你好，我是你的供应链 AI 助手。可以帮你查看客户、产品、供应商、订单、商机和待办，也可以协助发起系统内的业务操作。' },
]

function AIAssistant({ isOpen, onClose }) {
  const [messages, setMessages] = useState(starterMessages)
  const [input, setInput] = useState('')
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return
    inputRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) return
    axios.get('/api/assistant/context').then(response => setContext(response.data)).catch(() => setContext(null))
  }, [isOpen])

  const capabilities = useMemo(() => [
    '读取全局业务概览与实时统计',
    '检索客户、供应商、产品和订单',
    '查看商机、待办与近期活动',
    '发起已授权的新增、更新和状态操作',
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
    <div className="assistant-layer" onClick={onClose}>
      <aside ref={panelRef} className="ai-assistant-panel" role="dialog" aria-modal="true" aria-labelledby="ai-assistant-title" onClick={event => event.stopPropagation()}>
        <div className="ai-panel-header">
          <div className="ai-panel-title"><span className="ai-orb"><BotIcon size={20} /></span><div><span className="section-label">[SYSTEM COPILOT]</span><h2 id="ai-assistant-title">AI 助手</h2></div></div>
          <button className="ai-close-btn" onClick={onClose} aria-label="关闭 AI 助手"><CloseIcon size={18} /></button>
        </div>

        <div className="ai-access-banner"><span className="ai-live-dot" /><div><strong>已连接系统业务层</strong><small>可读取模块数据，敏感写操作会先请求确认</small></div></div>

        <div className="ai-panel-body">
          <div className="ai-capability-card"><div className="ai-capability-heading"><SparkIcon size={15} />我能帮你</div>{capabilities.map(capability => <div className="ai-capability-row" key={capability}><span>✓</span>{capability}</div>)}</div>
          {context && <div className="ai-context-strip"><span>当前数据快照</span><b>{context.stats?.customers || 0} 客户</b><b>{context.stats?.products || 0} 产品</b><b>{context.stats?.orders || 0} 订单</b></div>}
          <div className="ai-message-list">
            {messages.map((message, index) => <div className={`ai-message ${message.role}`} key={`${message.role}-${index}`}><div className="ai-message-avatar">{message.role === 'assistant' ? <BotIcon size={15} /> : 'W'}</div><div className="ai-message-content"><p>{message.text}</p>{message.meta && <small>{message.meta}</small>}</div></div>)}
            {loading && <div className="ai-message assistant"><div className="ai-message-avatar"><BotIcon size={15} /></div><div className="ai-message-content ai-thinking"><span /><span /><span /></div></div>}
          </div>
        </div>

        <div className="ai-suggestion-row"><button onClick={() => sendMessage('汇总今天最重要的事项')}>汇总今天事项</button><button onClick={() => sendMessage('查看系统数据概览')}>查看系统概览</button></div>
        <form className="ai-input-row" onSubmit={event => { event.preventDefault(); sendMessage() }}><input ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder="告诉 AI 你要查什么或做什么…" aria-label="输入给 AI 助手的内容" /><button type="submit" disabled={!input.trim() || loading} aria-label="发送"><SendIcon size={18} /></button></form>
        <div className="ai-panel-footer">AI 会先说明将要执行的操作，再进行需要写入数据的动作。</div>
      </aside>
    </div>
  )
}

export default AIAssistant
