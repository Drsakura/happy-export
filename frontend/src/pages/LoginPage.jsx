import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CloudDbIcon, UsersIcon } from '../components/Icons'
import { useAuth } from '../auth'
import { useBranding, setPageTitle } from '../branding'

/**
 * 登录页。
 *
 * 用 replace 跳转：登录成功后不该能用浏览器返回键退回登录页。
 * 若是因为「会话过期」被动登出（顶层守卫带过来的 from），登录后回到原来那一页。
 */
function LoginPage() {
  const { login } = useAuth()
  const brand = useBranding()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const userRef = useRef(null)

  useEffect(() => {
    setPageTitle('登录')
    userRef.current?.focus()
  }, [])

  const from = location.state?.from && location.state.from !== '/login' ? location.state.from : '/'

  const submit = async event => {
    event.preventDefault()
    if (!form.username.trim()) { setError('请输入用户名'); return }
    if (!form.password) { setError('请输入密码'); return }
    setBusy(true)
    setError('')
    try {
      await login(form.username.trim(), form.password)
      navigate(from, { replace: true })
    } catch (submitError) {
      setError(submitError?.response?.data?.error || '登录失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <aside className="login-brand">
          <span className="login-brand-mark"><CloudDbIcon size={44} /></span>
          <h1>{brand.name}</h1>
          <p className="login-brand-sub">{brand.subtitle}</p>
          <ul className="login-brand-points">
            <li>询盘 → 报价 → PI → 采购，一条链路跑完</li>
            <li>产品与供应商统一目录，团队共享可参考</li>
            <li>汇率、英文大写金额、包装参数内置</li>
          </ul>
          <p className="login-brand-foot">v1 · 第一阶段</p>
        </aside>

        <form className="login-form" onSubmit={submit}>
          <header>
            <h2>账号登录</h2>
            <p className="login-hint"><UsersIcon size={14} /> 请使用组织分配给你的账号</p>
          </header>

          <div className="form-group">
            <label htmlFor="login-username">用户名</label>
            <input
              id="login-username"
              ref={userRef}
              type="text"
              autoComplete="username"
              value={form.username}
              onChange={event => setForm(current => ({ ...current, username: event.target.value }))}
              placeholder="请输入用户名"
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">密码</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={event => setForm(current => ({ ...current, password: event.target.value }))}
              placeholder="请输入密码"
            />
          </div>

          {error && <p className="form-error login-error">{error}</p>}

          <button type="submit" className="btn btn-primary login-submit" disabled={busy}>
            {busy ? '登录中…' : '登 录'}
          </button>

          <p className="login-tip">首次使用默认账号 <code>admin</code>，登录后请在「个人资料」里修改密码。</p>
        </form>
      </div>
      <p className="login-copyright">{brand.name} · 外贸供应链管理系统</p>
    </div>
  )
}

export default LoginPage
