import { useEffect, useRef } from 'react'

/**
 * 把「浮层 / 编辑态」接入浏览器历史。
 *
 * 解决什么问题：Chrome / Edge 的**鼠标侧键（后退键）、Alt + ←、触控板双指横滑、
 * 系统的返回手势**走的都是浏览器历史（history.back），不是页面里的按钮。
 * 所以只要把浮层状态压进历史，这些操作就天然能"退回上一层"，
 * 不需要去单独做鼠标按键识别（浏览器也不会把侧键事件交给页面）。
 *
 * 两个关键设计（改之前务必读懂，否则很容易踩出"按几次返回直接退出应用"）：
 *
 * 1. **关闭动作一律走历史，状态只由 popstate 回写。**
 *    不写"点了 X 就 setState(null)"，而是"点了 X 就 history.go(-n)"，
 *    由 popstate 统一把状态改成已关闭。这样不需要在内存里维护"层数栈"，
 *    React 18 StrictMode 的双挂载、快速连点都不会让内存栈和真实历史错位。
 *
 * 2. **层数用「随组件存活的活计数」，不读历史里的计数器。**
 *    历史里可能留着上一次挂载的孤儿条目：用户开着抽屉直接点侧栏跳到别的页面，
 *    抽屉会随组件卸载而消失，但压进去的历史条目还在。如果层数从历史里读，
 *    下次回到本页就会读到 2 这种脏值，关抽屉时 go(-2) 会多退几条、直接退出应用。
 *    所以层数由页面自己按当前 UI 状态算（见 ProductManagement 的 layerCount）。
 *
 *    配套地，每条历史条目都带上**本次挂载的令牌**（mountId）。
 *    读到令牌对不上的条目（上一次挂载留下的孤儿）一律当作"本层已关闭"，
 *    这样不会冒出幽灵抽屉。
 */

/** 本次挂载的令牌。每次挂载生成一个新的，用来把上一次挂载的孤儿条目认出来 */
export function makeMountId() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** 当前历史条目是不是本次挂载压进去的层 */
function isOwnLayer(mountId) {
  const s = window.history.state
  return !!(s && s.__tmsMount === mountId && typeof s.__tmsDepth === 'number' && s.__tmsDepth > 0)
}

/**
 * 打开一层：压一条历史，把「返回后该恢复成什么」存进这条历史本身。
 * @param {string} mountId  本次挂载的令牌
 * @param {string} key      本层的键名（读回来时用它取值，各层用各自的键就不会串）
 * @param {object} snapshot 本层快照，`null` 表示"已关闭"
 */
export function pushLayer(mountId, key, snapshot) {
  const cur = window.history.state
  const depth = cur && cur.__tmsMount === mountId && typeof cur.__tmsDepth === 'number'
    ? cur.__tmsDepth
    : 0
  window.history.pushState({ __tmsMount: mountId, __tmsDepth: depth + 1, [key]: snapshot }, '')
}

/**
 * 只退一层 —— 给「返回上一层」按钮用（与鼠标侧键效果完全一致）。
 * @returns {boolean} 是否真的走了历史；false 表示当前没有本页的层，调用方自己兜底收起
 */
export function goBackOne(mountId) {
  if (!isOwnLayer(mountId)) return false
  window.history.back()
  return true
}

/**
 * 一次退掉 n 层，回到这些层之前那条历史。
 * go(-n) 只会触发**一次** popstate（带着最终条目的 state），所以中间那层不会各自响应。
 */
export function popLayers(n) {
  if (n > 0) window.history.go(-n)
}

/**
 * 监听浏览器返回，把本层状态回写回来。
 *
 * @param {string} mountId  本次挂载的令牌；读到的条目令牌对不上就当作本层已关闭
 * @param {string} key      本层的键名；历史条目里读不到这个键 = 本层已关闭
 * @param {function} onState 收到快照（或 null）后恢复 UI 状态
 * @param {string} [guardPath] 只在当前路径等于它时才响应。
 *        用户开着抽屉直接点侧栏跳到别的页面时，历史里还留着我们的条目；
 *        这时往回退不应该在产品页之外乱动抽屉。
 */
export function useLayerRestore(mountId, key, onState, guardPath) {
  const onStateRef = useRef(onState)
  onStateRef.current = onState
  const guardRef = useRef(guardPath ?? window.location.pathname)
  if (guardPath) guardRef.current = guardPath

  useEffect(() => {
    const onPop = () => {
      // 已经离开本页：交给路由自己处理，别去动本页的浮层状态
      if (window.location.pathname !== guardRef.current) return
      const s = window.history.state
      const alive = s && s.__tmsMount === mountId && typeof s.__tmsDepth === 'number'
      onStateRef.current(alive ? (s[key] ?? null) : null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [mountId, key])
}
