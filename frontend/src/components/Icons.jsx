import React from 'react'

// SVG图标组件库
export const DashboardIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
  </svg>
)

/* 供应商：厂房 + 烟囱（照 icons8-厂-parakeet-line 重绘为矢量，跟随主题变色） */
export const FactoryIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {/* 厂房主体：锯齿双峰屋顶 + 左右墙 + 底边 */}
    <path d="M2.4 12l4-3.4 3 3.4 3-3.4 3.6 3.3V21.6H2.4z" />
    {/* 烟囱：左直边 + 顶口 + 略微收窄的右斜边 */}
    <path d="M18 21.6V3.4h3.4l.6 18.2" />
    {/* 窗户：2 行 × 4 列 */}
    <path d="M4.7 14.1h1.6v1.6H4.7zM7.8 14.1h1.6v1.6H7.8zM10.9 14.1h1.6v1.6h-1.6zM14 14.1h1.6v1.6H14z" />
    <path d="M4.7 17.6h1.6v1.6H4.7zM7.8 17.6h1.6v1.6H7.8zM10.9 17.6h1.6v1.6h-1.6zM14 17.6h1.6v1.6H14z" />
    {/* 补齐烟囱下方的地面线 */}
    <path d="M16 21.6h6.2" />
  </svg>
)

/* 品牌标识：云 + 数据库圆柱（照 icons8-云 重绘为矢量）
   左半边云跟随主题色，右半边圆柱固定品牌蓝；坐标用 24 网格，内部 0.48 缩放。 */
export const CloudDbIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {/* 云：闭合圆头轮廓 */}
    <g transform="translate(1 6) scale(0.48)" stroke="currentColor" strokeWidth="3.54">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </g>
    {/* 数据库圆柱：顶盖椭圆 + 桶身 + 中间分层线 */}
    <g transform="translate(12.4 5.4) scale(0.48)" style={{ stroke: 'var(--primary)' }} strokeWidth="3.54">
      <ellipse cx="12" cy="5.5" rx="8.5" ry="3.2" />
      <path d="M3.5 5.5V19.5A8.5 3.2 0 0 0 20.5 19.5V5.5" />
      <path d="M3.5 12.5A8.5 3.2 0 0 0 20.5 12.5" />
    </g>
  </svg>
)

export const DownloadIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

export const PackageIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
)

export const UsersIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

export const TargetIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
)

export const ClipboardIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
)

export const SettingsIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24" />
  </svg>
)

export const DollarIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
)

export const CheckIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

export const PinIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
)

export const CalendarIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)

export const MinusIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export const BellIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

export const FlagIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </svg>
)

export const TuneIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
    <circle cx="10" cy="18" r="2" fill="currentColor" stroke="none" />
  </svg>
)

export const SunIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
)

/* 明月（含两颗四角星）——夜间模式切换图标
   造型取自 https://igoutu.cn/icon/101343/moon-and-stars（Icons8 iOS Glyph 风格「明月」），
   按原图重绘为矢量：月牙 = 大圆挖掉一枚偏向右上的圆（两段圆弧相减），
   两枚四角星 = 凹边圆角菱形。全部走 currentColor，可跟随日夜主题换色。 */
export const MoonStarsIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <g fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round">
      <path d="M9.63 3.09A10 10 0 1 0 20.61 15.77A9.5 9.5 0 0 1 9.63 3.09Z" />
      <path d="M14.85 1.1C14.85 1.805 16.495 3.45 17.2 3.45C16.495 3.45 14.85 5.095 14.85 5.8C14.85 5.095 13.205 3.45 12.5 3.45C13.205 3.45 14.85 1.805 14.85 1.1Z" />
      <path d="M19.95 5.9C19.95 6.86 22.19 9.1 23.15 9.1C22.19 9.1 19.95 11.34 19.95 12.3C19.95 11.34 17.71 9.1 16.75 9.1C17.71 9.1 19.95 6.86 19.95 5.9Z" />
    </g>
  </svg>
)


export const CloseIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
)
export const ExchangeIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" /></svg>
)
export const SparkIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6ZM20 2v4m-2-2h4" /></svg>
)

export const SearchIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
)
export const ClockIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
)
export const PlusCircleIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
)
export const BotIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8" /><path d="M2 12h2M20 12h2" /></svg>
)

/* 小皮专属标志 —— 跟 lucide 通用 BotIcon 区分：
 *   - 头部加 16% 浅填充（视觉重量更足，缩略尺寸下也认得出）
 *   - 眼睛从「点」改「实心圆」（更可爱）
 *   - 嘴巴从「横线」改「弧线」（更友善）
 *   - 去掉 lucide Bot 两侧那两根短横线（视觉上像「耳朵」又不像，反而显得莫名）
 *   - 头顶触角末端加一颗实心小星点（暗示 AI） */
export const AIBotIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="4" y="9" width="16" height="11" rx="3.5" fill="currentColor" fillOpacity="0.16" />
    <path d="M12 5v4" />
    <circle cx="12" cy="4.5" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none" />
    <path d="M9.5 17.2c.6.7 4.4.7 5 0" />
  </svg>
)
export const SendIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
)

export const ActivityIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d="M4 17V9M9 17V5M14 17v-3M19 17V7" /><path d="M3 20h18" /></svg>
)


export const SidebarLayoutIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M9 4v16" />
    <path d="M6.4 8h.1M6.4 12h.1M6.4 16h.1" strokeWidth="2.4" />
  </svg>
)

/* 分组折叠箭头：展开时朝下，收起时由 CSS 旋转 -90° */
export const ChevronDownIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

/* 汇率计算器：机身 + 显示屏 + 按键点阵 */
export const CalculatorIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="4" y="2.5" width="16" height="19" rx="2.6" />
    <path d="M8 7.2h8" />
    <path d="M8.2 11.6h.01M12 11.6h.01M15.8 11.6h.01M8.2 15h.01M12 15h.01M15.8 15h.01M8.2 18.4h.01M12 18.4h.01M15.8 18.4h.01" strokeWidth="2.4" />
  </svg>
)

/* 货币互换：上下两条反向箭头 */
export const SwapIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M4 8.5h15" />
    <path d="m15.6 5.2 3.3 3.3-3.3 3.3" />
    <path d="M20 15.5H5" />
    <path d="m8.4 12.2-3.3 3.3 3.3 3.3" />
  </svg>
)

/* 客户报价单 */
export const QuoteIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M12 11v8" />
    <path d="M14 12.4h-2.9a1.5 1.5 0 0 0 0 3h1.8a1.5 1.5 0 0 1 0 3H10" />
  </svg>
)

/* 询盘：来信气泡 + 内含报价行 */
export const InquiryIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M21 12.4a7.6 7.6 0 0 1-7.6 7.6H8.4L3 22.2V8.8A7.6 7.6 0 0 1 10.6 1.2h2.8A7.6 7.6 0 0 1 21 8.8z" />
    <path d="M8 8.6h8M8 12h5" />
  </svg>
)

/* 合同清洗：漏斗过滤 + 落料 */
export const CleanupIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M3 4.4h18l-7.2 8.4v6.2l-3.6 2.2v-8.4z" />
    <path d="M6.6 8.1h10.8" />
  </svg>
)

/* PI 合同（形式发票 / 合同文件） */
export const ContractIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M8 13h4M8 17h6" />
    <path d="M15.5 16.2c1-.9 2.2.9 3.2 0" />
  </svg>
)

/* 采购单 */
export const PurchaseIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M2 3h2.4l2.2 11.1a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 6.6H5.2" />
    <circle cx="9.5" cy="20" r="1.6" />
    <circle cx="17.5" cy="20" r="1.6" />
  </svg>
)

/* 卡片网格排列 */
export const GridIcon = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
  </svg>
)

/* 横列表排列 */
export const ListIcon = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="3.6" cy="6" r="1.2" />
    <circle cx="3.6" cy="12" r="1.2" />
    <circle cx="3.6" cy="18" r="1.2" />
  </svg>
)

/* 小推车 / 报价篮 */
export const CartIcon = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M2 3h2l2.6 12.4a1.6 1.6 0 0 0 1.6 1.3h9.2a1.6 1.6 0 0 0 1.6-1.3L21 7H5.3" />
    <circle cx="9.5" cy="20.2" r="1.5" />
    <circle cx="17.5" cy="20.2" r="1.5" />
  </svg>
)

/* 图片占位 */
export const ImageIcon = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8.6" cy="8.6" r="1.7" />
    <path d="m4 17 4.6-4.6a1.6 1.6 0 0 1 2.3 0L15 16.5" />
    <path d="m14.2 15.2 1.7-1.7a1.6 1.6 0 0 1 2.3 0L21 16.5" />
  </svg>
)

/* 刷新 / 同步更新 */
export const RefreshIcon = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M3.2 12a8.8 8.8 0 0 1 15-6.2L21 8.4" />
    <path d="M21 3.6v4.8h-4.8" />
    <path d="M20.8 12a8.8 8.8 0 0 1-15 6.2L3 15.6" />
    <path d="M3 20.4v-4.8h4.8" />
  </svg>
)

/* 删除 / 回收 */
export const TrashIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M3.5 6h17" />
    <path d="M8.5 6V4.2A1.2 1.2 0 0 1 9.7 3h4.6a1.2 1.2 0 0 1 1.2 1.2V6" />
    <path d="M6 6l1 14a2 2 0 0 0 2 1.8h6A2 2 0 0 0 17 20l1-14" />
    <path d="M10.2 10.5v6M13.8 10.5v6" />
  </svg>
)

/* 铅笔 / 编辑 */
export const PencilIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M16.5 3.7a2.1 2.1 0 0 1 3 3L7.4 18.8l-4 1 1-4z" />
    <path d="m14.7 5.5 3.8 3.8" />
  </svg>
)

/* 返回 / 左箭头 */
export const ArrowLeftIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M19 12H5" />
    <path d="m11 18-6-6 6-6" />
  </svg>
)

/* 盾牌 / 权限 */
export const ShieldIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M12 3l7 3v6c0 4.3-2.9 7.8-7 9-4.1-1.2-7-4.7-7-9V6z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </svg>
)

/* 地球 / 公海 */
export const GlobeIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3.2 9h17.6M3.2 15h17.6" />
    <path d="M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z" />
  </svg>
)

/* 单人 / 个人资料 */
export const UserIcon = ({ size = 20, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <circle cx="12" cy="8.2" r="3.7" />
    <path d="M4.6 20c.6-3.6 3.6-5.6 7.4-5.6s6.8 2 7.4 5.6" />
  </svg>
)

/* 钥匙 / 密码 */
export const KeyIcon = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8.5-8.5M17 6l2 2M14.5 8.5l2 2" />
  </svg>
)

/* 建筑 / 组织 */
export const BuildingIcon = ({ size = 18, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M4 21V5.2A1.2 1.2 0 0 1 5.2 4h8.6a1.2 1.2 0 0 1 1.2 1.2V21" />
    <path d="M15 10h3.8A1.2 1.2 0 0 1 20 11.2V21M2.5 21h19" />
    <path d="M7.5 8h4M7.5 12h4M7.5 16h4" />
  </svg>
)

/* 保存 / 勾选存盘 */
export const SaveIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M5 3.8h11L20.2 8v12.2A1.8 1.8 0 0 1 18.4 22H5a1.8 1.8 0 0 1-1.8-1.8V5.6A1.8 1.8 0 0 1 5 3.8z" />
    <path d="M7.6 3.8v5.4h7.6V3.8M7.6 22v-6.2h8.8V22" />
  </svg>
)

/* 登出 */
export const LogoutIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M14.5 4.5H6.8A1.8 1.8 0 0 0 5 6.3v11.4a1.8 1.8 0 0 0 1.8 1.8h7.7" />
    <path d="M18 12H10M15.4 8.6 18.8 12l-3.4 3.4" />
  </svg>
)

/* 相机 / 换头像 */
export const CameraIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M3.5 8.4h3l1.4-2.2h6.2L15.5 8.4h4A1.5 1.5 0 0 1 21 9.9v8.2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.1V9.9a1.5 1.5 0 0 1 1.5-1.5z" />
    <circle cx="12" cy="13.6" r="3.2" />
  </svg>
)

/* 眼睛 / 显示密码 */
export const EyeIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

/* 眼睛（划线）/ 隐藏密码 */
export const EyeOffIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M4 4l16 16" />
    <path d="M9.6 5.9A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-2.7 3.5M6.4 8.2A16.8 16.8 0 0 0 2.5 12S6 18.2 12 18.2c1.3 0 2.4-.3 3.4-.7" />
    <path d="M10 10.2a3 3 0 0 0 4 4" />
  </svg>
)

/* 加号 / 新增 */
export const PlusIcon = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/* 上传 / 上传者 */
export const UploadIcon = ({ size = 14, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M12 16V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </svg>
)

/* 副本 / 复制 */
export const CopyIcon = ({ size = 14, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
  </svg>
)

/* 操作人 / 用户痕迹 */
export const FingerprintIcon = ({ size = 14, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M12 4a8 8 0 0 0-8 8v3" />
    <path d="M20 15v-3a8 8 0 0 0-4-6.93" />
    <path d="M12 11a1.5 1.5 0 0 0-1.5 1.5V17a3 3 0 0 0 3 3" />
    <path d="M16 17v-4.5a4 4 0 0 0-2-3.46" />
    <path d="M7 17.5V12a5 5 0 0 1 7.5-4.33" />
  </svg>
)

