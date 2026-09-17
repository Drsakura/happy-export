import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import axios from 'axios'

/**
 * 会话上下文：全局唯一的「当前用户是谁」答案来源。
 *
 * 为什么不把用户信息塞进 localStorage：
 * 改了个人资料 / 换了角色之后，前端必须立刻拿到新值。所以只依赖后端的会话 cookie，
 * 启动时打一次 /api/auth/me，之后由各处的 setUser / refresh 回写。
 */
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  /* 启动时确定登录态 */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data } = await axios.get('/api/auth/me')
        if (alive) setUser(data?.user || null)
      } catch {
        if (alive) setUser(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  /* 任何接口返回 401（会话过期 / 被踢），就地清空登录态，界面自然回登录页 */
  useEffect(() => {
    const id = axios.interceptors.response.use(
      response => response,
      error => {
        const status = error?.response?.status
        const url = String(error?.config?.url || '')
        const isAuthProbe = url.includes('/api/auth/login') || url.includes('/api/auth/me')
        if (status === 401 && !isAuthProbe) setUser(null)
        return Promise.reject(error)
      }
    )
    return () => axios.interceptors.response.eject(id)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/auth/me')
      setUser(data?.user || null)
      return data?.user || null
    } catch {
      setUser(null)
      return null
    }
  }, [])

  const login = useCallback(async (username, password) => {
    const { data } = await axios.post('/api/auth/login', { username, password })
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await axios.post('/api/auth/logout')
    } catch { /* 会话可能已过期，忽略 */ }
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh, setUser }),
    [user, loading, login, logout, refresh]
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用')
  return context
}

/** 权限判断：系统管理员兜底全通过，其余按角色所属权限组的权限点判断 */
export function hasPermission(user, key) {
  if (!user) return false
  if (user.role === 'admin') return true
  return Array.isArray(user.permissions) && user.permissions.includes(key)
}

/** 角色英文值 → 中文标签 */
export const ROLE_LABELS = {
  admin: '系统管理员',
  chairman: '董事长',
  general_manager: '总经理',
  sales_manager: '销售经理',
  sales_rep: '销售业务员'
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role || '—'
}
