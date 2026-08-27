/**
 * AI 生成课件 · PPT 风格模板库(前端唯一事实)
 *
 * 素材来源:参考 SlideSpeak 生态的两个开源提示词库(均 MIT)——
 *   - JuneYaooo/gpt-image2-ppt-skills(clean-tech-blue / hand-sketch / vector-illustration /
 *     dark-aurora / swiss-grid 五套「风格 Brief」)
 *   - ningzimu/codex-ppt-skill(教学课件风 / 手绘白板风,提供中文教学场景的密度与文字质量约束)
 * 本文件把上述素材改写为中文教学场景的统一结构:【核心视觉】/【字体】/【内容页构图】/
 * 【教学密度】/【禁止】,并给每套都注入「必须有讲解性视觉、拒绝纯装饰、拒绝文字墙、
 * 中文不得错字」的教学要求(取自教学课件风的精髓)。
 *
 * 关于十六进制色值:本文件里的色值是**发给生图模型的提示词内容**(需要把配色钉死,
 * 否则每页色调会漂)以及 **mock 出图 SVG 的渲染参数**,不是界面配色 ——
 * 界面本身(卡片、按钮、边框)仍一律走既有 Tailwind 类与设计令牌,不写裸色值。
 *
 * 后端实现时:整份风格清单应原样迁到服务端 ai/config 目录,前端只传 style.id / customText
 * (契约 CoursewareStyleInput,2026-08-22 已正式化)。
 */
import type { CoursewareStyleInput } from '@qiming/contracts';

/** 预览缩略图与 mock 出图用的取色(不是界面配色) */
export interface StylePalette {
  /** 幻灯片底色 */
  bg: string;
  /** 主题色:标题装饰、色条、序号点 */
  primary: string;
  /** 点缀色:示意图、次级装饰 */
  accent: string;
  /** 正文文字色 */
  text: string;
}

export interface CoursewareStyle {
  id: string;
  name: string;
  /** 一句话定位(卡片副标题) */
  tagline: string;
  /** 适合场景短语 */
  suit: string;
  palette: StylePalette;
  /** 完整风格提示词(真实链路作为每页提示词的前缀) */
  promptTemplate: string;
}

/** 自定义风格的固定 id */
export const CUSTOM_STYLE_ID = 'custom';
/** 默认选中的风格 */
export const DEFAULT_STYLE_ID = 'academic_blue';

/** 教学密度要求:五套内置风格共用,保证换皮不换「教学属性」 */
const TEACHING_CORE = `【教学密度】
- 这是一页教学幻灯片,不是海报:必须同时有可读的文字要点与讲解性的视觉(示意图/图解/流程/对比/公式/标注),视觉要能解释内容,不能只做装饰。
- 信息密度取中:既不能只有标题加几个词的空页,也不能整段文字堆成文字墙;把长解释改写为分点、图解或带标注的结构。
- 版面必须有清晰层级:标题一眼可辨,要点分条对齐并留出呼吸空间,相关信息就近成组。
- 中文文字、公式、单位、数据标签必须准确、可读、无错字、无乱码;演示距离下不得出现过小字号。
- 不出现水印、无关 logo,不虚构校名/机构名。`;

const ACADEMIC_BLUE: CoursewareStyle = {
  id: 'academic_blue',
  name: '清爽学院蓝',
  tagline: '白底蓝调、结构清晰的学院派教学页',
  suit: '常规课堂讲授、概念推导、公开课',
  palette: { bg: '#FFFFFF', primary: '#0B2E6D', accent: '#1769AA', text: '#1F2937' },
  promptTemplate: `你是一位高校教学课件设计师,对标学院派讲义与 Stripe / Linear 式的克制蓝白版式。请生成 16:9 横版整页教学幻灯片。

【核心视觉】
- 背景:纯白 #FFFFFF,大块区域可用极淡冰蓝 #EAF3FB 分区,禁止深色底。
- 主色:学院深蓝 #0B2E6D 用于标题与结构线;清亮蓝 #1769AA 用于强调与图示描边。
- 中性:正文 #1F2937,辅助说明 #4B5563,分隔线 #D7E0EA。
- 结构装饰:左侧或标题下一条实心蓝色短杠;卡片为白底 + 1px 蓝灰描边 + 12px 圆角,不加阴影光晕。
- 图示统一用细线几何(2-3px 描边),配色只在蓝色系内取阶,语义需要时才引入一种辅助色。

【字体】
- 标题:思源黑体 Bold / 苹方 Bold,深蓝,简洁有力。
- 正文:思源黑体 Regular,行高 1.5,左对齐。
- 标签与数字:加粗短标签,数字可放大 2-3 倍强调。

【内容页构图】
- 顶部页标题 + 一条蓝色细分隔线;主体左栏为带序号圆点的要点文字,右栏为该页的示意图/图解区。
- 要点用蓝色实心圆点或数字圆点,不用 emoji;整页留白约 35-45%。
- 右侧图示必须与本页内容对应(几何图、流程图、对比表、坐标系、知识网络等),并带简短标注。

${TEACHING_CORE}

【禁止】
- 禁止深色背景、霓虹色、彩虹渐变、玻璃拟态与立体阴影。
- 禁止堆图标(每页 ≤ 4 个),禁止与内容无关的装饰插画。
- 禁止全篇同一字号平铺,层级必须拉开。`,
};

const HAND_SKETCH: CoursewareStyle = {
  id: 'hand_sketch',
  name: '手绘白板',
  tagline: '暖米纸底、马克笔手写的白板讲解感',
  suit: '思路拆解、头脑风暴、轻松的复习课',
  palette: { bg: '#FBF7EE', primary: '#2A2A2A', accent: '#F2A93B', text: '#33302A' },
  promptTemplate: `你是一位 Sketchnote 视觉记录师,对标白板手绘讲解与工作坊记录。请生成 16:9 横版整页教学幻灯片。

【核心视觉】
- 背景:暖米白纸面 #FBF7EE,可见极淡纸张纹理与 5% 透明度的方格线。
- 主线:深炭灰 #2A2A2A(非纯黑),所有线条带手绘抖动感,不完全平直,端点略粗。
- 马克笔色(每页只用 2-3 种):荧光黄 #FFE066、天空蓝 #6FB7E0、柔红 #E56B6F、叶绿 #7BB661、橙 #FFB572。
- 强调方式:关键词用半透明马克笔色块涂抹高亮(能透出底下文字,边缘微微溢出)、圈出或加波浪下划线。

【字体】
- 标题:手写马克笔中文字体,略大略斜,笔画干净可读。
- 正文:清晰的手写体或圆体黑体小字,字号对比靠大小不靠字重。

【内容页构图】
- 白板会议感:每条要点装在手绘方框/圆角框/云朵框里,框与框之间用手绘箭头连出逻辑关系。
- 每条要点旁配一个手绘 monoline 简笔图标(灯泡、齿轮、对话气泡、人头等)。
- 右侧或下方留一块手绘示意区,画本页对应的草图(几何图、流程、对比),可贴一张便利贴写小结。

${TEACHING_CORE}

【禁止】
- 禁止完全平直的线条与标准几何形,一切图形必须有手绘感。
- 禁止渐变、3D、投影、玻璃质感与矢量平面图标。
- 禁止潦草到不可读的手写,禁止幼稚涂鸦式的杂乱堆砌。`,
};

const VECTOR_ILLUST: CoursewareStyle = {
  id: 'vector_illust',
  name: '复古矢量插画',
  tagline: '奶油底、黑描边色块的插画教学页',
  suit: '低年级课堂、情境导入、科普讲座',
  palette: { bg: '#F5EFDF', primary: '#E66565', accent: '#82C9A8', text: '#2A2118' },
  promptTemplate: `你是一位扁平化矢量插画师,对标复古印刷质感的教育插画。请生成 16:9 横版整页教学幻灯片。

【核心视觉】
- 背景:暖米黄 #F5EFDF 或奶油白 #F9F2E3,叠加几乎不可见的纸张颗粒。
- 主色板(每页选 3-4 色):珊瑚红 #E66565、薄荷绿 #82C9A8、芥末黄 #E2B441、赭石橙 #C97B45、岩石蓝 #4F7B8A。
- 描边:所有插画与图形统一 2.5px 深咖啡黑 #2A2118 monoline 描边,端点圆润。
- 阴影:仅允许同色系深 15% 的平面色块阴影,最多一层。

【字体】
- 标题:复古衬线粗体(思源宋体 Heavy 一类),有重量感。
- 正文:思源黑体 Regular,行高 1.5;小标题可加色块底反白。

【内容页构图】
- 用 2-4 个色块矩形分隔要点(珊瑚/薄荷/芥末轮换),每条要点配一个带黑描边的几何化小图标。
- 页面一侧放一条插画装饰带或一幅与内容相关的简化场景插画,插画必须服务讲解(演示对象、情境、类比),不是纯装饰。
- 整体密度中等,留白舒适,色块边缘对齐。

${TEACHING_CORE}

【禁止】
- 禁止 3D 渲染、光影、金属与玻璃质感。
- 禁止渐变(纸张颗粒除外)、禁止写实照片与写实人物。
- 禁止 outline-only 线性图标,图形必须实心填色 + 黑描边。`,
};

const DARK_TECH: CoursewareStyle = {
  id: 'dark_tech',
  name: '深色极简科技',
  tagline: '深空底、霓虹点缀的现代科技讲义',
  suit: '信息技术、理科前沿专题、讲座报告',
  palette: { bg: '#0A0A0F', primary: '#7B5BFF', accent: '#00D4FF', text: '#FFFFFF' },
  promptTemplate: `你是一位深色模式视觉设计师,对标 Linear / Vercel 式的克制深色界面。请生成 16:9 横版整页教学幻灯片。

【核心视觉】
- 背景:深空黑 #0A0A0F(不得纯黑 #000000),叠加中心略亮 #14142A 的极淡径向渐变,整体冷调。
- 极光:背景可有 1-2 道模糊弧形光带,颜色取紫 #7B5BFF / 青 #00D4FF / 粉 #FF7AB6,强度 25-40%,只做氛围。
- 卡片:半透明玻璃面 rgba(255,255,255,0.06) + 1px 顶部高光,圆角 16px。
- 文字:标题纯白 #FFFFFF,正文暖灰 #C8C8D8,辅助 #6B6B7E;强调色只用极光色。
- 图示:1.5-2px 发光描边的线性几何,端点可带微光点。

【字体】
- 标题:思源黑体 SemiBold,字号大而不溢出。
- 正文:思源黑体 Regular,深底白字略减字重避免刺眼。
- 数字:等宽数字字体,强调时配一道 1px 极光下划线。

【内容页构图】
- 左栏要点用发光小圆点或极细描边序号;右栏放本页的发光线框示意图(流程、结构、坐标、网络)。
- 每页发光区域 ≤ 2 处,保留大块深色留白;卡片间距均匀。
- 关键结论可用一条极光色短下划线锚定。

${TEACHING_CORE}

【禁止】
- 禁止刺眼正红/正绿/纯蓝,霓虹只取极光色板。
- 禁止深底配高饱和卡通图标,禁止堆满光晕。
- 禁止纯黑背景与低对比度的暗灰文字。`,
};

const SWISS_GRID: CoursewareStyle = {
  id: 'swiss_grid',
  name: '学术瑞士网格',
  tagline: '严格网格、大字号、极克制的学术版式',
  suit: '学术报告、公开评审、严肃数据讲解',
  palette: { bg: '#FFFFFF', primary: '#E10600', accent: '#000000', text: '#000000' },
  promptTemplate: `你是一位国际主义平面设计师,对标瑞士学派的模块化网格版式。请生成 16:9 横版整页教学幻灯片。

【核心视觉】
- 背景:纯白 #FFFFFF;章节页可整块使用单一纯色(红 #E10600 / 深蓝 #003DA5 / 黄 #FFE600),每页只允许一种。
- 文字:纯黑 #000000;色块上反白 #FFFFFF。
- 网格:严格 12 列基线网格,所有元素对齐网格;四角一律直角,无圆角、无阴影、无渐变。
- 装饰:唯一允许的装饰是实心色块(矩形、正圆、半圆),用于视觉重量平衡。

【字体】
- 全部无衬线(思源黑体 / 苹方 + Helvetica 风英文混排)。
- 标题:Bold/Heavy,字号巨大,行高 1.0-1.1。
- 正文:Regular,左对齐,绝不两端对齐,字距保持默认。

【内容页构图】
- 标题占满栏宽置于左上,下方一条 4px 黑色横线;要点用纯小圆点或短横线,分列在 4/8 列文本块中。
- 图示取最简形式:实心横条、纯圆环、无边框表格、对齐网格的线框几何,保留精确标签。
- 整页元素 ≤ 6 个,留白 ≥ 45%。

${TEACHING_CORE}

【禁止】
- 禁止圆角、阴影、渐变、3D、霓虹与玻璃效果。
- 禁止手写体、装饰字体与 emoji、卡通图标。
- 禁止居中正文,禁止一页堆多种色块(除黑白外每页 ≤ 1 种色)。`,
};

/** 五种内置风格(顺序即卡片顺序,首项为默认) */
export const COURSEWARE_STYLES: CoursewareStyle[] = [
  ACADEMIC_BLUE, HAND_SKETCH, VECTOR_ILLUST, DARK_TECH, SWISS_GRID,
];

/**
 * 自定义风格的护栏:老师的文字只决定「视觉主题/配色/装饰语汇」,
 * 教学幻灯片的骨架(横版、层级、中文准确、讲解性配图、无水印)由这段钉死。
 */
export const CUSTOM_GUARDRAIL = `请生成 16:9 横版整页教学幻灯片,严格遵守以下骨架要求(优先级高于风格描述):
- 版面为一整页幻灯片:页标题清晰醒目,下方 3-5 条要点分条排列,层级一眼可辨。
- 必须包含与本页内容对应的讲解性配图或示意(图解/流程/对比/坐标/公式标注),视觉要解释内容而非纯装饰。
- 中文文字、公式、单位必须准确、可读、无错字、无乱码;不得出现过小字号。
- 不出现水印、无关 logo,不虚构校名与机构名。
以下由授课教师描述本页的视觉主题与配色,只影响观感,不得改变上述骨架:`;

/** 自定义风格卡片(mock 出图用中性灰紫,避免暗示某种具体主题) */
export const CUSTOM_STYLE: CoursewareStyle = {
  id: CUSTOM_STYLE_ID,
  name: '自定义风格',
  tagline: '用你自己的话描述想要的视觉主题',
  suit: '内置风格都不合意时',
  palette: { bg: '#F5F4F8', primary: '#6B6480', accent: '#A79FC0', text: '#2B2836' },
  promptTemplate: CUSTOM_GUARDRAIL,
};

/** 卡片网格用:5 内置 + 1 自定义 */
export const STYLE_CARDS: CoursewareStyle[] = [...COURSEWARE_STYLES, CUSTOM_STYLE];

export function getStyle(styleId: string): CoursewareStyle {
  return STYLE_CARDS.find((s) => s.id === styleId) ?? COURSEWARE_STYLES[0];
}

/** 风格显示名(自定义风格带上老师描述的前若干字,便于第 2、3 步识别) */
export function styleLabel(choice: CoursewareStyleInput): string {
  const style = getStyle(choice.id);
  if (style.id !== CUSTOM_STYLE_ID) return style.name;
  const t = (choice.customText ?? '').trim();
  return t ? `${style.name} · ${t.length > 12 ? `${t.slice(0, 12)}…` : t}` : style.name;
}

/** 第 1 步风格校验:选了自定义就必须写清风格描述 */
export function validateStyle(choice: CoursewareStyleInput): string[] {
  if (choice.id !== CUSTOM_STYLE_ID) return [];
  return (choice.customText ?? '').trim() ? [] : ['选择自定义风格时,请描述你想要的视觉主题'];
}

/**
 * 组装风格前缀(真实链路每页提示词的第一段)。
 * - 内置风格:直接返回该风格的 promptTemplate。
 * - 自定义风格:固定护栏 + 老师原文。
 * - 未知 id / 自定义但描述为空:退回默认风格模板 —— 防御性兜底,保证任何情况下都不会发出无风格提示词
 *   (界面侧已用 validateStyle 拦住空描述,这里只是最后一道保险)。
 */
export function composeStylePrefix(styleId: string, customText?: string): string {
  if (styleId === CUSTOM_STYLE_ID) {
    const t = (customText ?? '').trim();
    return t ? `${CUSTOM_GUARDRAIL}\n${t}` : getStyle(DEFAULT_STYLE_ID).promptTemplate;
  }
  const style = STYLE_CARDS.find((s) => s.id === styleId);
  return (style && style.id !== CUSTOM_STYLE_ID ? style : getStyle(DEFAULT_STYLE_ID)).promptTemplate;
}

/**
 * 单页最终提示词 = 风格前缀 + 本页完整内容(标题 + 完整句要点 + 配图说明)+ 页码 n/N。
 * 真实后端应在入队时用同一口径组装(见 pages/courseware/README.md「真实链路提示词规范」)。
 */
export function composePagePrompt(input: {
  style: CoursewareStyleInput;
  page: { title: string; body: string; imagePrompt: string };
  seq: number;
  total: number;
}): string {
  const { style, page, seq, total } = input;
  const bullets = page.body
    .split('\n')
    .map((l) => l.replace(/^[·•\-\s]+/, '').trim())
    .filter(Boolean)
    .map((l) => `- ${l}`)
    .join('\n');
  return [
    composeStylePrefix(style.id, style.customText),
    '',
    '【本页内容】',
    `页标题:${page.title.trim()}`,
    bullets ? `要点(逐条排版,保持完整句):\n${bullets}` : '要点:无',
    page.imagePrompt.trim() ? `配图与版式:${page.imagePrompt.trim()}` : '',
    `页码:右下角标注「${seq}/${total}」`,
  ].filter(Boolean).join('\n');
}
