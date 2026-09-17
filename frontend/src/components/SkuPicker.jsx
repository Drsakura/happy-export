import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { SearchIcon, PackageIcon, CloseIcon, ChevronDownIcon } from './Icons'
import { SkuThumb, useSkuThumbs } from './SkuThumb'

/**
 * SKU 选择器
 *
 * 数据来自 happy 后端自己的 /api/sku（SKU 模块已并入），不直连端口。搜索返回的是「产品组」，
 * 点开产品组再看到具体货号 —— 这是 SKU 服务本来的数据结构，硬拍平成一张 SKU 列表
 * 会丢掉归属关系，业务上分不清同一个产品的不同规格。
 *
 * 同时允许直接输入完整货号回车选中：老手知道自己要哪个货号时不该被逼着点两层。
 */
function SkuPicker({ onPick, onClose, excludeSkus = [] }) {
  const [keyword, setKeyword] = useState('')
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [itemsCache, setItemsCache] = useState({})
  const [itemsLoading, setItemsLoading] = useState(false)

  const timerRef = useRef(null)
  const excluded = useMemo(() => new Set(excludeSkus.map(sku => String(sku).toUpperCase())), [excludeSkus])

  const search = useCallback(async (query) => {
    setLoading(true)
    setError('')
    try {
      const { data } = await axios.get('/api/sku/search', { params: { q: query } })
      setGroups(Array.isArray(data) ? data : [])
    } catch (searchError) {
      setGroups([])
      setError(searchError?.response?.data?.error || 'SKU 服务暂时不可用，请确认采购模块已启动')
    } finally {
      setLoading(false)
    }
  }, [])

  // 首次直接拉全量（SKU 服务默认返回前 300 组），输入时再防抖查
  useEffect(() => {
    search('')
  }, [search])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(keyword.trim()), 260)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [keyword, search])

  const toggleGroup = async (group) => {
    if (expanded === group.id) { setExpanded(null); return }
    setExpanded(group.id)
    if (itemsCache[group.id]) return
    setItemsLoading(true)
    try {
      const { data } = await axios.get(`/api/sku/group/${group.id}`)
      setItemsCache(current => ({ ...current, [group.id]: data.items || [] }))
    } catch (loadError) {
      setError(loadError?.response?.data?.error || '读取产品货号失败')
    } finally {
      setItemsLoading(false)
    }
  }

  // 输入框里直接敲完整货号时，优先按货号选中，不去猜产品组
  const submitDirect = (event) => {
    event.preventDefault()
    const value = keyword.trim()
    if (!value) return
    onPick({ sku: value.toUpperCase(), display_sku: value.toUpperCase(), source: 'manual' })
  }

  return (
    <div className="sku-picker">
      <div className="sku-picker-head">
        <h3><PackageIcon size={16} /> 选择已有货号</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><CloseIcon size={15} /></button>
      </div>

      <form className="sku-picker-search" onSubmit={submitDirect}>
        <span className="sku-picker-search-icon"><SearchIcon size={15} /></span>
        <input
          type="text"
          autoFocus
          value={keyword}
          placeholder="搜产品名 / 货号 / 规格，或直接敲完整货号回车"
          aria-label="搜索货号"
          onChange={event => setKeyword(event.target.value)}
        />
      </form>

      {error && <p className="sku-picker-error">{error}</p>}

      <div className="sku-picker-body">
        {loading && !groups.length && <p className="sku-picker-hint">正在读取 SKU 目录…</p>}
        {!loading && !error && !groups.length && (
          <p className="sku-picker-hint">没有匹配的产品。可以直接敲完整货号回车强制选用。</p>
        )}

        <ul className="sku-group-list">
          {groups.map(group => {
            const isOpen = expanded === group.id
            const items = itemsCache[group.id] || []
            const priceText = group.price_min === null || group.price_min === undefined
              ? '未报价'
              : group.price_min === group.price_max
                ? `${group.price_min}`
                : `${group.price_min} ~ ${group.price_max}`
            return (
              <li className="sku-group" key={group.id}>
                <button
                  type="button"
                  className={`sku-group-head${isOpen ? ' is-open' : ''}`}
                  onClick={() => toggleGroup(group)}
                  aria-expanded={isOpen}
                >
                  <span className={`sku-group-caret${isOpen ? ' is-open' : ''}`}><ChevronDownIcon size={13} /></span>
                  <span className="sku-group-name">{group.name || '未命名产品'}</span>
                  <span className="sku-group-meta">
                    {group.supplier_short || group.supplier_name || '未指派供应商'}
                    {' · '}
                    {group.item_count} 个货号
                    {' · '}
                    {priceText}
                  </span>
                </button>

                {isOpen && (
                  <div className="sku-group-items">
                    {itemsLoading && !items.length && <p className="sku-picker-hint">读取货号中…</p>}
                    {items.map(item => {
                      const already = excluded.has(String(item.sku).toUpperCase())
                      return (
                        <button
                          type="button"
                          key={item.sku}
                          className={`sku-item${already ? ' is-used' : ''}`}
                          disabled={already}
                          onClick={() => onPick(item)}
                          title={already ? '该货号已在本次询盘中' : `选用 ${item.sku}`}
                        >
                          <SkuThumb sku={item.sku} filename={thumbs[item.sku]} size={32} />
                          <span className="sku-item-code">{item.display_sku || item.sku}</span>
                          <span className="sku-item-spec">{item.spec || item.name || '—'}</span>
                          <span className="sku-item-price">
                            {item.price === null || item.price === undefined
                              ? <em>未报价</em>
                              : <><b>{item.price}</b><span className="unit"> {item.currency || 'CNY'}</span></>}
                          </span>
                          {already && <span className="sku-item-flag">已添加</span>}
                        </button>
                      )
                    })}
                    {!itemsLoading && !items.length && <p className="sku-picker-hint">这个产品下还没有货号。</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export default SkuPicker
