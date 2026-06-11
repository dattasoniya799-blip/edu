# @qiming/ui · 共享组件库(B1)

三端共用的 React 组件 + Tailwind 预设。**以源码形式被消费**:各 app 通过 Vite `resolve.alias` 与 tsconfig `paths` 指到 `packages/ui/src`,不需要构建本包。

## 怎么跑

```bash
npm install
npm test        # TexText/renderMix 25 条公式用例 + 组件渲染用例(vitest)
npm run check   # tsc --noEmit
```

## 内容

| 导出 | 说明 |
|---|---|
| `Button / Card / Tag / Table / Modal / ToastProvider+useToast / ProgressBar / StatCard / EmptyState` | 风格基线组件(主按钮实底带投影、tag 胶囊 soft 底、表格灰底表头、进度条 绿≥80/主色60–79/红<60、列表空态等) |
| `TexText` + `renderMix` | 逐字移植原型 v0.4 的 KaTeX 混排渲染:`$..$` 行内、`$$..$$` 块级、`\ce{}` mhchem;语法错误显示红色 mono 提示 |
| `tailwind-preset.ts` | 由 `@qiming/contracts` design-tokens 生成 Tailwind 主题(颜色**整表替换**、圆角、阴影、字体、min-h-touch 44px) |

## 覆盖的验收项

- TexText 25 条公式用例单测全过(`npm test`,样例取自原型中实际出现的公式,含 mhchem、块级方程组、错误与转义边界)。
- 颜色纪律:`theme.colors` 整表替换为 design-tokens,组件内无任何裸十六进制色值;阴影中的 rgba 由 token 色程序化派生(`tailwind-preset.ts` 的 `rgba()`)。

## 已知取舍

- 基线提到的表头灰底 `#F9FAFD` 不在 design-tokens 内,按「颜色只来自令牌」纪律改用 `bg-bg/50`(视觉等价);登录页品牌渐变端点 `#7C8FF8` 同理收敛为 primary 系 token。
