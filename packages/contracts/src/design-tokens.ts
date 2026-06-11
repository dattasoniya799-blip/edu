/**
 * @qiming/contracts · 设计令牌(从原型 v0.4 的 CSS 变量抽取,前端唯一视觉事实)
 * Tailwind 配置与 packages/ui 均从此导入;禁止在组件内写裸十六进制色值
 */
export const colors = {
  bg: '#F4F6FB', card: '#FFFFFF',
  text: '#1E2A44', text2: '#5B6B86', text3: '#94A3B8',
  primary: '#4F6BF5', primaryDeep: '#3B53D6', primarySoft: '#EEF1FE',
  orange: '#FF8A3D', orangeSoft: '#FFF1E6',
  green: '#10B981', greenSoft: '#E7F8F1',
  red: '#F25555', redSoft: '#FEECEC',
  violet: '#8B5CF6', violetSoft: '#F1EBFE',
  line: '#E6EAF2',
} as const;

export const radius = { lg: '16px', md: '12px', pill: '999px' } as const;
export const shadow = { card: '0 1px 3px rgba(30,42,68,.06), 0 10px 30px rgba(30,42,68,.06)' } as const;
export const font = {
  sans: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,sans-serif',
  mono: '"SF Mono","JetBrains Mono",Consolas,"Courier New",monospace',
} as const;
/** 平板触控规范:可点击目标最小高度 */
export const touch = { minTarget: 44 } as const;
/** AI 功能统一标识色(紫),激励/告警用橙,正确/掌握用绿 —— 与原型一致,克制使用 */
export const semantic = { ai: colors.violet, incentive: colors.orange, success: colors.green, danger: colors.red } as const;
