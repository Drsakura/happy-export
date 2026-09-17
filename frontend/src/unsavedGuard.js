/**
 * 全局「未保存改动」守卫。
 *
 * 为什么不用 react-router 的 useBlocker：它只在 data router（createBrowserRouter）下可用，
 * 本项目用的是 <BrowserRouter> + <Routes>，调它会直接抛错。所以这里用一个模块级单例：
 * 编辑页挂载时注册「我脏了吗 / 帮我存一下 / 帮我丢弃」，由外层外壳负责在跳转时询问。
 */
let active = null

export function setUnsavedGuard(guard) {
  active = guard
}
export function clearUnsavedGuard() {
  active = null
}
export function getUnsavedGuard() {
  return active
}
/** 是否处于「有未保存改动」状态（没有编辑页时恒为 false） */
export function isGuardDirty() {
  try {
    return !!(active && active.isDirty())
  } catch {
    return false
  }
}
