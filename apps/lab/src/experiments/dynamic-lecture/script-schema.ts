/**
 * 讲解剧本(LectureScript)—— 动态讲义的中枢数据契约。
 *
 * 产品原则(见 _research/产品方案-动态讲义-2026-08-30.md):
 * - AI 供应商只负责"填剧本",格式不变则换模型/换 API 不影响任何端;
 * - 屏显(display,可含 $..$ 公式)与口语讲稿(narration,给 TTS,禁符号/禁 markdown)分开两份;
 * - 每步的画面变化是声明式动作(sceneActions),播放器按步重放,任意步幂等可达;
 * - reference 自查算例是质检门的依据:机器代入核对,不过则打回重生成。
 */
import { z } from 'zod';
import { compileExpr, extractTemplateExprs } from './expr';

/** 语义色:剧本只写语义,不写色值;渲染器映射到 design-tokens(裸色禁令延伸到剧本数据) */
export const semanticColorSchema = z.enum(['primary', 'orange', 'green', 'red', 'violet', 'muted']);
export type SemanticColor = z.infer<typeof semanticColorSchema>;

/** 场景可调参数(ArchSight 字段表:label/min/max/step/unit) */
export const sceneParamSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, '参数 id 须为合法标识符'),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  initial: z.number(),
  unit: z.string().optional(),
});
export type SceneParam = z.infer<typeof sceneParamSchema>;

/**
 * 场景元素:受控白名单,LLM 只能从这几种里选(不写代码)。
 * expr 为受限表达式字符串(变量 x + 参数名 + 白名单函数),由 expr.ts 安全编译,绝不 eval 任意代码。
 */
export const sceneElementSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('functiongraph'),
    id: z.string(),
    expr: z.string(),
    color: semanticColorSchema.optional(),
    dash: z.boolean().optional(),
    hidden: z.boolean().optional(),
    label: z.string().optional(),
    /** 定义域(可引用参数名) */
    domain: z.tuple([z.union([z.number(), z.string()]), z.union([z.number(), z.string()])]).optional(),
  }),
  z.object({
    kind: z.literal('point'),
    id: z.string(),
    /** 坐标可为数值或受限表达式(可引用参数) */
    x: z.union([z.number(), z.string()]),
    y: z.union([z.number(), z.string()]),
    label: z.string().optional(),
    color: semanticColorSchema.optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('segment'),
    id: z.string(),
    from: z.tuple([z.union([z.number(), z.string()]), z.union([z.number(), z.string()])]),
    to: z.tuple([z.union([z.number(), z.string()]), z.union([z.number(), z.string()])]),
    color: semanticColorSchema.optional(),
    dash: z.boolean().optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('text'),
    id: z.string(),
    x: z.union([z.number(), z.string()]),
    y: z.union([z.number(), z.string()]),
    /** 支持 {表达式:小数位} 实时插值,如 "y = {0.5*m+12:1} cm" */
    text: z.string(),
    color: semanticColorSchema.optional(),
    hidden: z.boolean().optional(),
  }),
  /**
   * 台阶标注(移植自已验收的一次函数动画):在 x=atParam 处画 Δx / Δy 台阶 + 行走标记,
   * 把"变化率"读成一个可数的抬升动作。挂在某条曲线的表达式上。
   */
  z.object({
    kind: z.literal('ladder'),
    id: z.string(),
    expr: z.string(),
    atParam: z.string(),
    dx: z.number().positive().default(1),
    color: semanticColorSchema.optional(),
    hidden: z.boolean().optional(),
  }),
]);
export type SceneElement = z.infer<typeof sceneElementSchema>;

/** 场景族:MVP 先做坐标系族(函数/运动图像/电学 U-I 图通吃);几何族二批 */
export const sceneSpecSchema = z.object({
  family: z.literal('coordinate'),
  board: z.object({
    xMin: z.number(),
    xMax: z.number(),
    yMin: z.number(),
    yMax: z.number(),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
    /** 网格与等比例(几何感强的题开等比例) */
    grid: z.boolean().optional(),
    keepAspect: z.boolean().optional(),
  }),
  params: z.array(sceneParamSchema).default([]),
  elements: z.array(sceneElementSchema),
  /** 画布左上角实时读数(每帧按当前参数求值),如 "x = {m:1} kg → y = {0.5*m+12:1} cm" */
  readouts: z
    .array(z.object({ template: z.string(), color: semanticColorSchema.optional() }))
    .optional(),
});
export type SceneSpec = z.infer<typeof sceneSpecSchema>;

/** 每步的画面动作(声明式;播放器从第 0 步重放到当前步,保证任意步幂等) */
export const sceneActionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('show'), target: z.string() }),
  z.object({ op: z.literal('hide'), target: z.string() }),
  z.object({ op: z.literal('highlight'), target: z.string() }),
  z.object({ op: z.literal('setParam'), param: z.string(), value: z.number() }),
  /** 参数扫描:讲解期间参数从 from 平滑走到 to(小结"再看一遍全过程"用) */
  z.object({
    op: z.literal('sweepParam'),
    param: z.string(),
    from: z.number(),
    to: z.number(),
    seconds: z.number().positive(),
  }),
]);
export type SceneAction = z.infer<typeof sceneActionSchema>;

/** 可选预测小问(三选一;铁律:预测不是门禁,不答也能继续) */
export const stepQuizSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).length(3),
  answerIndex: z.number().int().min(0).max(2),
  /** 揭示时的一句话讲解(V8 概念反馈:说规律,不只说对错) */
  reveal: z.string(),
});
export type StepQuiz = z.infer<typeof stepQuizSchema>;

const FORBIDDEN_SPEECH = /我来画|接下来添加|让我画|我来添加/;

export const lectureStepSchema = z.object({
  id: z.string(),
  /** 步骤短名(步骤条显示),如「读题」「建函数」 */
  label: z.string().min(2).max(8),
  /** 屏显讲解,可含 $..$ 行内公式(TexText 渲染) */
  display: z.string(),
  /** 口语讲稿,给 TTS:说出来的话,无符号无 markdown,不播报动作(OpenMAIC 讲稿规范) */
  narration: z.string().refine((t) => !FORBIDDEN_SPEECH.test(t), '讲稿不许播报自己的动作'),
  sceneActions: z.array(sceneActionSchema).default([]),
  /** 本步开放的操作:至多一个参数(ArchSight 单变量原则) */
  interaction: z
    .object({
      paramId: z.string(),
      /** 操作提示,如「拖动滑杆,观察 y 怎么变」 */
      prompt: z.string(),
      /** 一键调到目标值(可选) */
      targetValue: z.number().optional(),
      /** 实时反馈模板(随滑杆更新),如「挂 {m:1} kg,长 {0.5*m+12:1} cm」 */
      feedback: z.string().optional(),
    })
    .optional(),
  quiz: stepQuizSchema.optional(),
  /** 三级支架:看哪里 / 用什么关系 / 完整提示(ArchSight focus→relation→extension) */
  scaffolds: z.tuple([z.string(), z.string(), z.string()]).optional(),
});
export type LectureStep = z.infer<typeof lectureStepSchema>;

export const lectureScriptBaseSchema = z.object({
  schemaVersion: z.literal('0.1'),
  /** 稳定别名(uniName 风格,人类可读,跨版本不变) */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** concept=知识点课,无原题;problem=讲题课,必有原题 */
  kind: z.enum(['concept', 'problem']),
  subject: z.enum(['math', 'physics']),
  /** 学段(术语门用,如「八年级下」;超纲词黑名单在管线层校验) */
  grade: z.string().optional(),
  title: z.string(),
  /** 学生 60 秒内应得到的结论;知识点课必填 */
  goal: z.string().optional(),
  problem: z
    .object({
      /** 原题文字,可含 $..$ 公式 */
      text: z.string(),
      /** 出处(某年某地中考/高考) */
      source: z.string().optional(),
    })
    .optional(),
  /** 元认知字段(喂教师端展示与后续答疑;ArchSight difficultIdea/misconceptions) */
  difficultIdea: z.string().optional(),
  misconceptions: z.array(z.string()).optional(),
  scene: sceneSpecSchema,
  steps: z.array(lectureStepSchema).min(5),
  /** 自查算例:desc 给人读;checks 给机器跑(expr 应等于 expected,tol 容差) */
  reference: z
    .array(
      z.object({
        desc: z.string(),
        expr: z.string(),
        params: z.record(z.string(), z.number()).default({}),
        expected: z.number(),
        tol: z.number().default(1e-6),
      }),
    )
    .optional(),
});

/** 收集一个元素里的全部表达式字符串(引用完整性校验用) */
function collectExprStrings(e: SceneElement): string[] {
  const out: string[] = [];
  const push = (v: number | string | undefined) => {
    if (typeof v === 'string') out.push(v);
  };
  if (e.kind === 'functiongraph') {
    out.push(e.expr);
    if (e.domain) {
      push(e.domain[0]);
      push(e.domain[1]);
    }
  } else if (e.kind === 'point') {
    push(e.x);
    push(e.y);
  } else if (e.kind === 'segment') {
    push(e.from[0]);
    push(e.from[1]);
    push(e.to[0]);
    push(e.to[1]);
  } else if (e.kind === 'text') {
    push(e.x);
    push(e.y);
  } else if (e.kind === 'ladder') {
    out.push(e.expr);
  }
  return out;
}

/**
 * 引用完整性 + 表达式可编译性校验(质检门第一道):
 * 元素 id 唯一、动作 target/param 存在、互动参数存在、全部表达式(含模板占位符)可编译。
 * 这道门挡的是「画面看不出错,只是不对」的静默缺陷。
 */
export const lectureScriptSchema = lectureScriptBaseSchema.superRefine((s, ctx) => {
  const bad = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path });
  if (s.kind === 'concept' && !s.goal?.trim()) bad('知识点课必须写 goal(一句话结论)', ['goal']);
  if (s.kind === 'problem' && !s.problem?.text.trim()) bad('讲题课必须有原题', ['problem']);
  if (!s.steps.some((st) => st.interaction)) bad('全课至少要有一拍让学生动手', ['steps']);
  const elemIds = new Set<string>();
  for (const e of s.scene.elements) {
    if (elemIds.has(e.id)) bad(`元素 id「${e.id}」重复`, ['scene', 'elements']);
    elemIds.add(e.id);
  }
  const paramIds = new Set(s.scene.params.map((p) => p.id));
  const allowed = ['x', ...paramIds];
  const { board } = s.scene;
  if (board.xMax <= board.xMin) bad('xMax 必须大于 xMin', ['scene', 'board']);
  if (board.yMax <= board.yMin) bad('yMax 必须大于 yMin', ['scene', 'board']);

  const tryCompile = (raw: string, where: string, path: (string | number)[]) => {
    try {
      compileExpr(raw, allowed);
    } catch (err) {
      bad(`${where} 表达式「${raw}」不可用:${err instanceof Error ? err.message : String(err)}`, path);
    }
  };
  for (const [i, e] of s.scene.elements.entries()) {
    for (const raw of collectExprStrings(e)) tryCompile(raw, `元素「${e.id}」`, ['scene', 'elements', i]);
    const templates: string[] = [];
    if (e.kind === 'text') templates.push(e.text);
    if ((e.kind === 'point' || e.kind === 'functiongraph') && e.label) templates.push(e.label);
    for (const tpl of templates) {
      for (const raw of extractTemplateExprs(tpl)) tryCompile(raw, `元素「${e.id}」模板`, ['scene', 'elements', i]);
    }
    if (e.kind === 'ladder' && !paramIds.has(e.atParam)) {
      bad(`台阶「${e.id}」指向不存在的参数「${e.atParam}」`, ['scene', 'elements', i]);
    }
  }
  for (const r of s.scene.readouts ?? []) {
    for (const raw of extractTemplateExprs(r.template)) tryCompile(raw, '读数模板', ['scene', 'readouts']);
  }
  for (const [i, st] of s.steps.entries()) {
    for (const a of st.sceneActions) {
      if ((a.op === 'show' || a.op === 'hide' || a.op === 'highlight') && !elemIds.has(a.target)) {
        bad(`第 ${i + 1} 步动作指向不存在的元素「${a.target}」`, ['steps', i]);
      }
      if ((a.op === 'setParam' || a.op === 'sweepParam') && !paramIds.has(a.param)) {
        bad(`第 ${i + 1} 步动作指向不存在的参数「${a.param}」`, ['steps', i]);
      }
    }
    if (st.interaction) {
      if (!paramIds.has(st.interaction.paramId)) bad(`第 ${i + 1} 步互动参数「${st.interaction.paramId}」不存在`, ['steps', i]);
      if (st.interaction.feedback) {
        for (const raw of extractTemplateExprs(st.interaction.feedback)) tryCompile(raw, `第 ${i + 1} 步反馈模板`, ['steps', i]);
      }
    }
  }
});

/** 解析后的剧本(引擎/播放器读这个;.default 字段已补齐) */
export type LectureScript = z.infer<typeof lectureScriptSchema>;
/** 手写/LLM 产出侧的剧本(.default 字段可省;与生成管线同一入口) */
export type LectureScriptInput = z.input<typeof lectureScriptSchema>;

/** 解析 + 校验入口:管线与手写样例统一走这里 */
export function parseLectureScript(raw: unknown): LectureScript {
  return lectureScriptSchema.parse(raw);
}
