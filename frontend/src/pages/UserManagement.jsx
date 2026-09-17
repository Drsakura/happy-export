import React, { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { UserIcon, PlusIcon, RefreshIcon, SaveIcon } from '../components/Icons'
import { SkeletonTableRows } from '../components/Skeleton'
import { useAuth } from '../auth'
import { setPageTitle } from '../branding'

/**
 * 用户管理（user.manage）。
 *
 * 口径（与权限组管理同一套推导）：
 *   - 角色只是职位标签 + 授权键；用户填角色，角色被指派进某个权限组，即获得该组权限。
 *   - 所以「改用户角色」就是换权限的唯一入口，页面上要把「该角色现在落在哪个组」亮出来，
 *     免得管理员改完角色还以为权限没生效。
 *   - 停用/改密会踢掉该用户已有会话（后端做），管理员自己的会话保留。
 */

const EMPTY_NEW = {
  username: '',
  display_name: '',
  password: '',
  role: 'sales_rep',
  org_id: '',
  position: '',
  email: ''
}

function fmtDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function UserManagement() {
  const { user: me, refresh } = useAuth()
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ ...EMPTY_NEW })
  const [createError, setCreateError] = useState('')
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editError, setEditError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, rolesRes, orgsRes] = await Promise.all([
        axios.get('/api/users'),
        axios.get('/api/roles'),
        axios.get('/api/organizations')
      ])
      setUsers(usersRes.data.users || [])
      setRoles(rolesRes.data.roles || [])
      setOrgs(orgsRes.data.organizations || [])
    } catch (error) {
      setNotice({ type: 'error', text: error?.response?.data?.error || '加载用户列表失败' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setPageTitle('用户管理')
    load()
  }, [load])

  const roleLabel = useCallback(value => (
    roles.find(item => item.value === value)?.label || value || '—'
  ), [roles])

  const activeCount = useMemo(() => users.filter(item => item.is_active).length, [users])

  /* ---------------- 新建 ---------------- */
  const submitCreate = async (event) => {
    event.preventDefault()
    if (!createForm.username.trim() || !createForm.password) {
      setCreateError('账号和初始密码必填')
      return
    }
    setBusy(true)
    setCreateError('')
    try {
      const { data } = await axios.post('/api/users', {
        ...createForm,
        org_id: createForm.org_id === '' ? null : Number(createForm.org_id)
      })
      setNotice({ type: 'ok', text: `用户「${data.user.username}」已创建，可交由对方登录后自行改密` })
      setShowCreate(false)
      setCreateForm({ ...EMPTY_NEW })
      await load()
    } catch (error) {
      setCreateError(error?.response?.data?.error || '创建失败')
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- 编辑 ---------------- */
  const openEdit = (row) => {
    setEditing(row)
    setEditError('')
    setEditForm({
      display_name: row.display_name || '',
      position: row.position || '',
      email: row.email || '',
      phone: row.phone || '',
      role: row.role,
      org_id: row.org_id ?? ''
    })
  }

  const submitEdit = async (event) => {
    event.preventDefault()
    if (!editing) return
    setBusy(true)
    setEditError('')
    try {
      await axios.patch(`/api/users/${editing.id}`, {
        ...editForm,
        org_id: editForm.org_id === '' ? null : Number(editForm.org_id)
      })
      setNotice({ type: 'ok', text: `「${editing.username}」的资料已保存` })
      setEditing(null)
      await load()
      if (editing.id === me.id) await refresh()   /* 改到自己身上时刷新自身权限显示 */
    } catch (error) {
      setEditError(error?.response?.data?.error || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- 重置密码 / 停用 ---------------- */
  const resetPassword = async (row) => {
    const password = window.prompt(`给「${row.username}」设置新密码（至少 6 位）：`)
    if (password === null) return
    if (password.length < 6) {
      setNotice({ type: 'error', text: '密码至少 6 位，未做修改' })
      return
    }
    setBusy(true)
    try {
      await axios.patch(`/api/users/${row.id}`, { password })
      setNotice({ type: 'ok', text: `「${row.username}」的密码已重置，对方旧登录态已失效` })
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error?.response?.data?.error || '重置失败' })
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (row) => {
    const next = !row.is_active
    const ok = window.confirm(
      next
        ? `启用「${row.username}」？启用后对方即可正常登录。`
        : `停用「${row.username}」？停用后对方立即掉线、无法登录，客户等数据保留。`
    )
    if (!ok) return
    setBusy(true)
    try {
      await axios.patch(`/api/users/${row.id}`, { is_active: next })
      setNotice({ type: 'ok', text: `「${row.username}」已${next ? '启用' : '停用'}` })
      await load()
    } catch (error) {
      setNotice({ type: 'error', text: error?.response?.data?.error || '操作失败' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-container user-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">用户管理</h1>
          <p className="page-subtitle">
            账号的增删改都在这里。角色决定权限（角色 → 权限组的推导见「权限组管理」），
            停用会立即把对方踢下线。共 {users.length} 个账号，{activeCount} 个启用中。
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={load} disabled={busy}>
            <RefreshIcon size={14} /> 刷新
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { setShowCreate(true); setCreateError('') }} disabled={busy}>
            <PlusIcon size={14} /> 新建用户
          </button>
        </div>
      </div>

      {notice && <p className={`profile-notice ${notice.type}`}>{notice.text}</p>}

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>账号 / 姓名</th>
              <th>角色</th>
              <th>权限组</th>
              <th>组织</th>
              <th>最近登录</th>
              <th>状态</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonTableRows rows={4} widths={[1.8, 1, 1, 1, 1, 0.7, 1.6]} />
            ) : users.length === 0 ? (
              <tr><td colSpan="7" className="empty-state">还没有用户</td></tr>
            ) : users.map(row => {
              const isSelf = row.id === me.id
              return (
                <tr key={row.id} className={row.is_active ? '' : 'row-muted'}>
                  <td>
                    <strong>{row.username}</strong>
                    {isSelf && <span className="owner-self" style={{ marginLeft: 6 }}>我</span>}
                    <div className="muted-note">
                      {row.display_name || '—'}
                      {row.position ? ` · ${row.position}` : ''}
                    </div>
                  </td>
                  <td>
                    <span className="owner-cell"><UserIcon size={11} /> {roleLabel(row.role)}</span>
                  </td>
                  <td>{row.permission_group_name || <span className="muted-note">该角色未指派组</span>}</td>
                  <td>{row.org_name || <span className="muted-note">未指定</span>}</td>
                  <td className="mono">{fmtDate(row.last_login_at)}</td>
                  <td>
                    <span className={`pill ${row.is_active ? 'pill-ok' : 'pill-mute'}`}>
                      {row.is_active ? '启用' : '停用'}
                    </span>
                  </td>
                  <td className="col-actions">
                    <button type="button" className="btn-link" onClick={() => openEdit(row)}>编辑</button>
                    <button type="button" className="btn-link" disabled={busy} onClick={() => resetPassword(row)}>重置密码</button>
                    {!isSelf && (
                      <button type="button" className="btn-link" disabled={busy} onClick={() => toggleActive(row)}>
                        {row.is_active ? '停用' : '启用'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ---------------- 新建用户 ---------------- */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => !busy && setShowCreate(false)}>
          <div className="modal-content" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2>新建用户</h2>
              <button type="button" className="icon-btn" onClick={() => setShowCreate(false)} aria-label="关闭">×</button>
            </div>
            <form onSubmit={submitCreate}>
              <div className="form-row">
                <div className="form-group">
                  <label>登录账号 *</label>
                  <input
                    type="text" value={createForm.username} autoFocus
                    placeholder="字母/数字，如 zhangsan"
                    onChange={event => setCreateForm({ ...createForm, username: event.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>姓名</label>
                  <input
                    type="text" value={createForm.display_name}
                    placeholder="对外显示的名字"
                    onChange={event => setCreateForm({ ...createForm, display_name: event.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>初始密码 *</label>
                  <input
                    type="text" value={createForm.password}
                    placeholder="至少 6 位，交给对方后自行修改"
                    onChange={event => setCreateForm({ ...createForm, password: event.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>角色（决定权限）</label>
                  <select
                    value={createForm.role}
                    onChange={event => setCreateForm({ ...createForm, role: event.target.value })}
                  >
                    {roles.map(item => (
                      <option key={item.value} value={item.value}>
                        {item.label}{item.group_name ? `（${item.group_name}）` : '（未指派组）'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>所属组织</label>
                  <select
                    value={createForm.org_id}
                    onChange={event => setCreateForm({ ...createForm, org_id: event.target.value })}
                  >
                    <option value="">未指定</option>
                    {orgs.map(org => <option key={org.id} value={String(org.id)}>{org.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>职位（对外称谓）</label>
                  <input
                    type="text" value={createForm.position}
                    placeholder="如：外贸业务员"
                    onChange={event => setCreateForm({ ...createForm, position: event.target.value })}
                  />
                </div>
              </div>
              {createError && <p className="form-error">{createError}</p>}
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)} disabled={busy}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <SaveIcon size={14} /> {busy ? '创建中…' : '创建用户'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- 编辑用户 ---------------- */}
      {editing && editForm && (
        <div className="modal-overlay" onClick={() => !busy && setEditing(null)}>
          <div className="modal-content" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h2>编辑「{editing.username}」</h2>
              <button type="button" className="icon-btn" onClick={() => setEditing(null)} aria-label="关闭">×</button>
            </div>
            <form onSubmit={submitEdit}>
              <div className="form-row">
                <div className="form-group">
                  <label>姓名</label>
                  <input
                    type="text" value={editForm.display_name}
                    onChange={event => setEditForm({ ...editForm, display_name: event.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>职位</label>
                  <input
                    type="text" value={editForm.position}
                    onChange={event => setEditForm({ ...editForm, position: event.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>角色（决定权限）</label>
                  <select
                    value={editForm.role}
                    disabled={editing.id === me.id}
                    title={editing.id === me.id ? '不能修改自己的角色' : ''}
                    onChange={event => setEditForm({ ...editForm, role: event.target.value })}
                  >
                    {roles.map(item => (
                      <option key={item.value} value={item.value}>
                        {item.label}{item.group_name ? `（${item.group_name}）` : '（未指派组）'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>所属组织</label>
                  <select
                    value={editForm.org_id === null ? '' : editForm.org_id}
                    onChange={event => setEditForm({ ...editForm, org_id: event.target.value })}
                  >
                    <option value="">未指定</option>
                    {orgs.map(org => <option key={org.id} value={String(org.id)}>{org.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>邮箱</label>
                  <input
                    type="text" value={editForm.email}
                    onChange={event => setEditForm({ ...editForm, email: event.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>电话</label>
                  <input
                    type="text" value={editForm.phone}
                    onChange={event => setEditForm({ ...editForm, phone: event.target.value })}
                  />
                </div>
              </div>
              {editError && <p className="form-error">{editError}</p>}
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={busy}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <SaveIcon size={14} /> {busy ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default UserManagement
