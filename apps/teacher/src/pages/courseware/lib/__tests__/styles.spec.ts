/**
 * PPT 风格系统:模板库完整性 + 提示词组装(含自定义风格的护栏)+ 卡片缩略图合法性。
 * 风格模板是发给生图模型的「事实」,一旦少了教学密度或护栏,成品就会退化成海报/文字墙,
 * 故这里把结构要求钉成测试。
 */
import { describe, expect, it } from 'vitest';
import {
  COURSEWARE_STYLES, CUSTOM_GUARDRAIL, CUSTOM_STYLE, CUSTOM_STYLE_ID, DEFAULT_STYLE_ID,
  STYLE_CARDS, composePagePrompt, composeStylePrefix, getStyle, styleLabel, validateStyle,
} from '../styles';
import { stylePreviewSvg } from '../stylePreview';

const HEX = /^#[0-9A-F]{6}$/i;

describe('风格模板库完整性', () => {
  it('5 种内置 + 1 种自定义,id 唯一,默认项在内置里', () => {
    expect(COURSEWARE_STYLES).toHaveLength(5);
    expect(STYLE_CARDS).toHaveLength(6);
    expect(STYLE_CARDS[5].id).toBe(CUSTOM_STYLE_ID);
    expect(COURSEWARE_STYLES.map((s) => s.id)).toEqual(
      ['academic_blue', 'hand_sketch', 'vector_illust', 'dark_tech', 'swiss_grid'],
    );
    expect(new Set(STYLE_CARDS.map((s) => s.id)).size).toBe(6);
    expect(COURSEWARE_STYLES.some((s) => s.id === DEFAULT_STYLE_ID)).toBe(true);
  });

  it('每张卡片都有名称/定位/适用场景,palette 四个键齐全且为合法色值', () => {
    for (const s of STYLE_CARDS) {
      expect(s.name.trim(), s.id).toBeTruthy();
      expect(s.tagline.trim(), s.id).toBeTruthy();
      expect(s.suit.trim(), s.id).toBeTruthy();
      expect(Object.keys(s.palette).sort()).toEqual(['accent', 'bg', 'primary', 'text']);
      for (const [k, v] of Object.entries(s.palette)) expect(v, `${s.id}.${k}`).toMatch(HEX);
    }
  });

  it('每套内置模板都写清横版、五段结构与教学密度要求', () => {
    for (const s of COURSEWARE_STYLES) {
      expect(s.promptTemplate, s.id).toContain('16:9 横版');
      for (const section of ['【核心视觉】', '【字体】', '【内容页构图】', '【教学密度】', '【禁止】']) {
        expect(s.promptTemplate, `${s.id} 缺 ${section}`).toContain(section);
      }
      // 教学密度精髓:讲解性视觉 / 拒绝文字墙 / 中文无错字
      expect(s.promptTemplate, s.id).toContain('讲解性');
      expect(s.promptTemplate, s.id).toContain('文字墙');
      expect(s.promptTemplate, s.id).toContain('无错字');
      expect(s.promptTemplate, s.id).toContain('无关 logo');
    }
  });

  it('getStyle:未知 id 退回默认风格', () => {
    expect(getStyle('dark_tech').name).toBe('深色极简科技');
    expect(getStyle('不存在的风格').id).toBe(DEFAULT_STYLE_ID);
  });
});

describe('composeStylePrefix', () => {
  it('内置风格直接返回该风格模板', () => {
    for (const s of COURSEWARE_STYLES) {
      expect(composeStylePrefix(s.id)).toBe(s.promptTemplate);
      expect(composeStylePrefix(s.id)).not.toContain(CUSTOM_GUARDRAIL);
    }
  });

  it('自定义风格 = 固定护栏 + 教师原文,护栏在前', () => {
    const out = composeStylePrefix(CUSTOM_STYLE_ID, '  温暖的水彩画风,柔和的粉蓝色调  ');
    expect(out.startsWith(CUSTOM_GUARDRAIL)).toBe(true);
    expect(out).toContain('温暖的水彩画风,柔和的粉蓝色调');
    // 护栏钉死的骨架不因教师文字改变
    expect(out).toContain('16:9 横版');
    expect(out).toContain('讲解性配图');
    expect(out).toContain('无错字');
    expect(out).toContain('不出现水印');
  });

  it('自定义但描述为空 / 未知 id:兜底成默认风格模板,绝不发出无风格提示词', () => {
    const fallback = getStyle(DEFAULT_STYLE_ID).promptTemplate;
    expect(composeStylePrefix(CUSTOM_STYLE_ID)).toBe(fallback);
    expect(composeStylePrefix(CUSTOM_STYLE_ID, '   ')).toBe(fallback);
    expect(composeStylePrefix('野生风格')).toBe(fallback);
  });
});

describe('validateStyle / styleLabel', () => {
  it('内置风格无需校验;自定义必须写描述', () => {
    expect(validateStyle({ id: 'swiss_grid' })).toEqual([]);
    expect(validateStyle({ id: CUSTOM_STYLE_ID })).toHaveLength(1);
    expect(validateStyle({ id: CUSTOM_STYLE_ID, customText: '  ' })).toHaveLength(1);
    expect(validateStyle({ id: CUSTOM_STYLE_ID, customText: '水彩风' })).toEqual([]);
  });

  it('显示名:内置取风格名,自定义带上描述前 12 字', () => {
    expect(styleLabel({ id: 'hand_sketch' })).toBe('手绘白板');
    expect(styleLabel({ id: CUSTOM_STYLE_ID })).toBe(CUSTOM_STYLE.name);
    expect(styleLabel({ id: CUSTOM_STYLE_ID, customText: '水彩风' })).toBe('自定义风格 · 水彩风');
    expect(styleLabel({ id: CUSTOM_STYLE_ID, customText: '温暖的水彩画风,柔和的粉蓝色调' }))
      .toBe('自定义风格 · 温暖的水彩画风,柔和的粉…');
  });
});

describe('composePagePrompt', () => {
  const page = {
    title: '勾股定理 · 课题引入',
    body: '· 从校园里的真实问题出发。\n· 复习相关旧知识。',
    imagePrompt: '右栏画一幅旗杆与影子的示意图',
  };

  it('风格前缀 + 整页内容 + 页码,三段齐全且顺序固定', () => {
    const out = composePagePrompt({ style: { id: 'dark_tech' }, page, seq: 2, total: 8 });
    expect(out.startsWith(getStyle('dark_tech').promptTemplate)).toBe(true);
    expect(out).toContain('页标题:勾股定理 · 课题引入');
    expect(out).toContain('- 从校园里的真实问题出发。');
    expect(out).toContain('- 复习相关旧知识。');
    expect(out).toContain('配图与版式:右栏画一幅旗杆与影子的示意图');
    expect(out).toContain('页码:右下角标注「2/8」');
    expect(out.indexOf('【本页内容】')).toBeLessThan(out.indexOf('页码:'));
  });

  it('自定义风格的每页提示词都带护栏', () => {
    const out = composePagePrompt({
      style: { id: CUSTOM_STYLE_ID, customText: '水彩风' }, page, seq: 1, total: 3,
    });
    expect(out).toContain(CUSTOM_GUARDRAIL);
    expect(out).toContain('水彩风');
    expect(out).toContain('页码:右下角标注「1/3」');
  });

  it('要点为空也不塌:仍给出标题与页码', () => {
    const out = composePagePrompt({
      style: { id: DEFAULT_STYLE_ID }, page: { title: '小结', body: '', imagePrompt: '' }, seq: 3, total: 3,
    });
    expect(out).toContain('页标题:小结');
    expect(out).toContain('要点:无');
    expect(out).toContain('页码:右下角标注「3/3」');
  });
});

describe('stylePreviewSvg', () => {
  /** 同一元素上重复声明属性会让 SVG 变成非法 XML,浏览器直接不渲染整张图 */
  const expectWellFormedSvg = (svg: string) => {
    for (const tag of svg.match(/<[a-z]+[^>]*>/g) ?? []) {
      const names = [...tag.matchAll(/([a-z][a-z-]*)=/g)].map((m) => m[1]);
      expect(new Set(names).size, `重复属性:${tag}`).toBe(names.length);
    }
    const opened = (svg.match(/<(?!\/)[a-z]/g) ?? []).length;
    const closed = (svg.match(/\/>/g) ?? []).length + (svg.match(/<\//g) ?? []).length;
    expect(opened).toBe(closed);
  };

  it('六种风格都能出合法 SVG data-URI,且用各自 palette 的底色', () => {
    for (const s of STYLE_CARDS) {
      const uri = stylePreviewSvg(s.id);
      expect(uri.startsWith('data:image/svg+xml,'), s.id).toBe(true);
      const svg = decodeURIComponent(uri.replace('data:image/svg+xml,', ''));
      expectWellFormedSvg(svg);
      expect(svg, s.id).toContain('viewBox="0 0 316 212');
      expect(svg, s.id).toContain(s.palette.bg);
    }
  });

  it('缩略图彼此不同(走查时六张卡片不能长一个样)', () => {
    const all = STYLE_CARDS.map((s) => stylePreviewSvg(s.id));
    expect(new Set(all).size).toBe(STYLE_CARDS.length);
  });

  it('未知 id 退回默认风格缩略图', () => {
    expect(stylePreviewSvg('野生风格')).toBe(stylePreviewSvg(DEFAULT_STYLE_ID));
  });
});
