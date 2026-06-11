import type { Config } from 'tailwindcss';
import { qimingPreset } from '../../packages/ui/tailwind-preset';

// 颜色/圆角/阴影/字体全部来自 design-tokens 生成的预设,禁止在此扩展裸色值
export default {
  presets: [qimingPreset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config;
