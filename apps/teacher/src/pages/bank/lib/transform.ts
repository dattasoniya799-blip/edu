/**
 * 编辑器表单 ↔ 契约数据 的纯变换(类型全部来自 @qiming/contracts,便于单测)
 */
import type { GraphType, QuestionDto, QuestionFigure, QuestionType, RubricStep } from '@qiming/contracts';

/** 插图锚点(方案 A,2026-06-13 批准):缺省=题干 */
export type FigureAnchor = NonNullable<QuestionFigure['anchor']>;

// ---------- 展示用映射 ----------
/**
 * 学科常量:题库录题/筛选、组卷选题弹窗的唯一来源(勿在各处复制字面量)。
 * 题库列表页与组卷选题器的「学科」筛选、EditorPage 的学科下拉均复用此表。
 */
export const SUBJECTS = ['数学', '物理', '化学', '语文', '英语'] as const;

export const TYPE_LABEL: Record<QuestionType, string> = {
  single: '单选题', multi: '多选题', blank: '填空题', solution: '解答题',
};
export const TYPE_TONE: Record<QuestionType, 'primary' | 'violet' | 'green'> = {
  single: 'primary', multi: 'primary', blank: 'violet', solution: 'green',
};
export const DIFF_LABEL: Record<number, string> = { 1: '容易', 2: '中等', 3: '困难' };
export const STATUS_LABEL: Record<QuestionDto['status'], string> = {
  draft: '草稿', published: '已入库', retired: '已下架',
};

/**
 * 是否允许"提交入库"(调用 /questions/:id/publish)。
 * 后端仅允许草稿入库(已 published/retired 再 publish → 400)。
 * 新题(status=null,尚未创建)按草稿处理:草稿 → 可入库;已入库题只能保存修改。
 */
export function canPublishQuestion(status: QuestionDto['status'] | null): boolean {
  return status == null || status === 'draft';
}
export const GRAPH_LABEL: Record<GraphType, string> = {
  curriculum_knowledge: '教材知识点',
  problem_solving_ability: '解题能力',
  problem_solving_strategy: '解题策略',
};

/** 图谱展示名:多学科图谱并存后,类型名前带学科(否则数理化三张"教材知识点"无法区分) */
export function graphLabel(g: { subject: string; graphType: GraphType }): string {
  return `${g.subject} · ${GRAPH_LABEL[g.graphType]}`;
}

/** "6 月 2 日" 风格日期(原型 q-meta 口径) */
export function formatDateCn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

// ---------- 编辑器表单 ----------
export interface TagPick { nodeId: number; graphType: GraphType; code: string; name: string }
export interface FigureItem {
  ossKey: string; position: number;
  /** 插图归属位置(方案 A);缺省=题干,向后兼容旧数据 */ anchor?: FigureAnchor;
  /** 本地预览(objectURL,仅前端态,不入库) */ previewUrl?: string; fileName?: string;
}
export interface OptionRow { label: string; contentLatex: string; isCorrect: boolean }

export interface QuestionForm {
  type: QuestionType;
  stage: string; subject: string;
  textbookVersion: string; chapter: string;
  stemLatex: string;
  figures: FigureItem[];
  options: OptionRow[];        // single/multi
  blankAnswers: string[];      // blank
  referenceLatex: string;      // solution
  rubric: RubricStep[];        // solution
  analysisBriefLatex: string;  // 简单解析(C2 #7)
  analysisLatex: string;       // 正常解析
  analysisDetailLatex: string; // 详细解析(C2 #7)
  difficulty: number;
  tags: TagPick[];
}

export const DEFAULT_OPTIONS: OptionRow[] = ['A', 'B', 'C', 'D'].map((label) => ({
  label, contentLatex: '', isCorrect: false,
}));

export function emptyForm(): QuestionForm {
  return {
    type: 'single', stage: '初中', subject: '数学',
    textbookVersion: '人教版', chapter: '第十九章 一次函数',
    stemLatex: '', figures: [],
    options: DEFAULT_OPTIONS.map((o) => ({ ...o })),
    blankAnswers: [''], referenceLatex: '', rubric: [],
    analysisBriefLatex: '', analysisLatex: '', analysisDetailLatex: '', difficulty: 2, tags: [],
  };
}

/** 选项源码 → 存储/预览口径:无 $ 的裸 LaTeX 自动包 $..$(原型 renderOpt 行为) */
export function normalizeOptionLatex(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  return v.includes('$') ? v : `$${v}$`;
}

/** /questions 写接口请求体(形状 = openapi QuestionInput) */
export interface QuestionInputBody {
  type: QuestionType; stage: string; subject: string;
  textbookVersion?: string; chapter?: string;
  stemLatex: string; figures?: QuestionFigure[];
  options?: { label: string; contentLatex: string; isCorrect?: boolean }[];
  answer:
    | { choice: string } | { choices: string[] }
    | { texts: string[] } | { referenceLatex: string };
  rubric?: RubricStep[];
  analysisBriefLatex?: string; analysisLatex?: string; analysisDetailLatex?: string;
  difficulty?: number; tagNodeIds?: number[];
}

/** 表单 → QuestionInput(题型联动:answer/options/rubric 按题型取舍) */
export function formToInput(f: QuestionForm): QuestionInputBody {
  const usedOptions = (f.type === 'single' || f.type === 'multi')
    ? f.options
      .filter((o) => o.contentLatex.trim() !== '')
      .map((o) => ({ label: o.label, contentLatex: normalizeOptionLatex(o.contentLatex), isCorrect: o.isCorrect }))
    : [];
  const answer: QuestionInputBody['answer'] =
    f.type === 'single' ? { choice: usedOptions.find((o) => o.isCorrect)?.label ?? '' }
      : f.type === 'multi' ? { choices: usedOptions.filter((o) => o.isCorrect).map((o) => o.label) }
        : f.type === 'blank' ? { texts: f.blankAnswers.map((t) => t.trim()).filter(Boolean) }
          : { referenceLatex: f.referenceLatex.trim() };
  return {
    type: f.type, stage: f.stage, subject: f.subject,
    textbookVersion: f.textbookVersion || undefined,
    chapter: f.chapter || undefined,
    stemLatex: f.stemLatex,
    // 写库:保留 anchor(选项/解析/参考答案/评分要点);题干图 anchor 缺省=stem
    figures: f.figures.map((x, i) => ({
      ossKey: x.ossKey, position: i + 1,
      ...(x.anchor && x.anchor.target !== 'stem' ? { anchor: x.anchor } : {}),
    })),
    options: usedOptions,
    answer,
    rubric: f.type === 'solution' ? f.rubric : [],
    analysisBriefLatex: f.analysisBriefLatex.trim() || undefined,
    analysisLatex: f.analysisLatex.trim() || undefined,
    analysisDetailLatex: f.analysisDetailLatex.trim() || undefined,
    difficulty: f.difficulty,
    tagNodeIds: f.tags.map((t) => t.nodeId),
  };
}

/** 题目详情 → 表单(编辑模式回填) */
export function questionToForm(q: QuestionDto): QuestionForm {
  const f = emptyForm();
  f.type = q.type; f.stage = q.stage; f.subject = q.subject;
  f.textbookVersion = q.textbookVersion ?? ''; f.chapter = q.chapter ?? '';
  f.stemLatex = q.stemLatex;
  f.figures = q.figures.map((x) => ({ ossKey: x.ossKey, position: x.position, anchor: x.anchor }));
  if (q.options.length > 0) {
    f.options = q.options.map((o) => ({ label: o.label, contentLatex: o.contentLatex, isCorrect: o.isCorrect === true }));
    while (f.options.length < 4) f.options.push({ label: 'ABCDEFGH'[f.options.length], contentLatex: '', isCorrect: false });
  }
  const a = q.answer;
  if (a) {
    if ('choice' in a) f.options = f.options.map((o) => ({ ...o, isCorrect: o.isCorrect || o.label === a.choice }));
    else if ('choices' in a) f.options = f.options.map((o) => ({ ...o, isCorrect: o.isCorrect || a.choices.includes(o.label) }));
    else if ('texts' in a) f.blankAnswers = a.texts.length > 0 ? [...a.texts] : [''];
    else if ('referenceLatex' in a) f.referenceLatex = a.referenceLatex;
  }
  f.rubric = q.rubric.map((r) => ({ ...r }));
  f.analysisBriefLatex = q.analysisBriefLatex ?? '';
  f.analysisLatex = q.analysisLatex ?? '';
  f.analysisDetailLatex = q.analysisDetailLatex ?? '';
  f.difficulty = q.difficulty;
  f.tags = q.tags.map((t) => ({ ...t }));
  return f;
}
