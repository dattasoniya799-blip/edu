/**
 * @qiming/ui · Tailwind 预设 —— 由 @qiming/contracts 的 design-tokens 生成
 * 三端 tailwind.config.ts 统一 `presets: [qimingPreset]`,组件内禁止裸写十六进制色值。
 * theme.colors 为「整表替换」:除 token 色外不提供任何默认调色板,裸色无法通过类名出现。
 */
import type { Config } from 'tailwindcss';
import { colors, radius, shadow, font } from '../contracts/src/design-tokens';

/** 由 token 色派生带透明度的 rgba(仅用于阴影/光晕,基色一律来自 design-tokens) */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const qimingPreset = {
  content: [],
  theme: {
    // 整表替换:只允许 design-tokens 中的颜色
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      bg: colors.bg,
      card: colors.card,
      line: colors.line,
      ink: { DEFAULT: colors.text, 2: colors.text2, 3: colors.text3 },
      primary: { DEFAULT: colors.primary, deep: colors.primaryDeep, soft: colors.primarySoft },
      orange: { DEFAULT: colors.orange, soft: colors.orangeSoft },
      green: { DEFAULT: colors.green, soft: colors.greenSoft },
      red: { DEFAULT: colors.red, soft: colors.redSoft },
      violet: { DEFAULT: colors.violet, soft: colors.violetSoft },
    },
    fontFamily: {
      sans: font.sans.split(','),
      mono: font.mono.split(','),
    },
    extend: {
      borderRadius: { lg: radius.lg, md: radius.md, pill: radius.pill },
      boxShadow: {
        card: shadow.card,
        btn: `0 4px 14px ${rgba(colors.primary, 0.35)}`,
        'btn-sm': `0 3px 10px ${rgba(colors.primary, 0.3)}`,
        tab: `0 1px 6px ${rgba(colors.text, 0.12)}`,
      },
      minHeight: { touch: '44px' },
    },
  },
} satisfies Config;

export default qimingPreset;
