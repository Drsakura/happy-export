import { useEffect, useState } from 'react'
import axios from 'axios'

/**
 * 系统标识与公司名 —— 全局唯一来源。
 *
 * 口径（Wayne 2026-09-15 定）：
 *   - **系统名固定不可改**：`name` / `subtitle` 恒为后端给的固定署名，
 *     登录页、顶栏、启动页、浏览器标题全用它，也**不跟随组织名**（引流用）。
 *   - **公司名（组织名）可改**：只在设置页与组织下拉里出现，不影响界面牌子。
 *
 * 用法：
 *   组件里      const brand = useBranding()   ← brand.name / brand.subtitle 是只读的
 *   设置页标题  setPageTitle('用户管理')      ← 页面别自己拼 document.title
 */

const FALLBACK = {
  name: 'happy出口通',
  subtitle: 'Ai Export System',
  system_locked: true,
  org_name: '',
  org_id: null
}

let state = { ...FALLBACK }
let currentPage = null
let loading = null
const listeners = new Set()

function emit() {
  for (const listener of listeners) {
    try { listener(state) } catch { /* 某个订阅者出错不该拖垮其他订阅者 */ }
  }
}

/** 页面标题统一在这里拼：品牌名变了，标题里的旧名也会跟着更新 */
export function setPageTitle(page) {
  currentPage = page || null
  document.title = currentPage ? `${currentPage} · ${state.name}` : state.name
}

export function getBranding() {
  return state
}

/** 保存成功后立刻套用，不用等下次刷新 */
export function applyBranding(patch) {
  state = { ...state, ...(patch || {}) }
  setPageTitle(currentPage)
  emit()
  return state
}

/** 启动时拉一次；失败就用兜底值（后端挂了也不该白屏） */
export function loadBranding() {
  if (loading) return loading
  loading = axios
    .get('/api/system/branding')
    .then(({ data }) => applyBranding(data))
    .catch(() => state)
  return loading
}

export function useBranding() {
  const [value, setValue] = useState(state)
  useEffect(() => {
    setValue(state)
    listeners.add(setValue)
    loadBranding()
    return () => listeners.delete(setValue)
  }, [])
  return value
}
