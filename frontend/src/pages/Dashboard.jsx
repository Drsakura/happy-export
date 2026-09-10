import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  ActivityIcon,
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ClipboardIcon,
  DollarIcon,
  FactoryIcon,
  FlagIcon,
  PackageIcon,
  PinIcon,
  SparkIcon,
  UsersIcon
} from '../components/Icons'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function toDateKey(date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function CalendarBoard({ todos }) {
  const today = new Date()
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const monthLabel = month.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
  const monthStartDay = (month.getDay() + 6) % 7
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const previousDays = new Date(month.getFullYear(), month.getMonth(), 0).getDate()

  const calendarDays = useMemo(() => {
    return Array.from({ length: 42 }, (_, index) => {
      const offset = index - monthStartDay + 1
      const date = new Date(month.getFullYear(), month.getMonth(), offset)
      return { date, currentMonth: date.getMonth() === month.getMonth(), key: toDateKey(date) }
    })
  }, [month, monthStartDay])

  const events = useMemo(() => {
    const result = {}
    todos.forEach(todo => {
      if (!todo.due_date) return
      const key = todo.due_date.slice(0, 10)
      result[key] = [...(result[key] || []), { label: todo.title, tone: todo.priority === 'high' ? 'danger' : 'blue' }]
    })
    const year = month.getFullYear()
    const holidays = [
      { date: `${year}-01-01`, label: '元旦 · 节日', tone: 'holiday' },
      { date: `${year}-05-01`, label: '劳动节 · 节日', tone: 'holiday' },
      { date: `${year}-10-01`, label: '国庆节 · 节日', tone: 'holiday' },
      { date: `${year}-12-25`, label: '圣诞节 · 节日', tone: 'holiday' },
    ]
    holidays.forEach(event => { result[event.date] = [...(result[event.date] || []), event] })
    return result
  }, [month, todos])

  const shiftMonth = (delta) => setMonth(current => new Date(current.getFullYear(), current.getMonth() + delta, 1))
  const resetMonth = () => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))

  return (
    <section className="calendar-board dashboard-panel">
      <div className="dashboard-panel-header calendar-board-header">
        <div><span className="section-label">[SCHEDULE]</span><h2><CalendarIcon size={18} /> 工作日历</h2></div>
        <div className="calendar-toolbar"><button className="calendar-today-btn" onClick={resetMonth}>今天</button><button onClick={() => shiftMonth(-1)} aria-label="上个月">‹</button><strong>{monthLabel}</strong><button onClick={() => shiftMonth(1)} aria-label="下个月">›</button><button className="calendar-view-btn">月</button></div>
      </div>
      <div className="calendar-week-row">{WEEKDAYS.map(day => <div key={day}>{day}</div>)}</div>
      <div className="calendar-grid">
        {calendarDays.map(({ date, currentMonth, key }) => {
          const dayEvents = events[key] || []
          const isToday = key === toDateKey(today)
          return <div className={`calendar-day ${currentMonth ? '' : 'is-outside'} ${isToday ? 'is-today' : ''}`} key={`${key}-${date.getTime()}`}>
            <span className="calendar-day-number">{date.getDate()}</span>
            <div className="calendar-events">{dayEvents.slice(0, 3).map((event, index) => <span className={`calendar-event ${event.tone}`} key={`${event.label}-${index}`} title={event.label}>{event.label}</span>)}</div>
          </div>
        })}
      </div>
    </section>
  )
}

function Dashboard() {
  const [data, setData] = useState({ stats: {}, recentActivities: [], todos: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    axios.get('/api/dashboard').then(response => setData(response.data)).catch(error => console.error('获取工作台数据失败:', error)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">加载工作台数据…</div>

  const { stats, recentActivities, todos } = data
  const completion = todos.length ? Math.max(12, Math.round((todos.filter(todo => todo.status === 'completed').length / todos.length) * 100)) : 0

  return (
    <div className="dashboard-container">
      <div className="dashboard-welcome"><div><span className="section-label">[WORKSPACE / OVERVIEW]</span><h1 className="page-title">工作台</h1><p>把今天的节奏、客户和订单放在同一个视野里。</p></div><div className="dashboard-date-chip"><span>运行日期</span><strong>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></div></div>

      <CalendarBoard todos={todos} />

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
