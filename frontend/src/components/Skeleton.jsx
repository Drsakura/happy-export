import React from 'react'

/* ---------------------------------------------------------------------------
 * 骨架屏
 *
 * 为什么要有它：接口回来之前，页面原本只显示一句「正在载入…」。
 * 用户看到的是「什么都没有」+ 一行字，主观上就是把整个加载时间都算成了等待。
 * 换成与真实内容同构的灰色骨架后，视线先落在结构上，感知到的等待会短很多
 * ——这不是玄学，是布局稳定（不会突然跳一下）带来的直接体感差别。
 *
 * 设计原则：
 *   · 骨架的行高、列宽必须**贴近真实内容**，否则加载完成时页面会大幅跳动，
 *     那比显示一句「正在载入…」还难受。所以宁可少画几行，也不要画得不像。
 *   · 纯静态 + 透明度呼吸动画，不用渐变扫光（工业风不需要花活，且省 CPU）。
 *   · 尊重「减少动态效果」设置，开了就静止。
 * --------------------------------------------------------------------------- */

/** 骨架基础块。宽高直接给数字（px）或字符串（'60%'）。 */
export default function Skeleton({ width = '100%', height = 12, radius = 4, className = '', style }) {
  return (
    <span
      className={`skeleton-block ${className}`.trim()}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  )
}

/**
 * 表格骨架：必须放在 <tbody> 里。
 * widths 传每列的相对宽度（数字数组），不传就均分。
 * 第一列默认画长一点，因为表格第一列通常是名称/编号。
 */
export function SkeletonTableRows({ rows = 6, widths = null, colSpan = 1 }) {
  const cells = widths || [2.2, 1, 1, 1]
  const total = cells.reduce((sum, n) => sum + n, 0)
  return Array.from({ length: rows }).map((_, rowIndex) => (
    <tr key={rowIndex} className="skeleton-row" aria-hidden="true">
      {colSpan > 1 ? (
        <td colSpan={colSpan} style={{ padding: '12px 14px' }}>
          <span className="skeleton-inline">
            {cells.map((weight, cellIndex) => (
              <Skeleton
                key={cellIndex}
                width={`${((weight / total) * 100).toFixed(2)}%`}
                height={12}
              />
            ))}
          </span>
        </td>
      ) : (
        cells.map((weight, cellIndex) => (
          <td key={cellIndex} style={{ padding: '12px 14px' }}>
            <Skeleton width={`${Math.min(100, (weight / Math.max(...cells)) * 100).toFixed(0)}%`} height={12} />
          </td>
        ))
      )}
    </tr>
  ))
}

/**
 * 卡片网格骨架：给工作台那种「一排指标卡」用。
 * 数量与真实卡片一致，避免加载完成时整页重排。
 */
export function SkeletonCards({ count = 4, height = 76 }) {
  return (
    <div className="skeleton-cards" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="skeleton-card">
          <Skeleton width="46%" height={11} />
          <Skeleton width="68%" height={22} style={{ marginTop: 10 }} />
        </div>
      ))}
    </div>
  )
}

/**
 * 面板骨架：给「一张面板里几行文本」用。
 */
export function SkeletonPanel({ lines = 3, title = true }) {
  return (
    <div className="skeleton-panel" aria-hidden="true">
      {title && <Skeleton width="30%" height={14} style={{ marginBottom: 14 }} />}
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          width={index === lines - 1 ? '55%' : '100%'}
          height={12}
          style={{ marginBottom: 10 }}
        />
      ))}
    </div>
  )
}
