import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  SaveIcon, KeyIcon, CameraIcon, LogoutIcon, BuildingIcon, ShieldIcon,
  EyeIcon, EyeOffIcon, UserIcon
} from '../components/Icons'
import { useAuth, roleLabel } from '../auth'
import { setPageTitle } from '../branding'
import { setUnsavedGuard, clearUnsavedGuard } from '../unsavedGuard'

/* 把用户对象裁成表单结构 */
function toForm(user) {
  return {
    display_name: user?.display_name || '',
    position: user?.position || '',
    email: user?.email || '',
    phone: user?.phone || '',
    address: user?.address || '',
    org_id: user?.org?.id ? String(user.org.id) : '',
    role: user?.role || 'sales_rep',
    avatar: user?.avatar || ''
  }
}

/** 头像压到 160×160 的 JPEG，直接存 dataURL —— 本地阶段省掉一套文件接口与存储 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('这个图片格式浏览器读不了'))
      image.onload = () => {
        const size = 160
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext('2d')
        const scale = Math.max(size / image.width, size / image.height)
        const width = image.width * scale
        const height = image.height * scale
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      image.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function ProfilePage() {
  const { user, setUser, logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState(() => toForm(user))
  const [saved, setSaved] = useState(() => toForm(user))
  const [organizations, setOrganizations] = useState([])
  const [roles, setRoles] = useState([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const fileRef = useRef(null)

  const [password, setPassword] = useState({ current: '', next: '', confirm: '' })
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordNotice, setPasswordNotice] = useState(null)
  const [reveal, setReveal] = useState({ current: false, next: false, confirm: false })

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(saved),
    [form, saved]
  )

  /* guard 要读到最新值，用 ref 兜住（注册只在挂载/卸载时做一次） */
  const dirtyRef = useRef(dirty)
  const formRef = useRef(form)
  const savedRef = useRef(saved)
  dirtyRef.current = dirty
  formRef.current = form
  savedRef.current = saved

  useEffect(() => {
    setPageTitle('个人资料')
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [orgRes, roleRes] = await Promise.all([
          axios.get('/api/organizations'),
          axios.get('/api/roles')
        ])
        if (!alive) return
        setOrganizations(orgRes.data.organizations || [])
        setRoles(roleRes.data.roles || [])
      } catch { /* 下拉拉不到不影响主流程 */ }
    })()
    return () => { alive = false }
  }, [])

  /* 保存动作抽成 callback，供页面按钮与「离开前保存」共用 */
  const submitSave = useCallback(async () => {
    const payload = formRef.current
    const response = await axios.patch('/api/me', {
      display_name: payload.display_name,
      position: payload.position,
      email: payload.email,
      phone: payload.phone,
      address: payload.address,
      avatar: payload.avatar,
      role: payload.role,
      org_id: payload.org_id === '' ? undefined : Number(payload.org_id)
    })
    const updated = response.data.user
    setUser(updated)
    setSaved(toForm(updated))
    return updated
  }, [setUser])

  /* 让外壳在跳转前能问一句「要不要先保存」 */
  useEffect(() => {
    setUnsavedGuard({
      isDirty: () => dirtyRef.current,
      save: () => submitSave(),
      discard: () => setForm(savedRef.current)
    })
    return () => clearUnsavedGuard()
  }, [submitSave])

  const save = async () => {
    if (!form.display_name.trim()) { setNotice({ type: 'error', text: '显示名不能为空' }); return }
    setBusy(true)
    setNotice(null)
    try {
      await submitSave()
      setNotice({ type: 'ok', text: '个人资料已保存' })
    } catch (error) {
      setNotice({ type: 'error', text: error?.response?.data?.error || '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  const pickAvatar = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/^image\//.test(file.type)) { setNotice({ type: 'error', text: '请选择图片文件' }); return }
    try {
      const dataUrl = await compressImage(file)
      setForm(current => ({ ...current, avatar: dataUrl }))
      setNotice({ type: 'info', text: '头像已选择，记得点右上角「保存个人资料」' })
    } catch (error) {
      setNotice({ type: 'error', text: error.message })
    }
  }

  const submitPassword = async event => {
    event.preventDefault()
    if (!password.current) { setPasswordNotice({ type: 'error', text: '请输入当前密码' }); return }
    if (!password.next) { setPasswordNotice({ type: 'error', text: '请输入新密码' }); return }
    if (password.next.length < 6) { setPasswordNotice({ type: 'error', text: '新密码至少 6 位' }); return }
    if (password.next !== password.confirm) { setPasswordNotice({ type: 'error', text: '两次输入的新密码不一致' }); return }
    setPasswordBusy(true)
    setPasswordNotice(null)
    try {
      await axios.patch('/api/me/password', {
        current_password: password.current,
        new_password: password.next,
        confirm_password: password.confirm
      })
      setPassword({ current: '', next: '', confirm: '' })
      setPasswordNotice({ type: 'ok', text: '密码已修改，其它设备上的登录已失效' })
    } catch (error) {
      setPasswordNotice({ type: 'error', text: error?.response?.data?.error || '修改密码失败' })
    } finally {
      setPasswordBusy(false)
    }
  }

  const signOut = async () => {
    if (dirty) setForm(saved)
    await logout()
    navigate('/login', { replace: true })
  }

  const setField = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const currentRole = roles.find(item => item.value === form.role)
  const orgName = organizations.find(item => String(item.id) === String(form.org_id))?.name || user?.org?.name || '—'
  const avatarText = (form.display_name || user?.username || '?').slice(0, 1).toUpperCase()

  return (
    <div className="page-container profile-page">
      <div className="profile-head">
        <div className="profile-head-left">
          <span className="profile-avatar">
            {form.avatar ? <img src={form.avatar} alt="" /> : avatarText}
          </span>
          <div className="profile-head-text">
            <h1>{form.display_name || user?.username}</h1>
            <p>{form.position || roleLabel(form.role)} · {orgName}</p>
          </div>
        </div>
        <div className="profile-head-actions">
          {dirty && <span className="profile-dirty-hint">● 有未保存的改动</span>}
          <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => { setForm(saved); setNotice(null) }}>
            放弃修改
          </button>
          <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
            <SaveIcon size={15} /> {busy ? '保存中…' : '保存个人资料'}
          </button>
        </div>
      </div>

      {notice && (
        <p className={`profile-notice ${notice.type}`}>{notice.text}</p>
      )}

      <div className="profile-grid">
        {/* ---------------- 基本资料 ---------------- */}
        <section className="panel">
          <div className="panel-title"><UserIcon size={15} /> 基本资料</div>

          <div className="profile-avatar-row">
            <span className="profile-avatar profile-avatar-sm">
              {form.avatar ? <img src={form.avatar} alt="" /> : avatarText}
            </span>
            <div className="profile-avatar-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                <CameraIcon size={14} /> 更换头像
              </button>
              {form.avatar && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setField('avatar', '')}>
                  移除
                </button>
              )}
              <p className="field-hint">支持 jpg / png，会自动裁成方形并压缩</p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
          </div>

          <div className="profile-fields">
            <div className="form-group">
              <label>显示名 <i className="required">*</i></label>
              <input type="text" value={form.display_name} onChange={event => setField('display_name', event.target.value)} placeholder="在系统里显示的名字" />
            </div>
            <div className="form-group">
              <label>职位</label>
              <input type="text" value={form.position} onChange={event => setField('position', event.target.value)} placeholder="如：外贸业务主管" />
            </div>
            <div className="form-group">
              <label>联系邮箱</label>
              <input type="email" value={form.email} onChange={event => setField('email', event.target.value)} placeholder="name@company.com" />
            </div>
            <div className="form-group">
              <label>电话</label>
              <input type="text" value={form.phone} onChange={event => setField('phone', event.target.value)} placeholder="手机或座机" />
            </div>
            <div className="form-group">
              <label><BuildingIcon size={13} /> 所属组织</label>
              <select value={form.org_id} onChange={event => setField('org_id', event.target.value)}>
                <option value="">未归属</option>
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>{org.name}{org.member_count ? `（${org.member_count} 人）` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label><ShieldIcon size={13} /> 权限角色</label>
              <select value={form.role} onChange={event => setField('role', event.target.value)}>
                {roles.map(role => (
                  <option key={role.value} value={role.value}>{role.label}</option>
                ))}
              </select>
              <p className="field-hint">
                角色本身不带权限，它决定你进入哪个权限组 →
                <b> {currentRole?.group_name || '尚未指派权限组'}</b>
              </p>
            </div>
            <div className="form-group profile-field-full">
              <label>地址</label>
              <textarea rows="2" value={form.address} onChange={event => setField('address', event.target.value)} placeholder="公司或办公地址" />
            </div>
          </div>

          <div className="profile-meta">
            <span>账号：<b>{user?.username}</b></span>
            <span>权限组：<b>{user?.permission_group?.name || '—'}</b></span>
            <span>可访问权限点：<b>{user?.permissions?.length || 0}</b></span>
            <span>上次登录：<b>{user?.last_login_at ? new Date(user.last_login_at).toLocaleString('zh-CN') : '—'}</b></span>
          </div>
        </section>

        {/* ---------------- 修改密码 ---------------- */}
        <section className="panel">
          <div className="panel-title"><KeyIcon size={15} /> 修改密码</div>
          <form className="profile-fields profile-fields-single" onSubmit={submitPassword}>
            {[
              ['current', '当前密码', '请输入当前密码'],
              ['next', '新密码', '至少 6 位'],
              ['confirm', '再次输入新密码', '与上面保持一致']
            ].map(([key, label, placeholder]) => (
              <div className="form-group" key={key}>
                <label>{label}</label>
                <div className="password-input">
                  <input
                    type={reveal[key] ? 'text' : 'password'}
                    autoComplete={key === 'current' ? 'current-password' : 'new-password'}
                    value={password[key]}
                    onChange={event => setPassword(current => ({ ...current, [key]: event.target.value }))}
                    placeholder={placeholder}
                  />
                  <button
                    type="button"
                    className="password-reveal"
                    onClick={() => setReveal(current => ({ ...current, [key]: !current[key] }))}
                    title={reveal[key] ? '隐藏' : '显示'}
                    aria-label={reveal[key] ? '隐藏密码' : '显示密码'}
                  >
                    {reveal[key] ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                  </button>
                </div>
              </div>
            ))}

            {passwordNotice && <p className={`profile-notice ${passwordNotice.type}`}>{passwordNotice.text}</p>}

            <button type="submit" className="btn btn-primary" disabled={passwordBusy}>
              <KeyIcon size={15} /> {passwordBusy ? '提交中…' : '确认修改密码'}
            </button>
            <p className="field-hint">改密码需要当前密码验证；修改成功后其它设备上的登录会被强制退出。</p>
          </form>

          <div className="profile-signout">
            <button type="button" className="btn btn-secondary" onClick={signOut}>
              <LogoutIcon size={15} /> 退出登录
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

export default ProfilePage
