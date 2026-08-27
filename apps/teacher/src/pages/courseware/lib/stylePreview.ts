/**
 * 风格卡片的迷你幻灯片缩略图(内联 SVG data-URI)。
 *
 * 画的是「该风格下一页课件长什么样」的抽象示意:标题条 + 三条要点 + 示意图区 + 页码,
 * 与 mock 出图(src/mocks/data.ts 的 slideImage)同一套版式骨架,只是尺寸缩小、文字用色块代替。
 * 色值取自 styles.ts 的 palette(生图提示词/渲染参数,不是界面配色,见 styles.ts 文件头说明)。
 */
import { CUSTOM_STYLE_ID, getStyle } from './styles';

/** 缩略图画布:1264×848 的 1/4,保持成品横版比例 */
const W = 316;
const H = 212;

/** 文字占位条 */
const bar = (x: number, y: number, w: number, h: number, fill: string, rx = 0, opacity = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" opacity="${opacity}"/>`;

/** 手绘感折线(带轻微抖动的「直线」) */
const wobble = (x: number, y: number, w: number, stroke: string, width = 2) =>
  `<path d="M${x} ${y} q${w * 0.25} -1.6 ${w * 0.5} 0.4 t${w * 0.5} -0.6" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;

/** 三条要点占位(marker 决定序号点的形状) */
function bullets(opts: {
  marker: 'circle' | 'square' | 'dash' | 'sketch';
  markerFill: string; lineFill: string; lineOpacity?: number; widths?: number[];
}): string {
  const widths = opts.widths ?? [112, 96, 104];
  return widths.map((w, i) => {
    const y = 92 + i * 26;
    const mark = opts.marker === 'circle' ? `<circle cx="34" cy="${y + 4}" r="5" fill="${opts.markerFill}"/>`
      : opts.marker === 'square' ? bar(29, y - 1, 10, 10, opts.markerFill)
        : opts.marker === 'dash' ? bar(28, y + 2, 12, 3, opts.markerFill)
          : `<path d="M29 ${y + 4} q5 -4 10 0" fill="none" stroke="${opts.markerFill}" stroke-width="2.4" stroke-linecap="round"/>`;
    return mark + bar(48, y, w, 8, opts.lineFill, 2, opts.lineOpacity ?? 0.85);
  }).join('');
}

function previewBody(styleId: string): string {
  const { bg, primary, accent, text } = getStyle(styleId).palette;
  const frame = `<rect width="${W}" height="${H}" fill="${bg}"/>`;

  if (styleId === 'hand_sketch') {
    return [
      frame,
      // 纸面方格 + 手绘边框
      ...[0, 1, 2, 3].map((i) => bar(0, 40 + i * 44, W, 1, primary, 0, 0.06)),
      `<rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="10" fill="none" stroke="${primary}" stroke-width="2" stroke-dasharray="9 5" opacity="0.55"/>`,
      // 马克笔高亮 + 手写标题条
      bar(26, 40, 116, 16, accent, 3, 0.75),
      bar(28, 44, 100, 9, primary, 2, 0.9),
      wobble(28, 64, 62, accent, 3),
      bullets({ marker: 'sketch', markerFill: primary, lineFill: primary, lineOpacity: 0.7, widths: [104, 92, 98] }),
      // 手绘示意框 + 便利贴
      `<rect x="196" y="52" width="96" height="94" rx="8" fill="none" stroke="${primary}" stroke-width="2.2" opacity="0.8"/>`,
      `<path d="M210 128 q14 -34 30 -18 t28 -34" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`,
      bar(252, 150, 34, 26, accent, 2, 0.6),
      bar(28, 178, 74, 6, primary, 2, 0.35),
    ].join('');
  }

  if (styleId === 'vector_illust') {
    const outline = text;
    return [
      frame,
      // 顶部插画装饰带(色块 + 黑描边)
      bar(0, 0, W, 26, primary, 0, 0.9),
      `<circle cx="40" cy="13" r="8" fill="${accent}" stroke="${outline}" stroke-width="2"/>`,
      `<rect x="62" y="5" width="16" height="16" fill="${bg}" stroke="${outline}" stroke-width="2"/>`,
      bar(26, 44, 108, 14, outline, 3),
      bar(26, 64, 52, 6, primary, 3),
      // 要点前的描边色块
      ...[0, 1, 2].map((i) => {
        const y = 92 + i * 26;
        const c = [primary, accent, bg][i];
        return `<rect x="28" y="${y - 2}" width="12" height="12" rx="2" fill="${c}" stroke="${outline}" stroke-width="2"/>`
          + bar(48, y, [106, 92, 100][i], 8, outline, 2, 0.75);
      }),
      // 描边插画区
      `<rect x="196" y="52" width="96" height="94" rx="10" fill="${accent}" stroke="${outline}" stroke-width="2.5" opacity="0.9"/>`,
      `<circle cx="230" cy="92" r="16" fill="${bg}" stroke="${outline}" stroke-width="2.5"/>`,
      `<path d="M210 130 l22 -26 l20 22 l18 -16" fill="none" stroke="${outline}" stroke-width="2.5" stroke-linecap="round"/>`,
      bar(28, 178, 74, 6, outline, 2, 0.35),
    ].join('');
  }

  if (styleId === 'dark_tech') {
    return [
      frame,
      // 极光光带 + 星尘
      `<ellipse cx="250" cy="26" rx="96" ry="40" fill="${primary}" opacity="0.30"/>`,
      `<ellipse cx="52" cy="196" rx="76" ry="34" fill="${accent}" opacity="0.16"/>`,
      bar(26, 42, 112, 14, text, 3, 0.95),
      bar(26, 64, 46, 4, accent, 2),
      bullets({ marker: 'circle', markerFill: accent, lineFill: text, lineOpacity: 0.45 }),
      // 玻璃卡片 + 发光线框
      `<rect x="196" y="52" width="96" height="94" rx="12" fill="${text}" opacity="0.06"/>`,
      `<rect x="196" y="52" width="96" height="94" rx="12" fill="none" stroke="${text}" stroke-width="1" opacity="0.18"/>`,
      `<circle cx="244" cy="99" r="26" fill="none" stroke="${accent}" stroke-width="2"/>`,
      `<path d="M214 122 l20 -18 l16 12 l22 -24" fill="none" stroke="${primary}" stroke-width="2.4" stroke-linecap="round"/>`,
      bar(26, 178, 70, 5, text, 2, 0.28),
      `<circle cx="286" cy="180" r="4" fill="${accent}"/>`,
    ].join('');
  }

  if (styleId === 'swiss_grid') {
    return [
      frame,
      // 12 列网格辅助线 + 直角色块
      ...[1, 2, 3, 4, 5].map((i) => bar(26 + i * 44, 0, 1, H, text, 0, 0.07)),
      bar(26, 36, 150, 18, text),
      bar(26, 62, 240, 4, text),
      bar(240, 90, 52, 52, primary),
      ...[0, 1, 2].map((i) => {
        const y = 92 + i * 26;
        return bar(26, y + 3, 10, 2, text) + bar(46, y, [120, 104, 112][i], 7, text, 0, 0.8);
      }),
      bar(26, 180, 60, 4, text, 0, 0.5),
    ].join('');
  }

  if (styleId === CUSTOM_STYLE_ID) {
    return [
      frame,
      `<rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="10" fill="none" stroke="${primary}" stroke-width="2" stroke-dasharray="7 6" opacity="0.6"/>`,
      bar(28, 42, 104, 14, primary, 3, 0.85),
      bar(28, 64, 44, 5, accent, 2),
      bullets({ marker: 'circle', markerFill: accent, lineFill: primary, lineOpacity: 0.45 }),
      `<rect x="196" y="52" width="96" height="94" rx="10" fill="${accent}" opacity="0.28"/>`,
      `<text x="244" y="105" font-size="20" font-weight="700" fill="${primary}" text-anchor="middle" font-family="sans-serif">✎</text>`,
      `<text x="244" y="128" font-size="13" fill="${primary}" text-anchor="middle" font-family="sans-serif" opacity="0.8">你来定</text>`,
      bar(28, 178, 70, 6, primary, 2, 0.3),
    ].join('');
  }

  // 默认:清爽学院蓝
  return [
    frame,
    bar(0, 0, 8, H, primary),
    bar(8, 0, 3, H, accent, 0, 0.35),
    bar(28, 40, 118, 15, primary, 2),
    bar(28, 63, 40, 5, accent, 2),
    bullets({ marker: 'circle', markerFill: primary, lineFill: text, lineOpacity: 0.6 }),
    `<rect x="196" y="52" width="96" height="94" rx="8" fill="${accent}" opacity="0.12"/>`,
    `<path d="M214 132 L272 132 L214 82 Z" fill="none" stroke="${accent}" stroke-width="2.4" stroke-linejoin="round"/>`,
    bar(26, 170, 240, 1, text, 0, 0.18),
    bar(28, 178, 68, 6, text, 2, 0.3),
    bar(268, 178, 20, 6, primary, 2),
  ].join('');
}

/** 风格卡片缩略图 data-URI(中文走 encodeURIComponent,base64 会破坏多字节字符) */
export function stylePreviewSvg(styleId: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${previewBody(styleId)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
