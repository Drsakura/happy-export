import React, { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { CheckIcon, CloseIcon, RefreshIcon, SaveIcon, UsersIcon } from './Icons'

/**
 * 组织与品牌 —— 只管「公司 / 组织」这块**可改**的业务信息。
 *
 * 界面上的系统名（登录页、顶栏、浏览器标题）是作者固定署名，由后端
 * `lib/branding.js` 提供：设置页不展示、也没有修改入口，改公司名也不会顶掉它。
 * （Wayne 明确要求设置页里不要出现系统标识展示与任何解释文字，别再往这加。）
 */
function OrgBrandingSettings() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [orgs, setOrgs] = useState([])
  const [orgDraft, setOrgDraft] = useState({})
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await axios.get('/api/organizations')
      const list = data?.organizations || []
      setOrgs(list)
      const draft = {}
      for (const org of list) {
        draft[org.id] = { name: org.name || '', code: org.code || '', description: org.description || '' }
      }
      setOrgDraft(draft)
      setError('')
    } catch (err) {
      setError(err?.response?.data?.error || '读取组织信息失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const flash = (text) => {
    setNotice(text)
    window.setTimeout(() => setNotice(''), 3500)
  }

  const saveOrg = async (id) => {
    setBusy(`org:${id}`)
    try {
      const { data } = await axios.patch(`/api/organizations/${id}`, orgDraft[id])
      setOrgs(current => current.map(org => (org.id === id ? { ...org, ...data.organization } : org)))
      flash(`公司名已改为「${data.organization.name}」`)
    } catch (err) {
      setError(err?.response?.data?.error || '保存组织信息失败')
    } finally {
      setBusy('')
    }
  }

  if (loading) {
    return (
      <div className="settings-section">
        <h3>组织与品牌</h3>
        <p className="settings-description">正在读取组织信息…</p>
      </div>
    )
  }

  return (
    <div className="settings-section">
      <h3>组织与品牌</h3>
      <p className="settings-description">
        公司名可以随时改；界面上的系统名由作者固定署名，不随公司名变化。
      </p>

      {notice && <p className="ai-banner is-ok"><CheckIcon size={14} /> {notice}</p>}
      {error && <p className="ai-banner is-error"><CloseIcon size={14} /> {error}</p>}

      <div className="settings-group">
        <div className="ai-group-head">
          <h4>公司 / 组织</h4>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={Boolean(busy)}>
            <RefreshIcon size={14} /> 刷新
          </button>
        </div>
        <p className="help-text">
          <UsersIcon size={13} /> 同事归属哪个组织，就与同组织成员共享客户公海与产品库。
        </p>
        {orgs.length === 0 && <p className="help-text">还没有组织记录。</p>}
        {orgs.map(org => (
          <div className="org-card" key={org.id}>
            <div className="form-row">
              <div className="form-group">
                <label>组织名称</label>
                <input
                  type="text"
                  value={orgDraft[org.id]?.name ?? ''}
                  onChange={event => setOrgDraft(current => ({
                    ...current,
                    [org.id]: { ...current[org.id], name: event.target.value }
                  }))}
                />
              </div>
              <div className="form-group">
                <label>英文代码</label>
                <input
                  type="text"
                  value={orgDraft[org.id]?.code ?? ''}
                  onChange={event => setOrgDraft(current => ({
                    ...current,
                    [org.id]: { ...current[org.id], code: event.target.value }
                  }))}
                  placeholder="例如 HAPPY"
                />
              </div>
            </div>
            <div className="form-group">
              <label>描述</label>
              <input
                type="text"
                value={orgDraft[org.id]?.description ?? ''}
                onChange={event => setOrgDraft(current => ({
                  ...current,
                  [org.id]: { ...current[org.id], description: event.target.value }
                }))}
                placeholder="这行说明会显示在权限组/用户的组织下拉里"
              />
            </div>
            <div className="org-card-foot">
              <span className="help-text">{org.member_count || 0} 名成员</span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => saveOrg(org.id)}
                disabled={Boolean(busy) || orgDraft[org.id]?.name === org.name}
              >
                <SaveIcon size={14} /> {busy === `org:${org.id}` ? '保存中…' : '保存公司信息'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default OrgBrandingSettings
