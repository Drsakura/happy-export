import React from 'react'

/**
 * 币种小国旗（纯 SVG 绘制，不使用 Emoji）
 *
 * 为什么不用 Emoji：🇺🇸 这类「区域指示符」在 Windows 的 Segoe UI Emoji 上
 * 根本不渲染成旗子，只会显示成 US 两个字母方块；而且颜色不可控、尺寸不齐。
 * 所以这里手绘 13 面旗，统一 viewBox 0 0 24 16，靠 CSS 控制大小与描边。
 *
 * 关于中国香港 / 中国台湾：香港用香港特别行政区区旗；台湾地区没有经
 * 国家认可的区旗，这里用红底白字「台」作为**区划标识**，不是国旗。
 */

/** 五角星：单位坐标，几何中心在原点，外接圆半径 1（内接半径取 0.382） */
const STAR =
  '0,-1 0.2246,-0.309 0.9511,-0.309 0.3633,0.118 0.5878,0.809 0,0.382 ' +
  '-0.5878,0.809 -0.3633,0.118 -0.9511,-0.309 -0.2246,-0.309'

/** 欧元旗 12 颗星的位置（以 12,8 为中心、半径 5 的圆上均分） */
const EU_STARS = [
  [17, 8], [16.33, 10.5], [14.5, 12.33], [12, 13], [9.5, 12.33], [7.67, 10.5],
  [7, 8], [7.67, 5.5], [9.5, 3.67], [12, 3], [14.5, 3.67], [16.33, 5.5]
]

/** 简明国旗集：只画能一眼认出来的特征，不追求像素级还原 */
const FLAGS = {
  /* 美国：13 道红白条纹 + 蓝色星区 */
  USD: (
    <>
      <rect width="24" height="16" fill="#ffffff" />
      <g fill="#b22234">
        <rect y="0" width="24" height="1.23" />
        <rect y="2.46" width="24" height="1.23" />
        <rect y="4.92" width="24" height="1.23" />
        <rect y="7.38" width="24" height="1.23" />
        <rect y="9.85" width="24" height="1.23" />
        <rect y="12.31" width="24" height="1.23" />
        <rect y="14.77" width="24" height="1.23" />
      </g>
      <rect width="9.8" height="8.62" fill="#3c3b6e" />
      <g fill="#ffffff">
        {[0, 1, 2, 3, 4].map(i => <circle key={`a${i}`} cx={1.4 + i * 1.75} cy="1.4" r="0.48" />)}
        {[0, 1, 2, 3].map(i => <circle key={`b${i}`} cx={2.28 + i * 1.75} cy="2.95" r="0.48" />)}
        {[0, 1, 2, 3, 4].map(i => <circle key={`c${i}`} cx={1.4 + i * 1.75} cy="4.5" r="0.48" />)}
        {[0, 1, 2, 3].map(i => <circle key={`d${i}`} cx={2.28 + i * 1.75} cy="6.05" r="0.48" />)}
        {[0, 1, 2].map(i => <circle key={`e${i}`} cx={2.28 + i * 1.75} cy="7.55" r="0.48" />)}
      </g>
    </>
  ),

  /* 中国：五星红旗 */
  CNY: (
    <>
      <rect width="24" height="16" fill="#de2910" />
      <g fill="#ffde00">
        <polygon points={STAR} transform="translate(4.4,5.4) scale(2.6)" />
        <polygon points={STAR} transform="translate(9,1.9) scale(0.85)" />
        <polygon points={STAR} transform="translate(10.9,3.9) scale(0.85)" />
        <polygon points={STAR} transform="translate(10.9,6.5) scale(0.85)" />
        <polygon points={STAR} transform="translate(9,8.5) scale(0.85)" />
      </g>
    </>
  ),

  /* 欧元区：蓝底 + 12 颗黄星围成一圈 */
  EUR: (
    <>
      <rect width="24" height="16" fill="#003399" />
      <g fill="#ffcc00">
        {EU_STARS.map(([x, y], i) => (
          <polygon key={i} points={STAR} transform={`translate(${x},${y}) scale(0.92)`} />
        ))}
      </g>
    </>
  ),

  /* 中国香港：香港特别行政区区旗（洋紫荆） */
  HKD: (
    <>
      <rect width="24" height="16" fill="#de2910" />
      <g fill="#ffffff">
        {[0, 72, 144, 216, 288].map(deg => (
          <ellipse key={deg} cx="12" cy="5.15" rx="1.15" ry="2.85" transform={`rotate(${deg} 12 8)`} />
        ))}
      </g>
      <circle cx="12" cy="8" r="0.95" fill="#de2910" />
    </>
  ),

  /* 日本：白底红日 */
  JPY: (
    <>
      <rect width="24" height="16" fill="#ffffff" />
      <circle cx="12" cy="8" r="4.3" fill="#bc002d" />
    </>
  ),

  /* 俄罗斯：白蓝红三横条 */
  RUB: (
    <>
      <rect width="24" height="16" fill="#ffffff" />
      <rect y="5.33" width="24" height="5.34" fill="#0039a6" />
      <rect y="10.67" width="24" height="5.33" fill="#d52b1e" />
    </>
  ),

  /* 马来西亚：红白条纹 + 蓝底黄月黄星 */
  MYR: (
    <>
      <rect width="24" height="16" fill="#ffffff" />
      <g fill="#cc0001">
        <rect y="0" width="24" height="2.29" />
        <rect y="4.57" width="24" height="2.29" />
        <rect y="9.14" width="24" height="2.29" />
        <rect y="13.71" width="24" height="2.29" />
      </g>
      <rect width="12" height="9.15" fill="#010066" />
      <circle cx="4.7" cy="4.57" r="2.75" fill="#ffcc00" />
      <circle cx="5.95" cy="4.57" r="2.35" fill="#010066" />
      <polygon points={STAR} transform="translate(8.5,4.57) scale(1.02)" fill="#ffcc00" />
    </>
  ),

  /* 新加坡：上红下白 + 白色月与五星 */
  SGD: (
    <>
      <rect width="24" height="8" fill="#ed2939" />
      <rect y="8" width="24" height="8" fill="#ffffff" />
      <circle cx="5.1" cy="4" r="2.9" fill="#ffffff" />
      <circle cx="6.5" cy="4" r="2.5" fill="#ed2939" />
      <g fill="#ffffff">
        {[[8.6, 6.05], [6.62, 4.65], [7.37, 2.33], [9.83, 2.33], [10.58, 4.65]].map(([x, y], i) => (
          <polygon key={i} points={STAR} transform={`translate(${x},${y}) scale(0.58)`} />
        ))}
      </g>
    </>
  ),

  /* 中国台湾：台湾地区无国家认可的区旗，用红底白字「台」作区划标识 */
  TWD: (
    <>
      <rect width="24" height="16" fill="#de2910" />
      <text x="12" y="12.3" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#ffffff">台</text>
    </>
  ),

  /* 澳大利亚：蓝底 + 米字旗区 + 南十字星 */
  AUD: (
    <>
      <rect width="24" height="16" fill="#00247d" />
      <g>
        <path d="M0 0 L12 8 M12 0 L0 8" stroke="#ffffff" strokeWidth="1.9" />
        <path d="M0 0 L12 8 M12 0 L0 8" stroke="#cf142b" strokeWidth="1" />
        <path d="M6 0 V8 M0 4 H12" stroke="#ffffff" strokeWidth="2.8" />
        <path d="M6 0 V8 M0 4 H12" stroke="#cf142b" strokeWidth="1.6" />
      </g>
      <g fill="#ffffff">
        <polygon points={STAR} transform="translate(5.6,12.1) scale(1.5)" />
        <polygon points={STAR} transform="translate(17.6,4.6) scale(0.72)" />
        <polygon points={STAR} transform="translate(20.3,7.7) scale(0.72)" />
        <polygon points={STAR} transform="translate(17.7,10.7) scale(0.72)" />
        <polygon points={STAR} transform="translate(15,7.7) scale(0.6)" />
        <polygon points={STAR} transform="translate(19.2,8.6) scale(0.48)" />
      </g>
    </>
  ),

  /* 阿联酋：左侧红竖条 + 绿白黑三横条 */
  AED: (
    <>
      <rect width="24" height="16" fill="#ffffff" />
      <rect width="24" height="5.33" fill="#00732f" />
      <rect y="10.67" width="24" height="5.33" fill="#000000" />
      <rect width="6" height="16" fill="#ff0000" />
    </>
  ),

  /* 沙特：绿底 + 白色清真言与宝刀（简形） */
  SAR: (
    <>
      <rect width="24" height="16" fill="#006c35" />
      <g fill="#ffffff">
        <rect x="3.4" y="4.1" width="17.2" height="1.5" rx="0.75" />
        <rect x="3.4" y="6.5" width="14" height="1.5" rx="0.75" />
        <rect x="3.4" y="10.9" width="14.6" height="1.25" rx="0.6" />
        <polygon points="18.7,10.25 22.4,11.5 18.7,12.8" />
      </g>
    </>
  ),

  /* 加拿大：两侧红竖条 + 中间红枫叶 */
  CAD: (
    <>
      <rect width="24" height="16" fill="#ffffff" />
      <rect width="6" height="16" fill="#d80621" />
      <rect x="18" width="6" height="16" fill="#d80621" />
      <path
        d="M50 5 L58 30 L75 25 L68 45 L90 42 L72 58 L95 72 L62 68 L68 95 L50 78 L32 95 L38 68 L5 72 L28 58 L10 42 L32 45 L25 25 L42 30 Z"
        fill="#d80621"
        transform="translate(12,8) scale(0.15) translate(-50,-50)"
      />
    </>
  )
}

/**
 * @param {string} code ISO 4217 三字币种代码
 * @param {number} width 显示宽度（px），高度按 3:2 自动算
 */
export default function CurrencyFlag({ code, width = 21 }) {
  const body = FLAGS[code]
  const height = Math.round((width * 16) / 24)
  if (!body) {
    return <span className="fx-flag is-blank" style={{ width, height }} />
  }
  return (
    <svg
      className="fx-flag"
      viewBox="0 0 24 16"
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  )
}
