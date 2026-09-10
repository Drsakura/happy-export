import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  ActivityIcon,
  CalendarIcon,
  CheckIcon,
  ClipboardIcon,
  CloseIcon,
  DollarIcon,
  FactoryIcon,
  PackageIcon,
  PinIcon,
  PlusCircleIcon,
  SparkIcon,
  TrashIcon,
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
const JUMP_WIDTH = 262
const JUMP_HEIGHT = 292
const MAX_CELL_EVENTS = 2

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

/** 把 YYYY-MM-DD 变成「9月10日 周四」 */
function describeDateShort(key) {
  const [, month, day] = key.split('-').map(Number)
  const [year] = key.split('-').map(Number)
  const weekday = WEEKDAY_SHORT[new Date(year, month - 1, day).getDay()]
  return `${month}月${day}日 ${weekday}`
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

/**
 * 今日 to do —— 轻量备忘录。
 * 回车新增；勾选后划线变淡并沉到列表末尾（输入框始终在最底下一行）。
 */
function TodoMemo() {
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const listRef = useRef(null)
  const revealIdRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const response = await axios.get('/api/todos', { params: { list: 'memo' } })
      setItems(Array.isArray(response.data) ? response.data : [])
    } catch (loadError) {
      console.error('获取今日待办失败:', loadError)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 未完成在前（按创建顺序），已完成沉底（后完成的排更靠下，紧贴输入框）
  const ordered = useMemo(() => {
    const rank = (item) => (item.status === 'completed' ? 1 : 0)
    return [...items].sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      if (rank(a) === 1) return String(a.completed_at || '').localeCompare(String(b.completed_at || ''))
      return Number(a.id) - Number(b.id)
    })
  }, [items])

  // 列表可滚动时，勾选后把沉底的条目滚进视野，避免「点完就找不到了」
  useLayoutEffect(() => {
    const id = revealIdRef.current
    if (!id) return
    revealIdRef.current = null
    const node = listRef.current?.querySelector(`[data-memo-id="${id}"]`)
    if (node) node.scrollIntoView({ block: 'nearest' })
  }, [ordered])

  const doneCount = items.filter((item) => item.status === 'completed').length

  const submit = async (event) => {
    event.preventDefault()
    const title = draft.trim()
    if (!title || saving) return
    setSaving(true)
    setError('')
    try {
      const response = await axios.post('/api/todos', { title, list: 'memo' })
      setDraft('')
      if (response.data?.todo) {
        setItems((current) => [...current, response.data.todo])
      } else {
        await load()
      }
    } catch (submitError) {
      setError(submitError?.response?.data?.error || '添加失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (item) => {
    const nextStatus = item.status === 'completed' ? 'pending' : 'completed'
    const optimistic = {
      ...item,
      status: nextStatus,
      completed_at: nextStatus === 'completed' ? new Date().toISOString() : null
    }
    revealIdRef.current = item.id
    setItems((current) => current.map((row) => (row.id === item.id ? optimistic : row)))
    try {
      const response = await axios.patch(`/api/todos/${item.id}`, { status: nextStatus })
      if (response.data?.todo) {
        setItems((current) => current.map((row) => (row.id === item.id ? response.data.todo : row)))
      }
    } catch (toggleError) {
      console.error('更新待办状态失败:', toggleError)
      setItems((current) => current.map((row) => (row.id === item.id ? item : row)))
      setError('状态更新失败，请重试')
    }
  }

  const remove = async (item) => {
    setItems((current) => current.filter((row) => row.id !== item.id))
    try {
      await axios.delete(`/api/todos/${item.id}`)
    } catch (removeError) {
      console.error('删除待办失败:', removeError)
      setError('删除失败，请重试')
      await load()
    }
  }

  return (
    <section className="calendar-side-block is-memo">
      <div className="calendar-side-head">
        <div>
          <h3><CheckIcon size={14} /> 今日 to do</h3>
          <span className="calendar-side-sub">备忘录 · 回车确认，勾选后沉底</span>
        </div>
        {doneCount > 0 && <span className="calendar-side-count">{doneCount}/{items.length}</span>}
      </div>

      {ordered.length > 0 && (
        <ul className="memo-list" ref={listRef}>
          {ordered.map((item) => {
            const isDone = item.status === 'completed'
            return (
              <li className={`memo-item ${isDone ? 'is-done' : ''}`} key={item.id} data-memo-id={item.id}>
                <button
                  type="button"
                  className="memo-check"
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={isDone ? `取消完成 ${item.title}` : `完成 ${item.title}`}
                  onClick={() => toggle(item)}
                >
                  <CheckIcon size={11} />
                </button>
                <span className="memo-text">{item.title}</span>
                <button type="button" className="memo-remove" onClick={() => remove(item)} aria-label={`删除 ${item.title}`}>
                  <TrashIcon size={13} />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <form className="memo-add" onSubmit={submit} data-saving={saving ? 'true' : 'false'}>
        <span className="memo-add-icon"><PlusCircleIcon size={15} /></span>
        <input
          type="text"
          value={draft}
          maxLength={200}
          placeholder="添加一条待办，回车确认"
          aria-label="添加今日待办"
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>
      {error && <p className="calendar-composer-error">{error}</p>}
    </section>
  )
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
  // 快速跳转日期：工具条上的小日历按钮 + 浮出的迷你月历
  const [jumpOpen, setJumpOpen] = useState(false)
  const [jumpPos, setJumpPos] = useState(null)
  const [jumpMonth, setJumpMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))

  const composerRef = useRef(null)
  const tipRef = useRef(null)
  const jumpRef = useRef(null)
  const jumpBtnRef = useRef(null)
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
      const response = await axios.get('/api/todos', { params: { from: gridFrom, to: gridTo, list: 'schedule' } })
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

  // 没显式选中时，右侧面板默认看今天
  const activeKey = selectedKey || todayKey
  const activeEvents = events[activeKey] || []

  // 迷你月历：按真实天数出行数，避免六月/九月都留一行空
  const jumpStartDay = (jumpMonth.getDay() + 6) % 7
  const jumpRows = Math.ceil((jumpStartDay + new Date(jumpMonth.getFullYear(), jumpMonth.getMonth() + 1, 0).getDate()) / 7)
  const jumpDays = useMemo(() => (
    Array.from({ length: jumpRows * 7 }, (_, index) => {
      const date = new Date(jumpMonth.getFullYear(), jumpMonth.getMonth(), index - jumpStartDay + 1)
      return { date, key: toDateKey(date), currentMonth: date.getMonth() === jumpMonth.getMonth() }
    })
  ), [jumpMonth, jumpStartDay, jumpRows])

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

  const openComposer = useCallback((key, element) => {
    anchorElRef.current = element
    setComposerAnchor({ ...anchorFor(element, COMPOSER_WIDTH, 330), settled: false })
    setComposerKey(key)
    setDraft({ title: '', priority: 'medium', description: '' })
    setFormError('')
    setSelectedKey(key)
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
    if (selectedKey === key) { openComposer(key, event.currentTarget); return }
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

  /* 跳转浮层挂在工具条按钮右缘（右对齐），下方放不下就翻到上方 */
  const positionJump = useCallback((element) => {
    const rect = element.getBoundingClientRect()
    const left = Math.min(Math.max(12, rect.right - JUMP_WIDTH), Math.max(12, window.innerWidth - JUMP_WIDTH - 12))
    const flipUp = rect.bottom + 9 + JUMP_HEIGHT > window.innerHeight && rect.top - 9 - JUMP_HEIGHT > 0
    setJumpPos({ left, top: flipUp ? rect.top - 9 : rect.bottom + 9, placement: flipUp ? 'above' : 'below' })
  }, [])

  const toggleJump = (event) => {
    if (jumpOpen) { setJumpOpen(false); return }
    jumpBtnRef.current = event.currentTarget
    positionJump(event.currentTarget)
    setJumpMonth(new Date(month.getFullYear(), month.getMonth(), 1))
    setJumpOpen(true)
  }

  const pickJumpDay = (key) => {
    const [year, monthIndex] = key.split('-').map(Number)
    setMonth(new Date(year, monthIndex - 1, 1))
    setSelectedKey(key)
    setJumpOpen(false)
  }

  // 点空白处收起跳转浮层（点按钮本身交给 toggleJump 处理）
  useEffect(() => {
    if (!jumpOpen) return undefined
    const onPointerDown = (event) => {
      if (jumpRef.current?.contains(event.target)) return
      if (event.target.closest?.('.calendar-jump-btn')) return
      setJumpOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [jumpOpen])

  // 滚动 / 缩放时跟着按钮走
  useEffect(() => {
    if (!jumpOpen) return undefined
    const reposition = () => { if (jumpBtnRef.current) positionJump(jumpBtnRef.current) }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [jumpOpen, positionJump])

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
        description: draft.description.trim(),
        list: 'schedule'
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
        <div className="calendar-toolbar"><button className="calendar-today-btn" onClick={resetMonth}>今天</button><button onClick={() => shiftMonth(-1)} aria-label="上个月">‹</button><strong>{monthLabel}</strong><button onClick={() => shiftMonth(1)} aria-label="下个月">›</button><button type="button" ref={jumpBtnRef} className={`calendar-jump-btn${jumpOpen ? ' is-open' : ''}`} onClick={toggleJump} aria-label="快速跳转日期" aria-expanded={jumpOpen} title="快速跳转日期"><CalendarIcon size={16} /></button></div>
      </div>

      <div className="calendar-layout">
        <div className="calendar-main">
          <div className="calendar-week-row">{WEEKDAYS.map(day => <div key={day}>{day}</div>)}</div>
          <div className="calendar-grid">
            {calendarDays.map(({ date, currentMonth, key }) => {
              const dayEvents = events[key] || []
              const isToday = key === todayKey
              const isSelected = key === selectedKey
              const overflow = dayEvents.slice(MAX_CELL_EVENTS)
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
                    {dayEvents.slice(0, MAX_CELL_EVENTS).map(event => (
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
        </div>

        <aside className="calendar-side">
          <TodoMemo />

          <section className="calendar-side-block is-day">
            <div className="calendar-side-head">
              <div>
                <h3><PinIcon size={14} /> 待办事项</h3>
                <span className="calendar-side-sub">{describeDate(activeKey)}</span>
              </div>
              <button
                type="button"
                className="calendar-side-add"
                onClick={(event) => openComposer(activeKey, event.currentTarget)}
              >
                <PlusCircleIcon size={14} /> 新建
              </button>
            </div>

            {activeEvents.length === 0 ? (
              <p className="calendar-side-empty">这一天还没有安排。</p>
            ) : (
              <ul className="day-list">
                {activeEvents.map(item => (
                  <li
                    className={`day-item ${item.kind === 'holiday' ? 'is-holiday' : ''} ${item.status === 'completed' ? 'is-done' : ''}`}
                    key={item.key}
                  >
                    <span className={`day-dot ${item.tone}`} />
                    <div className="day-body">
                      <span className="day-title">{item.title}</span>
                      {item.kind === 'holiday' ? (
                        <span className="day-note">{item.note}</span>
                      ) : (
                        <span className="day-meta">
                          {PRIORITY_LABELS[item.priority] || '中'}优先级
                          {item.customer ? ` · ${item.customer}` : ''}
                          {item.status === 'completed' ? ' · 已完成' : ''}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
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
                <small>{describeDateShort(composerKey)}</small>
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

      {jumpOpen && jumpPos && (
        <div
          className="calendar-popover calendar-jump-pop"
          ref={jumpRef}
          role="dialog"
          aria-label="快速跳转日期"
          style={{
            left: jumpPos.left,
            top: jumpPos.top,
            transform: jumpPos.placement === 'above' ? 'translateY(-100%)' : 'none'
          }}
        >
          <div className="jump-head">
            <button type="button" onClick={() => setJumpMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label="上个月">‹</button>
            <strong>{jumpMonth.getFullYear()}年{jumpMonth.getMonth() + 1}月</strong>
            <button type="button" onClick={() => setJumpMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label="下个月">›</button>
          </div>
          <div className="jump-week">{WEEKDAYS.map(day => <span key={day}>{day.slice(1)}</span>)}</div>
          <div className="jump-grid">
            {jumpDays.map(({ date, key, currentMonth }) => (
              <button
                type="button"
                key={key}
                className={`jump-day${currentMonth ? '' : ' is-outside'}${key === todayKey ? ' is-today' : ''}${key === selectedKey ? ' is-selected' : ''}`}
                onClick={() => pickJumpDay(key)}
                aria-label={describeDate(key)}
                title={describeDate(key)}
              >
                {date.getDate()}
              </button>
            ))}
          </div>
          <button type="button" className="jump-today" onClick={() => pickJumpDay(todayKey)}>回到今天</button>
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
          <section className="dashboard-panel ai-digest-panel"><div className="dashboard-panel-header"><div><span className="section-label">[AI BRIEFING]</span><h2><SparkIcon size={16} /> 今日工作摘要</h2></div><span className="panel-live-status"><i />实时</span></div><div className="ai-digest-body"><strong>系统已准备好协助你处理今天的业务。</strong><p>当前共有 <b>{stats.pendingTodos || 0}</b> 项待办、<b>{stats.activeDeals || 0}</b> 个进行中商机和 <b>{stats.orders || 0}</b> 笔进行中订单。打开右上角的小屁，可以直接用自然语言查阅和操作系统。</p><div className="digest-tags"><span>供应链</span><span>客户跟进</span><span>订单节奏</span></div></div></section>

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
