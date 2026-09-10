import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  ActivityIcon,
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ClipboardIcon,
  CloseIcon,
  DollarIcon,
  FactoryIcon,
  FlagIcon,
  PackageIcon,
  PinIcon,
  SparkIcon,
  UsersIcon
} from '../components/Icons'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const PRIORITY_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' }
]
const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' }

const COMPOSER_WIDTH = 306
const TIP_WIDTH = 268

// 春节（农历正月初一）公历日期，逐年查表；2025–2035 与天文台公布数据一致。
const SPRING_FESTIVAL = {
  2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26',
  2029: '2029-02-13', 2030: '2030-02-03', 2031: '2031-01-23', 2032: '2032-02-11',
  2033: '2033-01-31', 2034: '2034-02-19', 2035: '2035-02-08'
}

function pad2(value) {
  return `${value}`.padStart(2, '0')
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 把 YYYY-MM-DD 变成「2026年9月10日 周四」 */
function describeDate(key) {
  const [year, month, day] = key.split('-').map(Number)
  const weekday = WEEKDAY_SHORT[new Date(year, month - 1, day).getDay()]
  return `${year}年${month}月${day}日 ${weekday}`
}

/** 某年某月的第 n 个星期 weekday（0=周日） */
function nthWeekday(year, monthIndex, weekday, nth) {
  const first = new Date(year, monthIndex, 1)
  const offset = (weekday - first.getDay() + 7) % 7
  return new Date(year, monthIndex, 1 + offset + (nth - 1) * 7)
}

/**
 * 该年的节日清单：公历固定节日 + 春节 + 感恩节 / 黑色星期五。
 * note 写「具体内容」，站在外贸视角说明它对出货、订舱和客户响应的影响。
 */
function holidaysOf(year) {
  const list = [
    {
      date: `${year}-01-01`,
      name: '元旦',
      note: '公历新年。中国大陆放假 1 天，欧美客户同日休假，是全年邮件回复率最低的节点之一。'
    },
    {
      date: `${year}-05-01`,
      name: '劳动节',
      note: '中国法定假日，通常连休 5 天（含调休）。工厂与货代节前集中出货，节中报关、拖车基本停摆。'
    },
    {
      date: `${year}-10-01`,
      name: '国庆节',
      note: '中国法定假日，通常连休 7 天（含调休）。节前是出货高峰，节后第一周订舱紧张、运价常上浮。'
    },
    {
      date: `${year}-12-25`,
      name: '圣诞节',
      note: '欧美客户最重要的节日，12 月 24 日起多数公司进入假期，下单与回款停滞至次年 1 月上旬。'
    }
  ]

  const springFestival = SPRING_FESTIVAL[year]
  if (springFestival) {
    list.push({
      date: springFestival,
      name: '春节',
      note: '农历正月初一。中国法定假日，工厂通常停工 2–4 周，节前需提前 4–6 周排产与订舱。'
    })
  }

  const thanksgiving = nthWeekday(year, 10, 4, 4)
  list.push({
    date: toDateKey(thanksgiving),
    name: '感恩节',
    note: '美国法定假日（11 月第 4 个周四）。美国客户休假，也是北美年末采购季的开端。'
  })
  const blackFriday = new Date(thanksgiving.getFullYear(), thanksgiving.getMonth(), thanksgiving.getDate() + 1)
  list.push({
    date: toDateKey(blackFriday),
    name: '黑色星期五',
    note: '感恩节次日，北美全年最大的促销节点。零售端的补货订单通常要提前到 9–10 月下达。'
  })

  return list
}

/** 以触发元素为锚点计算浮层坐标，下方放不下时翻到上方，并夹在视口内 */
function anchorFor(element, width, estimatedHeight = 240, gap = 8) {
  const rect = element.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const flipUp = rect.bottom + gap + estimatedHeight > viewportHeight && rect.top - gap - estimatedHeight > 0
  const maxLeft = Math.max(12, viewportWidth - width - 12)
  return {
    left: Math.min(Math.max(12, rect.left), maxLeft),
    top: flipUp ? rect.top - gap : rect.bottom + gap,
    placement: flipUp ? 'above' : 'below'
  }
}

function CalendarBoard({ todos: seedTodos, onTodoCreated }) {
  const today = new Date()
  const todayKey = toDateKey(today)

  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [monthTodos, setMonthTodos] = useState(() => (seedTodos || []).filter(todo => todo.due_date))
  const [selectedKey, setSelectedKey] = useState(null)
  const [composerKey, setComposerKey] = useState(null)
  const [composerAnchor, setComposerAnchor] = useState(null)
  const [tip, setTip] = useState(null)
  const [draft, setDraft] = useState({ title: '', priority: 'medium', description: '' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const composerRef = useRef(null)
  const tipRef = useRef(null)
  const anchorElRef = useRef(null)
  const pendingSelectRef = useRef(null)

  const monthLabel = month.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
  const monthStartDay = (month.getDay() + 6) % 7

  const calendarDays = useMemo(() => (
    Array.from({ length: 42 }, (_, index) => {
      const date = new Date(month.getFullYear(), month.getMonth(), index - monthStartDay + 1)
      return { date, currentMonth: date.getMonth() === month.getMonth(), key: toDateKey(date) }
    })
  ), [month, monthStartDay])

  const gridFrom = calendarDays[0].key
  const gridTo = calendarDays[calendarDays.length - 1].key

  const holidayYears = useMemo(
    () => [...new Set(calendarDays.map(day => day.date.getFullYear()))],
    [calendarDays]
  )

  // 日历按可见网格范围取数（含已完成），与工作台的待办列表各取所需。
  const loadTodos = useCallback(async () => {
    try {
      const response = await axios.get('/api/todos', { params: { from: gridFrom, to: gridTo } })
      setMonthTodos(Array.isArray(response.data) ? response.data.filter(todo => todo.due_date) : [])
    } catch (error) {
      console.error('获取日历日程失败:', error)
    }
  }, [gridFrom, gridTo])

  useEffect(() => { loadTodos() }, [loadTodos])

  const events = useMemo(() => {
    const result = {}
    const push = (key, item) => {
      result[key] = [...(result[key] || []), { ...item, dateLabel: describeDate(key) }]
    }

    monthTodos.forEach(todo => {
      const key = String(todo.due_date).slice(0, 10)
      const done = todo.status === 'completed'
      push(key, {
        kind: 'todo',
        key: `todo-${todo.id}`,
        label: todo.title,
        title: todo.title,
        tone: done ? 'done' : todo.priority === 'high' ? 'danger' : 'blue',
        priority: todo.priority,
        status: todo.status,
        customer: todo.customer_name || '',
        description: todo.description || '',
        note: ''
      })
    })

    holidayYears.forEach(year => holidaysOf(year).forEach(holiday => push(holiday.date, {
      kind: 'holiday',
      key: `holiday-${holiday.date}`,
      label: `${holiday.name} · 节日`,
      title: holiday.name,
      tone: 'holiday',
      note: holiday.note
    })))

    return result
  }, [holidayYears, monthTodos])

  const closeComposer = useCallback(() => {
    setComposerKey(null)
    setComposerAnchor(null)
    setFormError('')
  }, [])

  const hideTip = useCallback(() => setTip(null), [])

  // 渲染后按真实高度算一次校正量，避免估算偏差把浮层顶出视口
  const settleShift = useCallback((element) => {
    if (!element) return 0
    const rect = element.getBoundingClientRect()
    const margin = 10
    const overflowBottom = rect.bottom - (window.innerHeight - margin)
    const overflowTop = margin - rect.top
    if (overflowBottom > 0) return -overflowBottom
    if (overflowTop > 0) return overflowTop
    return 0
  }, [])

  const handleDayClick = (event, key) => {
    // 面板打开时点击日期由 document 的 mousedown 接管，这里只负责落到新选中日
    if (pendingSelectRef.current) {
      const pending = pendingSelectRef.current
      pendingSelectRef.current = null
      setSelectedKey(pending)
      return
    }
    if (composerKey === key) { closeComposer(); return }
    if (composerKey) { closeComposer(); setSelectedKey(key); return }
    if (selectedKey === key) {
      anchorElRef.current = event.currentTarget
      setComposerAnchor({ ...anchorFor(event.currentTarget, COMPOSER_WIDTH, 330), settled: false })
      setComposerKey(key)
      setDraft({ title: '', priority: 'medium', description: '' })
      setFormError('')
      setSelectedKey(key)
      return
    }
    setSelectedKey(key)
  }

  const handleDayKeyDown = (event, key) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleDayClick(event, key)
  }

  const showTip = (event, item) => setTip({ anchor: anchorFor(event.currentTarget, TIP_WIDTH, 200), item, settled: false })

  // 每个浮层只校正一次（settled 标记），校正量不产生新的依赖变化，避免反复 setState
  useLayoutEffect(() => {
    if (!composerKey || !composerAnchor || composerAnchor.settled) return
    const shift = settleShift(composerRef.current)
    setComposerAnchor(current => (current ? { ...current, settled: true, top: shift ? current.top + shift : current.top } : current))
  }, [composerAnchor, composerKey, settleShift])

  useLayoutEffect(() => {
    if (!tip || tip.settled) return
    const shift = settleShift(tipRef.current)
    setTip(current => (current ? { ...current, settled: true, anchor: shift ? { ...current.anchor, top: current.anchor.top + shift } : current.anchor } : current))
  }, [tip, settleShift])

  // Esc 收起面板与浮窗
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      closeComposer()
      setTip(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeComposer])

  // 面板打开时，点击面板外即收起；点到日期格则顺带选中那一天
  useEffect(() => {
    if (!composerKey) return undefined
    const onPointerDown = (event) => {
      if (composerRef.current?.contains(event.target)) return
      const dayEl = event.target.closest?.('.calendar-day')
      pendingSelectRef.current = dayEl?.dataset?.dateKey || null
      closeComposer()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [composerKey, closeComposer])

  // 滚动 / 缩放时跟着锚点走，避免浮层飘在原地
  useEffect(() => {
    if (!composerKey) return undefined
    const reposition = () => {
      if (anchorElRef.current) setComposerAnchor({ ...anchorFor(anchorElRef.current, COMPOSER_WIDTH, 330), settled: false })
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [composerKey])

  useEffect(() => {
    if (!tip) return undefined
    window.addEventListener('scroll', hideTip, true)
    window.addEventListener('resize', hideTip)
    return () => {
      window.removeEventListener('scroll', hideTip, true)
      window.removeEventListener('resize', hideTip)
    }
  }, [tip, hideTip])

  const shiftMonth = (delta) => setMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  const resetMonth = () => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))

  const submitDraft = async (event) => {
    event.preventDefault()
    const title = draft.title.trim()
    if (!title) { setFormError('请填写日程标题'); return }
    setSaving(true)
    setFormError('')
    try {
      await axios.post('/api/todos', {
        title,
        due_date: composerKey,
        priority: draft.priority,
        description: draft.description.trim()
      })
      setSelectedKey(composerKey)
      closeComposer()
      setDraft({ title: '', priority: 'medium', description: '' })
      await loadTodos()
      if (onTodoCreated) onTodoCreated()
    } catch (error) {
      setFormError(error?.response?.data?.error || '添加失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="calendar-board dashboard-panel">
      <div className="dashboard-panel-header calendar-board-header">
        <div>
          <span className="section-label">[SCHEDULE]</span>
          <h2><CalendarIcon size={18} /> 工作日历</h2>
          <p className="calendar-hint">单击日期选中，再次单击添加日程 · 悬浮日程或节日查看详情</p>
        </div>
        <div className="calendar-toolbar"><button className="calendar-today-btn" onClick={resetMonth}>今天</button><button onClick={() => shiftMonth(-1)} aria-label="上个月">‹</button><strong>{monthLabel}</strong><button onClick={() => shiftMonth(1)} aria-label="下个月">›</button><button className="calendar-view-btn">月</button></div>
      </div>
      <div className="calendar-week-row">{WEEKDAYS.map(day => <div key={day}>{day}</div>)}</div>
      <div className="calendar-grid">
        {calendarDays.map(({ date, currentMonth, key }) => {
          const dayEvents = events[key] || []
          const isToday = key === todayKey
          const isSelected = key === selectedKey
          const overflow = dayEvents.slice(3)
          const label = `${describeDate(key)}${dayEvents.length ? `，${dayEvents.length} 项日程` : ''}${isSelected ? '，已选中' : ''}`
          return (
            <div
              className={`calendar-day ${currentMonth ? '' : 'is-outside'} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${key === composerKey ? 'is-composing' : ''}`}
              key={key}
              data-date-key={key}
              role="button"
              tabIndex={0}
              aria-label={label}
              onClick={(event) => handleDayClick(event, key)}
              onKeyDown={(event) => handleDayKeyDown(event, key)}
            >
              <span className="calendar-day-number">{date.getDate()}</span>
              <div className="calendar-events">
                {dayEvents.slice(0, 3).map(event => (
                  <span
                    className={`calendar-event ${event.tone}`}
                    key={event.key}
                    onMouseEnter={(mouseEvent) => showTip(mouseEvent, event)}
                    onMouseLeave={hideTip}
                  >
                    {event.label}
                  </span>
                ))}
                {overflow.length > 0 && (
                  <span
                    className="calendar-more"
                    onMouseEnter={(mouseEvent) => showTip(mouseEvent, { kind: 'more', title: `还有 ${overflow.length} 项`, items: overflow })}
                    onMouseLeave={hideTip}
                  >
                    +{overflow.length}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {composerKey && composerAnchor && (
        <div
          className="calendar-popover calendar-composer"
          ref={composerRef}
          role="dialog"
          aria-label={`添加日程 ${describeDate(composerKey)}`}
          style={{
            left: composerAnchor.left,
            top: composerAnchor.top,
            transform: composerAnchor.placement === 'above' ? 'translateY(-100%)' : 'none'
          }}
        >
          <form onSubmit={submitDraft}>
            <div className="calendar-composer-head">
              <div>
                <strong>添加日程</strong>
                <small>{describeDate(composerKey)}</small>
              </div>
              <button type="button" className="calendar-popover-close" onClick={closeComposer} aria-label="关闭"><CloseIcon size={14} /></button>
            </div>
            <label className="calendar-field">
              <span>标题</span>
              <input
                type="text"
                autoFocus
                maxLength={200}
                value={draft.title}
                placeholder="例如：给德国客户回报价单"
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <div className="calendar-field">
              <span>优先级</span>
              <div className="calendar-priority-row">
                {PRIORITY_OPTIONS.map(option => (
                  <button
                    type="button"
                    key={option.value}
                    className={draft.priority === option.value ? 'is-active' : ''}
                    onClick={() => setDraft({ ...draft, priority: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="calendar-field">
              <span>备注</span>
              <textarea
                maxLength={1000}
                value={draft.description}
                placeholder="可选，补充跟进要点"
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </label>
            {formError && <p className="calendar-composer-error">{formError}</p>}
            <div className="calendar-composer-actions">
              <button type="button" className="is-ghost" onClick={closeComposer}>取消</button>
              <button type="submit" className="is-primary" disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            </div>
          </form>
        </div>
      )}

      {tip && tip.anchor && (
        <div
          className="calendar-popover calendar-tip"
          ref={tipRef}
          role="tooltip"
          style={{
            left: tip.anchor.left,
            top: tip.anchor.top,
            transform: tip.anchor.placement === 'above' ? 'translateY(-100%)' : 'none'
          }}
        >
          {tip.item.kind === 'more' ? (
            <React.Fragment>
              <div className="calendar-tip-head"><span className="calendar-tip-kind is-todo">日程</span><span className="calendar-tip-title">{tip.item.title}</span></div>
              <div className="calendar-tip-more">{tip.item.items.map(item => <span key={item.key}>· {item.label}</span>)}</div>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <div className="calendar-tip-head">
                <span className={`calendar-tip-kind ${tip.item.kind === 'holiday' ? 'is-holiday' : 'is-todo'}`}>{tip.item.kind === 'holiday' ? '节日' : '日程'}</span>
                <span className="calendar-tip-date">{tip.item.dateLabel}</span>
              </div>
              <div className="calendar-tip-title">{tip.item.title}</div>
              {tip.item.kind !== 'holiday' && (
                <dl className="calendar-tip-body">
                  <div className="calendar-tip-row"><dt>优先级</dt><dd>{PRIORITY_LABELS[tip.item.priority] || '中'}</dd></div>
                  <div className="calendar-tip-row"><dt>状态</dt><dd>{tip.item.status === 'completed' ? '已完成' : '待处理'}</dd></div>
                  {tip.item.customer && <div className="calendar-tip-row"><dt>客户</dt><dd>{tip.item.customer}</dd></div>}
                </dl>
              )}
              {tip.item.description && <p className="calendar-tip-note">备注：{tip.item.description}</p>}
              {tip.item.note && <p className="calendar-tip-note">{tip.item.note}</p>}
            </React.Fragment>
          )}
        </div>
      )}
    </section>
  )
}

function Dashboard() {
  const [data, setData] = useState({ stats: {}, recentActivities: [], todos: [] })
  const [loading, setLoading] = useState(true)

  const loadDashboard = useCallback(async () => {
    try {
      const response = await axios.get('/api/dashboard')
      setData(response.data)
    } catch (error) {
      console.error('获取工作台数据失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  if (loading) return <div className="loading">加载工作台数据…</div>

  const { stats, recentActivities, todos } = data
  const completion = todos.length ? Math.max(12, Math.round((todos.filter(todo => todo.status === 'completed').length / todos.length) * 100)) : 0

  return (
    <div className="dashboard-container">
      <div className="dashboard-welcome"><div><span className="section-label">[WORKSPACE / OVERVIEW]</span><h1 className="page-title">工作台</h1><p>把今天的节奏、客户和订单放在同一个视野里。</p></div></div>

      <CalendarBoard todos={todos} onTodoCreated={loadDashboard} />

      <div className="dashboard-content-grid">
        <div className="dashboard-primary-column">
          <section className="dashboard-panel ai-digest-panel"><div className="dashboard-panel-header"><div><span className="section-label">[AI BRIEFING]</span><h2><SparkIcon size={16} /> 今日工作摘要</h2></div><span className="panel-live-status"><i />实时</span></div><div className="ai-digest-body"><strong>系统已准备好协助你处理今天的业务。</strong><p>当前共有 <b>{stats.pendingTodos || 0}</b> 项待办、<b>{stats.activeDeals || 0}</b> 个进行中商机和 <b>{stats.orders || 0}</b> 笔进行中订单。打开右上角 AI 助手，可以直接用自然语言查阅和操作系统。</p><div className="digest-tags"><span>供应链</span><span>客户跟进</span><span>订单节奏</span></div></div></section>

          <section className="dashboard-panel"><div className="dashboard-panel-header"><div><span className="section-label">[TASK QUEUE]</span><h2><PinIcon size={17} /> 待办事项</h2></div><button className="panel-link">查看全部</button></div>{todos.length === 0 ? <div className="dashboard-empty">暂无待办事项，今天可以保持从容。</div> : <ul className="todo-list">{todos.map(todo => <li key={todo.id} className="todo-item"><input type="checkbox" aria-label={`完成 ${todo.title}`} /><div className="todo-content"><div className="todo-title">{todo.title}</div><div className="todo-meta">{todo.customer_name ? `客户：${todo.customer_name}` : '内部任务'}{todo.due_date ? ` · 截止 ${new Date(todo.due_date).toLocaleDateString('zh-CN')}` : ''}</div></div><span className={`priority-badge priority-${todo.priority}`}>{todo.priority === 'high' ? '高' : todo.priority === 'medium' ? '中' : '低'}</span></li>)}</ul>}</section>

          <section className="dashboard-panel"><div className="dashboard-panel-header"><div><span className="section-label">[ACTIVITY LOG]</span><h2><ActivityIcon size={17} /> 最近活动</h2></div><button className="panel-link">查看日志</button></div>{recentActivities.length === 0 ? <div className="dashboard-empty">暂无最近活动</div> : <ul className="activity-list">{recentActivities.map(activity => <li key={activity.id} className="activity-item"><span className="activity-time">{new Date(activity.created_at).toLocaleString('zh-CN')}</span><div className="activity-content"><strong>{activity.subject}</strong><span>{activity.content}</span></div></li>)}</ul>}</section>
        </div>

        <aside className="dashboard-secondary-column">
          <section className="dashboard-panel stat-rail"><div className="dashboard-panel-header"><div><span className="section-label">[SYSTEM PULSE]</span><h2>业务概览</h2></div><span className="panel-period">本月</span></div><StatLine icon={<FactoryIcon size={17} />} label="供应商" value={stats.suppliers || 0} /><StatLine icon={<PackageIcon size={17} />} label="产品 SKU" value={stats.products || 0} /><StatLine icon={<UsersIcon size={17} />} label="客户" value={stats.customers || 0} /><StatLine icon={<ClipboardIcon size={17} />} label="进行中订单" value={stats.orders || 0} /><StatLine icon={<DollarIcon size={17} />} label="进行中商机" value={stats.activeDeals || 0} /></section>
          <section className="dashboard-panel completion-panel"><div className="dashboard-panel-header"><div><span className="section-label">[TASK HEALTH]</span><h2>任务完成情况</h2></div><span className="panel-period">当前</span></div><div className="completion-ring" style={{ '--progress': `${completion}%` }}><div><strong>{completion}%</strong><span>完成率</span></div></div><div className="completion-legend"><span><i className="dot done" />已完成</span><span><i className="dot pending" />待处理</span></div></section>
          <section className="dashboard-panel quick-panel"><div className="dashboard-panel-header"><div><span className="section-label">[QUICK ACCESS]</span><h2>快捷入口</h2></div></div><button><UsersIcon size={16} /> 新增客户</button><button><PackageIcon size={16} /> 添加产品</button><button><ClipboardIcon size={16} /> 新建订单</button></section>
        </aside>
      </div>
    </div>
  )
}

function StatLine({ icon, label, value }) { return <div className="stat-line"><span className="stat-line-icon">{icon}</span><span>{label}</span><strong>{value}</strong></div> }

export default Dashboard
