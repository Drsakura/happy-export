import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { ShieldIcon, PlusIcon, TrashIcon, SaveIcon } from '../components/Icons'
import { useAuth } from '../auth'
import { setPageTitle } from '../branding'

/**
 * 权限组管理。
 *
 * 口径：角色（董事长/总经理/销售经理/销售业务员）只是职位标签，本身不带权限。
 * 权限组的「权限范围」勾选决定了能访问哪些模块；把角色指派进组，该角色下的用户即生效。
 * 一个角色同一时间只能属于一个组 —— 所以角色复选框是互斥语义，勾到别的组会把它移过来。
 */
function PermissionGroups() {
  const { refresh } = useAuth()
  const [groups, setGroups] = useState([])
  const [catalog, setCatalog] = useState({ groups: [], roles: [] })
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  const load = async (keepId) => {
    const [groupRes, catalogRes] = await Promise.all([
      axios.get('/api/permission-groups'),
      axios.get('/api/permissions')
    ])
    const list = groupRes.data.groups || []
    setGroups(list)
    setCatalog({ groups: catalogRes.data.groups || [], roles: catalogRes.data.roles || [] })
    const target = keepId ?? selectedId
    const pick = list.find(item => item.id === target) || list[0] || null
    setSelectedId(pick?.id ?? null)
    setDraft(pick ? { ...pick, permissions: [...pick.permissions], roles: [...pick.roles] } : null)
    return list
  }

  useEffect(() => {
    setPageTitle('权限组管理')
    load().catch(() => setNotice({ type: 'error', text: '加载权限组失败' })).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const roleGroupMap = useMemo(() => {
    const map = new Map()
    for (const group of groups) {
      for (const role of group.roles) map.set(role, group.id)
    }
    return map
  }, [groups])

  const select = id => {
    const target = groups.find(item => item.id === id)
    if (!target) return
    setSelectedId(id)
    setDraft({ ...target, permissions: [...target.permissions], roles: [...target.roles] })
    setNotice(null)
  }

  const togglePermission = key => {
    setDraft(current => {
      const has = current.permissions.includes(key)
      return {
        ...current,
        permissions: has ? current.permissions.filter(item => item !== key) : [...current.permissions, key]
      }
    })
  }

  const toggleModulePermissions = (moduleGroups, checked) => {
    const keys = moduleGroups.items.map(item => item.key)
    setDraft(current => ({
      ...current,
      permissions: checked
        ? [...new Set([...current.permissions, ...keys])]
        : current.permissions.filter(item => !keys.includes(item))
    }))
  }

  const toggleRole = role => {
    setDraft(current => {
      const has = current.roles.includes(role)
      return { ...current, roles: has ? current.roles.filter(item => item !== role) : [...current.roles, role] }
    })
  }

  const save = async () => {
    if (!draft) return
    if (!draft.name.trim()) { setNotice({ type: 'error', text: '权限组名称不能为空' }); return }
    setBusy(true)
    setNotice(null)
    try {
      const { data } = await axios.patch(`/api/permission-groups/${draft.id}`, {
        name: draft.name.trim(),
        description: draft.description,
        permissions: draft.permissions,
        roles: draft.roles
      })
      await load(data.group.id)
      await refresh()          /* 可能改到了自己的角色所属组，刷新自身权限 */
      setNotice({ type: 'ok', text: '权限组已保存' })
    } catch (error) {
      setNotice({ type: 'error', text: error?.response?.data?.error || '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  const createGroup = async () => {
    const name = window.prompt('新权限组名称', '新权限组')
    if (name === null) return
    if (!name.trim()) return
    setBusy(true)
    try {
      const { data } = await axios.post('/api/permission-groups', {
        name: name.trim(),
        description: '',
        permissions: ['dashboard.view'],
        roles: []
      })
      await load(data.group.id)
      setNotice({ type: 'ok', text: `权限组「${data.group.name}」已创建` })
    } catch (error) {
      setNotice({ type: 'error', text: error?.response?.data?.error || '创建失败' })
    } finally {
      setBusy(false)
    }
  }

  const removeGroup = async () => {
    if (!draft) return
    if (!window.confirm(`确定删除权限组「${draft.name}」？该操作不可撤销。`)) return
    setBusy(true)
    try {
      await axios.delete(`/api/permission-groups/${draft.id}`)
      await load(null)
      setNotice({ type: 'ok', text: '权限组已删除' })
    } catch (error) {
      setNotice({ type: 'error', text: error?.response?.data?.error || '删除失败' })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="page-container"><p className="muted-note">正在加载权限组…</p></div>

  return (
    <div className="page-container perm-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">权限组管理</h1>
          <p className="page-subtitle">
            角色只是职位标签；把角色放进某个权限组，它就获得该组勾选的权限范围。一个角色同时只能属于一个组。
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={createGroup} disabled={busy}>
          <PlusIcon size={15} /> 新建权限组
        </button>
      </div>

      {notice && <p className={`profile-notice ${notice.type}`}>{notice.text}</p>}

      <div className="perm-layout">
        {/* ---------------- 左：组列表 ---------------- */}
        <aside className="perm-list panel">
          <div className="panel-title">权限组（{groups.length}）</div>
          {groups.map(group => (
            <button
              key={group.id}
              type="button"
              className={`perm-list-item${group.id === selectedId ? ' active' : ''}`}
              onClick={() => select(group.id)}
            >
              <span className="perm-list-name">
                <ShieldIcon size={14} /> {group.name}
                {group.is_system ? <i className="perm-tag">系统</i> : null}
              </span>
              <span className="perm-list-meta">
                {group.permissions.length} 项权限 · {group.roles.length} 个角色
              </span>
            </button>
          ))}
        </aside>

        {/* ---------------- 右：编辑区 ---------------- */}
        <section className="panel perm-editor">
          {!draft ? (
            <p className="muted-note">左侧选择一个权限组，或新建一个。</p>
          ) : (
            <>
              <div className="panel-title">
                {draft.name}
                {draft.is_system ? <i className="perm-tag">系统内置 · 不可删除</i> : null}
              </div>

              <div className="perm-basic">
                <div className="form-group">
                  <label>名称</label>
                  <input type="text" value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
                </div>
                <div className="form-group">
                  <label>说明</label>
                  <input type="text" value={draft.description} placeholder="这个组大致管什么" onChange={event => setDraft({ ...draft, description: event.target.value })} />
                </div>
              </div>

              <div className="perm-section-title">权限范围</div>
              <div className="perm-modules">
                {catalog.groups.map(module => {
                  const keys = module.items.map(item => item.key)
                  const checkedCount = keys.filter(key => draft.permissions.includes(key)).length
                  const allChecked = checkedCount === keys.length
                  return (
                    <div className="perm-module" key={module.title}>
                      <label className="perm-module-head">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={element => { if (element) element.indeterminate = checkedCount > 0 && !allChecked }}
                          onChange={event => toggleModulePermissions(module, event.target.checked)}
                        />
                        <b>{module.title}</b>
                        <span className="perm-module-count">{checkedCount}/{keys.length}</span>
                      </label>
                      <div className="perm-module-items">
                        {module.items.map(item => (
                          <label className="perm-item" key={item.key}>
                            <input
                              type="checkbox"
                              checked={draft.permissions.includes(item.key)}
                              onChange={() => togglePermission(item.key)}
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="perm-section-title">角色指派（放进本组的角色即获得上面的权限）</div>
              <div className="perm-roles">
                {catalog.roles.map(role => {
                  const owner = roleGroupMap.get(role.value)
                  const here = draft.roles.includes(role.value) || owner === draft.id
                  const elsewhere = owner && owner !== draft.id
                  const otherName = elsewhere ? groups.find(group => group.id === owner)?.name : null
                  return (
                    <label className={`perm-role${here ? ' checked' : ''}`} key={role.value}>
                      <input type="checkbox" checked={!!here} onChange={() => toggleRole(role.value)} />
                      <span>
                        <b>{role.label}</b>
                        {otherName ? <small>当前在「{otherName}」，勾选将改派到本组</small> : <small>{here ? '已属于本组' : '未指派'}</small>}
                      </span>
                    </label>
                  )
                })}
              </div>

              <div className="perm-actions">
                <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
                  <SaveIcon size={15} /> {busy ? '保存中…' : '保存权限组'}
                </button>
                {!draft.is_system && (
                  <button type="button" className="btn btn-danger" onClick={removeGroup} disabled={busy}>
                    <TrashIcon size={14} /> 删除该组
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default PermissionGroups
