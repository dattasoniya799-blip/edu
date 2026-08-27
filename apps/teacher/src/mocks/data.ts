/**
 * msw mock 数据(三端共用同一份,集中于 src/mocks/,禁止散落组件)
 * 口径 = W0 seed(apps/server/prisma/seed.ts):
 *   机构「鲸云演示机构」· 管理员 13800000001/Admin@123 · 教师 13800000002|3/Teacher@123
 *   12 名学生 · 2 门课程 · 6 讲次 · 30 题 · 第 3 讲作业已批改
 *   学生登录:学号 S-0001…S-0012 + 统一演示密码 Student@123(密码登录,取代旧登录码)
 */
import type {
  MeDto, TeacherDto, StudentDto, CourseDto, LessonDto, LessonSegmentDto, ResourceDto,
  KpGraphDto, KpNodeDto, QuestionDto, PaperDto, AssignmentDto, AttemptDto,
  WrongBookItemDto, MasteryItemDto, AiUsageSummaryDto, AiUsageBreakdownDto, GradingItemDto,
  AiDiagnosisDto, CoursewareStyleInput,
} from '@qiming/contracts';
// 界面/资源 mock 的配色取设计令牌(禁止裸写十六进制)。这里直指 design-tokens 模块而非包入口:
// 包入口是 export * 汇总,tsx(test:mock 冒烟脚本)无法链接其运行时命名导出,只有类型导入可用。
import { colors } from '../../../../packages/contracts/src/design-tokens';
// 幻灯片 mock 出图的配色/提示词取自风格模板库(前端唯一事实,后端实现时整体迁到 ai/config)
import {
  CUSTOM_STYLE_ID, DEFAULT_STYLE_ID, composePagePrompt, getStyle, styleLabel,
} from '../pages/courseware/lib/styles';
import { abilityNodes, strategyNodes } from './kpAbilityStrategyNodes';

const ORG = '鲸云演示机构';
const orgSettings: MeDto['orgSettings'] = {
  ai: { qaGuideOnly: true, preGrading: true, classCompanion: true, diagnosis: true },
  studentHours: { start: '06:00', end: '22:30' },
};

export const ME_ADMIN: MeDto = { id: 1, orgId: 1, role: 'admin', name: '王校长', orgName: ORG, orgSettings };
export const ME_TEACHER: MeDto = { id: 2, orgId: 1, role: 'teacher', name: '张明', orgName: ORG, orgSettings };
export const ME_TEACHER2: MeDto = { id: 3, orgId: 1, role: 'teacher', name: '李雯', orgName: ORG, orgSettings };
export const ME_STUDENT: MeDto = { id: 4, orgId: 1, role: 'student', name: '林小满', orgName: ORG, orgSettings };

/** 账密(与 seed 演示密码一致) */
export const ACCOUNTS: { phone: string; password: string; me: MeDto }[] = [
  { phone: '13800000001', password: 'Admin@123', me: ME_ADMIN },
  { phone: '13800000002', password: 'Teacher@123', me: ME_TEACHER },
  { phone: '13800000003', password: 'Teacher@123', me: ME_TEACHER2 },
];

export const STUDENT_NAMES = ['林小满', '周子航', '吴佳怡', '郑一鸣', '许诺', '王浩然', '刘思琪', '陈嘉树', '赵雨桐', '孙铭', '黄子睿', '李一诺'];

export const teachers: TeacherDto[] = [
  { id: 2, name: '张明', teacherNo: 'T-0001', phone: '13800000002', stage: '初中', subject: '数学', status: 'active', courseCount: 2, questionCount: 30, resourceCount: 2 },
  { id: 3, name: '李雯', teacherNo: 'T-0002', phone: '13800000003', stage: '初中', subject: '数学', status: 'active', courseCount: 0, questionCount: 0, resourceCount: 0 },
];

export const students: StudentDto[] = STUDENT_NAMES.map((name, i) => ({
  id: 4 + i,
  name,
  studentNo: `S-${String(i + 1).padStart(4, '0')}`,
  parentPhone: `1390000${String(i + 1).padStart(4, '0')}`,
  grade: '初二',
  status: 'active',
  courses: [
    { id: 1, name: '初二数学提高班', classType: 'group' as const },
    ...(name === '李一诺' ? [{ id: 2, name: '李一诺 · 数学培优', classType: 'one_on_one' as const }] : []),
  ],
  weekStudySec: 3600 * 4 + i * 1234,
}));

/** 学生账密登录(mock 口径):学号 + 统一演示密码;取代旧的扫码/登录码 */
export const STUDENT_PASSWORD = 'Student@123';
export const STUDENT_LOGINS: Record<string, MeDto> = Object.fromEntries(
  STUDENT_NAMES.map((name, i) => [
    `S-${String(i + 1).padStart(4, '0')}`,
    { id: 4 + i, orgId: 1, role: 'student' as const, name, orgName: ORG, orgSettings },
  ]),
);

export const courses: CourseDto[] = [
  {
    id: 1, name: '初二数学提高班', classType: 'group', subject: '数学', stage: '初中',
    teacherId: 2, teacherName: '张明', totalLessons: 15, currentLesson: 4, studentCount: 12,
    status: 'ongoing', nextLessonAt: '2026-06-13T06:00:00.000Z', attendanceRate: 94.2, homeworkRate: 91,
  },
  {
    id: 2, name: '李一诺 · 数学培优', classType: 'one_on_one', subject: '数学', stage: '初中',
    teacherId: 2, teacherName: '张明', totalLessons: 16, currentLesson: 1, studentCount: 1,
    status: 'ongoing', nextLessonAt: '2026-06-17T10:00:00.000Z', attendanceRate: null, homeworkRate: null,
  },
];

const LESSON_TITLES = ['一次函数的概念', '函数的图象与性质', '待定系数法求解析式', '一次函数的图象平移', '一次函数与方程、不等式', '单元复习与测验'];
// B4:第 4 讲初始 status=draft(seed 落库为 ready,但与其 checklist.homework=false 互斥;
// 按 A4 publish 语义「检查通过才 ready」取 draft,使「发布后讲次状态变 ready」可演示,其余口径同 seed)
export const lessons: LessonDto[] = LESSON_TITLES.map((t, i) => {
  const start = new Date(Date.UTC(2026, 4, 23, 6, 0));
  start.setUTCDate(start.getUTCDate() + i * 7);
  return {
    id: i + 1, courseId: 1, seq: i + 1, title: `第${i + 1}讲 · ${t}`,
    scheduledStart: start.toISOString(),
    scheduledEnd: new Date(start.getTime() + 2 * 3600e3).toISOString(),
    status: i < 3 ? 'finished' as const : 'draft' as const,
    prepChecklist: (i === 3 ? { practice: true, homework: false } : {}) as Record<string, boolean>,
    // C2 #5:开场白配置(可空);第 4 讲 seed 带一段开场引导,验证 openingConfig 读写往返
    openingConfig: i === 3
      ? { enabled: true, text: '上节课我们认识了一次函数的图象,这节课一起研究图象的平移规律。', resourceId: null }
      : null,
    // [2026-06-14 B6 课堂] 当前讲次最新未结束 ClassSession id(供监控连 WS);口径=最新非 ended 会话。
    // 本 mock 无在开讲次(finished/draft),故恒 null;监控 mock 流自带帧,不依赖此值。
    sessionId: null,
  };
});

// C2 #5:知识点单元式编排 —— 同 unitSeq + kpNodeId 的 lecture/practice/summary 三段为一个知识点单元。
export const segments: Record<number, LessonSegmentDto[]> = {
  4: [
    { id: 2, seq: 1, type: 'lecture', durationMin: 35, config: { checkpoints: [3, 8, 12, 18, 22] }, resourceId: 1, paperId: null, kpNodeId: 102, kpNodeName: '一次函数的图象', unitSeq: 1 },
    { id: 3, seq: 2, type: 'practice', durationMin: 30, config: { ai_guide: true, stuck_alert_min: 3 }, resourceId: null, paperId: 1, kpNodeId: 102, kpNodeName: '一次函数的图象', unitSeq: 1 },
    { id: 4, seq: 3, type: 'summary', durationMin: 25, config: { personal_consolidation: { min: 2, max: 4 } }, resourceId: null, paperId: null, kpNodeId: 102, kpNodeName: '一次函数的图象', unitSeq: 1 },
  ],
};

export const resources: ResourceDto[] = [
  {
    id: 1, type: 'interactive', name: '函数图象平移 · 动画演示', ossKey: 'demo/courseware/translation.html',
    size: 2457600, meta: { pages: 24, checkpoints: [3, 8, 12, 18, 22] },
    usedByLessons: [{ lessonId: 4, lessonTitle: '第4讲 · 一次函数的图象平移' }],
    kpNodeId: 102, kpNodeName: '一次函数的图象', createdAt: '2026-05-20T03:00:00.000Z',
  },
  {
    id: 2, type: 'video', name: '待定系数法 · 微课视频', ossKey: 'demo/video/undetermined.mp4',
    size: 104857600, meta: { durationSec: 756 }, usedByLessons: [],
    kpNodeId: 103, kpNodeName: '待定系数法', createdAt: '2026-05-21T03:00:00.000Z',
  },
];

export const kpGraphs: KpGraphDto[] = [
  { id: 1, code: 'pep-math-junior', graphType: 'curriculum_knowledge', subject: '数学', nodeCount: 312 },
  // FIX2 问题2:节点数对齐真实图谱(能力 41 / 策略 35,见 IMPORT_REPORT.md)
  { id: 2, code: 'ability-math', graphType: 'problem_solving_ability', subject: '数学', nodeCount: abilityNodes.length },
  { id: 3, code: 'strategy-math', graphType: 'problem_solving_strategy', subject: '数学', nodeCount: strategyNodes.length },
];

const KP_NAMES = ['一次函数的概念', '一次函数的图象', '待定系数法', '图象的平移', '一次函数与方程', '函数增减性'];
/** 知识点教材正文(content,本次契约透出;按 KP_NAMES 顺序对应,内容库页左树展示) */
const KP_CONTENT: string[] = [
  '形如 $y=kx+b$($k,b$ 为常数,$k\\neq 0$)的函数,叫做一次函数。当 $b=0$ 时 $y=kx$ 是正比例函数,是一次函数的特例。',
  '一次函数 $y=kx+b$ 的图象是一条直线,常称作直线 $y=kx+b$。它与 $y$ 轴交于 $(0,b)$,与 $x$ 轴交于 $(-\\dfrac{b}{k},0)$。',
  '已知函数类型与若干条件,先设出含待定字母的解析式,再代入条件列方程(组)求出字母,这种方法叫待定系数法。',
  '直线 $y=kx+b$ 上下平移只改变 $b$:向上平移 $m$ 个单位得 $y=kx+b+m$,向下得 $y=kx+b-m$,即“上加下减”。',
  '一次函数与一元一次方程、不等式密切相关:$kx+b=0$ 的解即图象与 $x$ 轴交点的横坐标。',
  '当 $k>0$ 时 $y$ 随 $x$ 增大而增大;当 $k<0$ 时 $y$ 随 $x$ 增大而减小。',
];
// FIX2 问题2:能力/策略维度改用真实图谱全量节点(能力 41 / 策略 35),供三维标注选择器显示完整。
// 30 题的 ability/strategy tag 从全量节点取叶子,保持 id/code/name 一致。
export const kpNodes: KpNodeDto[] = [
  ...KP_NAMES.map((name, i): KpNodeDto => ({
    id: 101 + i, graphId: 1, code: `PEP-19-${i + 1}`, name, parentCode: 'PEP-19', level: 3,
    category: '知识点', grade: '初二', chapter: '第十九章 一次函数', section: `19.${i + 1}`,
    difficulty: 1 + (i % 3), examWeight: 0.6 + i * 0.05, summary: null, content: KP_CONTENT[i] ?? null,
  })),
  ...abilityNodes,
  ...strategyNodes,
];

/** 演示题打标用的叶子节点(level 2 优先,贴近真实标注粒度) */
const ABILITY_TAG_NODES = abilityNodes.filter((n) => (n.level ?? 1) >= 2);
const STRATEGY_TAG_NODES = strategyNodes.filter((n) => (n.level ?? 1) >= 2);

/** 30 道题:与 seed 同一确定性生成逻辑(单选/单选/填空/解答 循环) */
function genQuestions(): QuestionDto[] {
  const out: QuestionDto[] = [];
  for (let i = 0; i < 30; i++) {
    const type = (['single', 'single', 'blank', 'solution'] as const)[i % 4];
    const k = 2 + (i % 5);
    const b = i % 2 ? 1 + (i % 4) : -(1 + (i % 4));
    const d = 1 + (i % 4);
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    const stem = type === 'solution'
      ? `将直线 $y=kx+b$ 向下平移 $${d}$ 个单位后恰好经过点 $A(1,${k + b})$ 与点 $B(-1,${-k + b})$,求原直线的解析式。(写出完整过程)`
      : type === 'blank'
        ? `一次函数的图象经过点 $(1, ${k + b})$ 和 $(-1, ${-k + b})$,则该函数的解析式为 ________。`
        : `将直线 $y=${k}x${sign(b)}$ 向下平移 $${d}$ 个单位长度后,所得直线的解析式为(  )`;
    const answer = type === 'single' ? { choice: 'B' }
      : type === 'blank' ? { texts: [`y=${k}x${sign(b)}`] }
        : { referenceLatex: `设平移后直线 $y=kx+b'$,代入两点得 $k=${k},\\ b'=${b}$;还原:$b=${b}+${d}$,原直线 $y=${k}x${sign(b + d)}$。` };
    const options = type === 'single'
      ? [`y=${k}x${sign(b + d)}`, `y=${k}x${sign(b - d)}`, `y=${k + d}x${sign(b)}`, `y=${-k}x${sign(b)}`]
        .map((c, j) => ({ label: 'ABCD'[j], contentLatex: `$${c}$`, isCorrect: j === 1 }))
      : [];
    out.push({
      id: i + 1, type, stage: '初中', subject: '数学', textbookVersion: '人教版', chapter: '第十九章 一次函数',
      stemLatex: stem, figures: [], options,
      answer,
      rubric: type === 'solution'
        ? [{ step: 1, desc: '设式并代入两点', score: 3 }, { step: 2, desc: '求出平移后直线', score: 4 }, { step: 3, desc: '正确还原平移方向', score: 3 }]
        : [],
      analysisBriefLatex: `**上加下减**:平移只改 $b$,本题 $b$ 变 $${d}$ 个单位。`,
      analysisLatex: `平移口诀:上加下减(改 $b$)。本题 $b$ 由 $${b}$ 变化 $${d}$ 个单位。`,
      analysisDetailLatex: `**详细解析**\n1. 平移只改变截距 $b$,斜率 $k$ 不变。\n2. 向下平移 $${d}$ 个单位:$b \\to b-${d}$。\n3. 代回即得新的解析式。`,
      difficulty: 1 + (i % 3), status: 'published',
      tags: [
        { nodeId: 101 + (i % 6), graphType: 'curriculum_knowledge', code: `PEP-19-${(i % 6) + 1}`, name: KP_NAMES[i % 6] },
        ...(((a) => a ? [{ nodeId: a.id, graphType: 'problem_solving_ability' as const, code: a.code, name: a.name }] : [])(ABILITY_TAG_NODES[i % ABILITY_TAG_NODES.length])),
        ...(((s) => s ? [{ nodeId: s.id, graphType: 'problem_solving_strategy' as const, code: s.code, name: s.name }] : [])(STRATEGY_TAG_NODES[i % STRATEGY_TAG_NODES.length])),
      ],
      stats: { correctRate: i % 4 === 3 ? null : 55 + ((i * 7) % 40), usedInPapers: i < 10 ? 1 + (i % 3) : 0 },
      ownerName: '张明', createdAt: '2026-06-02T03:00:00.000Z',
    });
  }
  return out;
}
export const questions: QuestionDto[] = genQuestions();

// 试卷库:三类齐全 + 草稿/已发布两态(paper-lib 页集中浏览/搜索/复用)
const examQuestions = questions.slice(5, 13).map((q, j) => ({
  seq: j + 1, questionId: q.id, score: q.type === 'solution' ? 10 : 5, type: q.type, stemLatex: q.stemLatex,
}));
const draftQuestions = [14, 15, 16].map((qid, j) => {
  const q = questions[qid - 1];
  return { seq: j + 1, questionId: q.id, score: q.type === 'solution' ? 10 : 5, type: q.type, stemLatex: q.stemLatex };
});

export const papers: PaperDto[] = [
  {
    id: 1, name: '第4讲 · 随堂练', type: 'practice', totalScore: 30, status: 'published',
    questions: questions.slice(0, 5).map((q, j) => ({ seq: j + 1, questionId: q.id, score: j === 4 ? 10 : 5, type: q.type, stemLatex: q.stemLatex })),
  },
  {
    id: 2, name: '第3讲课后作业 · 待定系数法', type: 'homework', totalScore: 35, status: 'published',
    questions: [9, 10, 11, 13, 4].map((qid, j) => {
      const q = questions[qid - 1];
      return { seq: j + 1, questionId: q.id, score: j === 4 ? 10 : 5, type: q.type, stemLatex: q.stemLatex };
    }),
  },
  {
    id: 3, name: '期中考试卷 · 一次函数综合', type: 'exam', status: 'published',
    totalScore: examQuestions.reduce((s, q) => s + q.score, 0), questions: examQuestions,
  },
  {
    id: 4, name: '第5讲课后作业(草稿) · 一次函数应用', type: 'homework', status: 'draft',
    totalScore: draftQuestions.reduce((s, q) => s + q.score, 0), questions: draftQuestions,
  },
];

export const assignments: AssignmentDto[] = [
  {
    id: 1, paperId: 2, paperName: '第3讲课后作业 · 待定系数法', lessonId: 3, kind: 'homework',
    target: { courseId: 1 }, publishAt: '2026-06-06T08:10:00.000Z', dueAt: '2026-06-10T14:00:00.000Z',
    scoreCounted: true, questionCount: 5, totalScore: 35,
  },
  {
    id: 2, paperId: 1, paperName: '第2讲随堂巩固 · 一次函数的图象', lessonId: 2, kind: 'homework',
    target: { courseId: 1 }, publishAt: '2026-05-30T08:00:00.000Z', dueAt: '2026-06-03T14:00:00.000Z',
    scoreCounted: true, questionCount: 5, totalScore: 30,
  },
];

/**
 * 作业总览进度种子(C3 #4):非动态作业的提交/批改概览。
 * 作业 1 的进度由批改链动态计算(见 handlers GET /assignments);其余取此种子,未命中则视为「刚发布、零提交」。
 */
export const assignmentBriefSeed: Record<number, { submitted: number; totalStudents: number; graded: number; status: 'ongoing' | 'finished' }> = {
  2: { submitted: 12, totalStudents: 12, graded: 12, status: 'finished' },
};

/**
 * 知识点内容包存储(C3 #5,GET/PUT /knowledge/content-packs/{kpNodeId}):
 * 每知识点一份可复用内容(讲解课件 resource / 随堂练卷 paper / 小结模板 config);未维护则不在表中。
 * 字段名只读(resource/paper 名)由 handlers 按 id 解析回填。可变:PUT 时 upsert。
 */
export const contentPacks: Record<number, { lectureResourceId: number | null; practicePaperId: number | null; summaryConfig: Record<string, unknown> }> = {
  // 知识点 102「一次函数的图象」预置一份内容包:讲解挂资源 1、随堂练挂卷 1、小结模板
  102: { lectureResourceId: 1, practicePaperId: 1, summaryConfig: { personal_consolidation: { min: 2, max: 4 } } },
};

export const attempt: AttemptDto = {
  id: 1, assignmentId: 1, status: 'graded', attemptNo: 1,
  startedAt: '2026-06-07T10:00:00.000Z', submittedAt: '2026-06-07T10:24:00.000Z',
  score: 25, objectiveScore: 15, subjectiveScore: 10,
  answers: [9, 10, 11, 13, 4].map((qid, j) => ({
    questionId: qid,
    response: j === 4 ? { photoOssKey: 'demo/answers/1-4.jpg' } : { choice: j === 2 ? 'A' : 'B' },
    isCorrect: j === 4 ? null : j !== 2,
    score: j === 4 ? 10 : j !== 2 ? 5 : 0,
    flagged: false,
  })),
  // 题面随 attempt 下发(契约 AttemptDto.questions);graded → 下发 correctAnswer/analysisLatex
  questions: [9, 10, 11, 13, 4].map((qid, j) => {
    const q = questions[qid - 1];
    return {
      seq: j + 1, questionId: q.id, score: j === 4 ? 10 : 5, type: q.type,
      stemLatex: q.stemLatex, figures: q.figures,
      options: q.options.map((o) => ({ label: o.label, contentLatex: o.contentLatex })),
      correctAnswer: q.answer, analysisLatex: q.analysisLatex,
    };
  }),
};

// ================= B4 · 批改复核链(seed 口径:第 3 讲作业,4 份解答题待复核) =================
// 题 = questions[3](解答,rubric 3+4+3=10 分;k=5,b'=4,正确还原为 y=5x+8)

/** 作答照片占位(内联 SVG,免外网;真实环境为 OSS 签名 URL,字段形状一致;不写色值,底色由页面 bg-card 提供) */
function scriptPhoto(lines: string[]): string {
  const rows = lines.map((l, i) => `<text x="24" y="${44 + i * 34}" font-size="17" font-family="serif" font-style="italic">${l}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="${60 + lines.length * 34}">${rows}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 4 份待判分作答(3 份解答题拍照手写 + 1 份公式填空;review 实改 finalScore/comment) */
export const gradingAnswers: GradingItemDto[] = [
  {
    answerId: 41, studentId: 8, studentName: '许诺', questionId: 4,
    stemLatex: questions[3].stemLatex, rubric: questions[3].rubric,
    photoUrl: scriptPhoto([
      '解:设平移后的直线为 y = kx + b\'',
      '代入 A(1,9):k + b\' = 9;代入 B(-1,-1):-k + b\' = -1',
      '解得 k = 5,b\' = 4,平移后:y = 5x + 4',
      '所以原直线 y = 5x + 4 - 4 = 5x',
    ]),
    textResponse: '设平移后的直线为 y=kx+b\';代入 A(1,9) 得 k+b\'=9,代入 B(-1,-1) 得 -k+b\'=-1;解得 k=5,b\'=4,平移后 y=5x+4;所以原直线 y=5x+4-4=5x。',
    aiScore: 7,
    aiSteps: [
      { step: 1, ok: true },
      { step: 2, ok: true },
      { step: 3, ok: false, comment: '还原方向错误 —— 向下平移过的直线要把 b 加回去,应为 $b=4+4=8$,学生写成 $4-4$' },
    ],
    aiErrorTags: ['还原平移方向'], finalScore: null, comment: null,
  },
  {
    answerId: 42, studentId: 5, studentName: '周子航', questionId: 4,
    stemLatex: questions[3].stemLatex, rubric: questions[3].rubric,
    photoUrl: scriptPhoto([
      '解:设平移后的直线为 y = kx + b\'',
      '代入两点:k + b\' = 9,-k + b\' = -1',
      '解得 k = 4,b\' = 5(解方程出错)',
      '平移后 y = 4x + 5,原直线 y = 4x + 5',
    ]),
    textResponse: '设平移后直线 y=kx+b\';代入两点:k+b\'=9,-k+b\'=-1;解得 k=4,b\'=5(解方程出错);平移后 y=4x+5,原直线 y=4x+5。',
    aiScore: 3,
    aiSteps: [
      { step: 1, ok: true },
      { step: 2, ok: false, comment: '两式相加应得 $2b\'=8$,学生解出 $k=4,b\'=5$,求解错误' },
      { step: 3, ok: false, comment: '未做还原,直接把平移后直线当作原直线' },
    ],
    aiErrorTags: ['二元一次方程组求解', '还原平移方向'], finalScore: null, comment: null,
  },
  {
    answerId: 43, studentId: 4, studentName: '林小满', questionId: 4,
    stemLatex: questions[3].stemLatex, rubric: questions[3].rubric,
    photoUrl: scriptPhoto([
      '解:设平移后的直线为 y = kx + b\'',
      '代入 A、B 两点解得 k = 5,b\' = 4',
      '平移后 y = 5x + 4;原直线 y = 5x',
    ]),
    textResponse: '设平移后直线 y=kx+b\';代入 A、B 两点解得 k=5,b\'=4,平移后 y=5x+4;原直线 y=5x。',
    aiScore: 7,
    aiSteps: [
      { step: 1, ok: true },
      { step: 2, ok: true },
      { step: 3, ok: false, comment: '还原时少加了平移量,应为 $y=5x+8$' },
    ],
    aiErrorTags: ['还原平移方向'], finalScore: null, comment: null,
  },
  // 公式填空(含 LaTeX 参考答案)→ 与解答题同管线进待复核列表;作答用 TexText 渲染
  {
    answerId: 44, studentId: 7, studentName: '郑一鸣', questionId: questions[6].id,
    stemLatex: questions[6].stemLatex, rubric: [{ step: 1, desc: '解析式正确(含分数系数)', score: 5 }],
    photoUrl: null,
    textResponse: '由两点得 $k=\\dfrac{1}{2}$,$b=1$,故 $y=\\dfrac{1}{2}x+1$。',
    aiScore: 5,
    aiSteps: [{ step: 1, ok: true, comment: '$y=\\dfrac{1}{2}x+1$,与参考答案一致' }],
    aiErrorTags: [], finalScore: null, comment: null,
  },
];

/** 出分状态(finalize 置 true 后 /grading/pending 不再返回该作业) */
export const gradingState = { finalized: false };

export const wrongBook: WrongBookItemDto[] = [11, 9].map((qid, i) => {
  const q = questions[qid - 1];
  return {
    id: i + 1, questionId: q.id, type: q.type, stemLatex: q.stemLatex, analysisLatex: q.analysisLatex,
    wrongCount: 1 + i, correctRedoCount: 0, errorTags: ['图象平移符号'], status: 'open',
    sourceName: '第3讲课后作业 · 待定系数法', createdAt: '2026-06-07T10:30:00.000Z',
    subject: q.subject, // [2026-06-13 批准] WrongBookItem 含 subject(源自题目学科)
  };
});

export const mastery: MasteryItemDto[] = KP_NAMES.map((name, i) => ({
  nodeId: 101 + i, nodeName: name, graphType: 'curriculum_knowledge',
  mastery: [86, 72, 55, 48, 90, 66][i], sampleCount: 6 + i,
}));

export const aiUsageSummary: AiUsageSummaryDto = {
  period: '2026-06', totalTokens: 1842000, totalCost: 1842, monthlyLimit: 3000,
  usedPercent: 61, avgCostPerLesson: 12.4,
};

export const aiUsageDaily = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 4, 29 + i)); // 2026-05-29 起连续 14 天
  return { date: d.toISOString().slice(0, 10), tokens: 80000 + i * 9000, cost: Math.round((80 + i * 9) * 100) / 100 };
});

export const aiUsageBreakdown: AiUsageBreakdownDto[] = [
  { key: 'qa', label: '引导式答疑', tokens: 760000, cost: 760, percent: 41 },
  { key: 'pre_grading', label: '主观题预批', tokens: 552000, cost: 552, percent: 30 },
  { key: 'class_companion', label: '课堂伴学', tokens: 350000, cost: 350, percent: 19 },
  { key: 'diagnosis', label: '学情诊断', tokens: 180000, cost: 180, percent: 10 },
];

export const aiQuota = { monthlyLimit: 3000, alertThreshold: 80, overPolicy: 'disable_qa' };

export const auditLogs = [
  { actorName: '王校长', action: 'admin.student.create', targetType: 'user', createdAt: '2026-06-11T01:10:00.000Z' },
  { actorName: '张明', action: 'paper.publish', targetType: 'paper', createdAt: '2026-06-10T09:40:00.000Z' },
  { actorName: '系统', action: 'seed.business', targetType: 'system', createdAt: '2026-06-08T00:00:00.000Z' },
];

export const adminDashboard = {
  teacherCount: 2, studentCount: 12, weekAttendanceRate: 94.2, monthAiCost: 1842, todayLessonCount: 2,
  recentEvents: [
    { text: '新学员 吴佳怡 报名「初二数学提高班」', time: '2026-06-11T01:10:00.000Z' },
    { text: '「第3讲课后作业」已出分,平均 25.6 / 35', time: '2026-06-10T12:00:00.000Z' },
    { text: '本月 AI 用量已达额度 61%', time: '2026-06-10T00:00:00.000Z' },
  ],
};

export const studentToday = {
  todayLesson: {
    lessonId: 4, courseName: '初二数学提高班', title: '第4讲 · 一次函数的图象平移',
    startAt: '2026-06-13T06:00:00.000Z', endAt: '2026-06-13T08:00:00.000Z',
    canEnterAt: '2026-06-13T05:50:00.000Z', sessionId: null,
  },
  tasks: [
    {
      assignmentId: 1, kind: 'homework' as const, title: '第3讲课后作业 · 待定系数法', questionCount: 5,
      dueAt: '2026-06-10T14:00:00.000Z', progress: { answered: 5, total: 5, status: 'graded' },
    },
  ],
};

export const studentReport = {
  mastery,
  weekStats: { answeredCount: 38, correctRate: 78, studySec: 24120, wrongOpenCount: wrongBook.length },
};

export const courseRoster = students.map((s) => ({
  studentId: s.id, name: s.name, attendance: '3/3', homeworkAvg: 70 + (s.id % 25), status: 'active',
}));

export const courseMasteryHeat = mastery.map((m) => ({
  nodeId: m.nodeId, nodeName: m.nodeName, avgMastery: m.mastery, studentCount: 12,
}));

export const courseAttention = [
  { studentId: 6, name: '吴佳怡', reason: '连续 2 次作业低于 60 分' },
  { studentId: 9, name: '刘思琪', reason: '「图象的平移」掌握率 48%' },
];

/** AI 学情诊断(POST /analytics/students/{id}/diagnose):整体诊断 + 薄弱知识点 */
export const aiDiagnosis: AiDiagnosisDto = {
  summary:
    '近 30 天该生共作答 6 套练习,客观题正确率尚可,但主观题(解答题)失分集中在「图象平移的还原方向」与「二元一次方程组求解」两处。' +
    '建议下一讲课前针对性重讲平移「上加下减」口诀,并布置 2 道待定系数法专项巩固。',
  weakPoints: [
    { kpName: '一次函数图象的平移', reason: '3 次作业均在还原方向上失分,常把「向下平移」写成减法' },
    { kpName: '二元一次方程组求解', reason: '代入两点后消元计算出错,导致 k、b 求解错误' },
  ],
  generatedAt: '2026-06-11T12:00:00.000Z',
};

export const aiHealth = {
  providers: [
    { feature: 'qa', provider: 'demo-llm', model: 'demo-model-s', healthy: true },
    { feature: 'pre_grading', provider: 'demo-llm', model: 'demo-model-s', healthy: true },
  ],
};

// ============ AI 生成课件(/courseware/outline · /courseware/jobs,2026-08-22 已进契约) ============
// 走查用有状态 mock:文本 LLM 出大纲 → 教师改 → 逐页 GPT Image 出图(真实约 23 秒/页,
// 此处 3 秒/页便于走查)→ 全部完成落资源库。真实后端为 BullMQ 队列 + Redis 进度 + 前端轮询。

/** mock 出图节奏:每页结算耗时(ms) */
export const COURSEWARE_MS_PER_PAGE = 3000;
/** 固定失败一次的页序(供走查失败态 → 重试转成功) */
export const COURSEWARE_FAIL_SEQ = 3;

const xmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 长文本按固定字数折行(中文按字计,够用);行末溢出的收尾标点吸回本行,避免「。」单独成行 */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > 0 && out.length < maxLines) {
    let take = Math.min(perLine, rest.length);
    if (take < rest.length && /[。,、;;::??!!)」』]/.test(rest[take])) take += 1;
    out.push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  if (rest.length > 0) out[maxLines - 1] = `${out[maxLines - 1].slice(0, perLine - 1)}…`;
  return out;
}

/**
 * 要点折行:两行均分 + 优先在标点后断开。
 * 直接按满行硬断会出现「第二行只剩两个字」的尴尬版式(整句要点长度普遍是行宽 +2~3 字)。
 */
function wrapBullet(text: string, perLine: number, maxLines: number): string[] {
  if (text.length <= perLine) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > perLine && out.length < maxLines - 1) {
    const linesLeft = Math.min(maxLines - out.length, Math.ceil(rest.length / perLine));
    const target = Math.min(perLine, Math.ceil(rest.length / linesLeft));
    let cut = target;
    for (let d = 1; d <= 5; d += 1) {
      if (target + d <= perLine && /[,、。;;::]/.test(rest[target + d - 1])) { cut = target + d; break; }
      if (target - d > 4 && /[,、。;;::]/.test(rest[target - d - 1])) { cut = target - d; break; }
    }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest.length > perLine ? `${rest.slice(0, perLine - 1)}…` : rest);
  return out;
}

/** 标题折行:优先在「 · 」处断开,否则按字数断 */
function wrapTitle(title: string, perLine: number, maxLines: number): string[] {
  if (title.length <= perLine) return [title];
  const sep = title.lastIndexOf(' · ', perLine);
  if (sep > 0) return [title.slice(0, sep), ...wrap(title.slice(sep + 3), perLine, maxLines - 1)];
  return wrap(title, perLine, maxLines);
}

/**
 * 幻灯片画布尺寸 = 1264×848(横版,约 3:2)。
 * 依据:2026-08 实测真实链路 —— 向 GPT Image 请求 1536x1024/medium,中转会归一参数,
 * 实际返回 1264x848/low。故 mock 直接对齐「实际返回尺寸」而非请求尺寸,
 * 走查看到的比例与真实成品一致(记账/落库同样应按响应实际 size/quality,见 README)。
 */
export const SLIDE_WIDTH = 1264;
export const SLIDE_HEIGHT = 848;

/**
 * 幻灯片风格主题(mock 渲染参数,取自 pages/courseware/lib/styles.ts 的 palette)。
 * 只有 palette 四色是「事实」,其余灰阶一律用 opacity 派生,避免在 mock 里再写裸色值。
 */
interface SlideTheme {
  bg: string; ink: string; primary: string; accent: string;
  /** 页眉/页脚等次级文字的透明度 */
  mutedOpacity: number;
  /** 圆角(swiss 为 0) */
  radius: number;
  /** 左侧竖向色条 */
  leftBar: boolean;
  bullet: 'circle' | 'square' | 'sketch' | 'dash';
  /** 右栏示意图区:填充色 / 透明度 / 描边宽度(0 表示无描边) */
  panel: { fill: string; opacity: number; stroke: number };
  /** 示意图线条色 */
  figureInk: string;
  /** 背景装饰(纸纹 / 极光 / 网格 / 顶部色带) */
  decor: string;
  /** 页脚署名后缀(自定义风格带上教师描述) */
  footerNote: string;
  /** 标题下的短杠画成手绘抖动线 */
  sketchyBar?: boolean;
  /** 标题用马克笔色块高亮打底 */
  markerTitle?: boolean;
}

function slideTheme(styleId: string, customText?: string): SlideTheme {
  const { bg, primary, accent, text } = getStyle(styleId).palette;
  const base: SlideTheme = {
    bg, ink: text, primary, accent,
    mutedOpacity: 0.5, radius: 26, leftBar: true, bullet: 'circle',
    panel: { fill: accent, opacity: 0.12, stroke: 0 },
    figureInk: accent, decor: '', footerNote: '',
  };
  if (styleId === 'hand_sketch') {
    return {
      ...base, bullet: 'sketch', mutedOpacity: 0.45, leftBar: false, radius: 18,
      panel: { fill: accent, opacity: 0.14, stroke: 3 }, figureInk: primary,
      sketchyBar: true, markerTitle: true,
      // 稿纸横线 + 手绘虚线边框
      decor: [
        ...[0, 1, 2, 3, 4, 5].map((i) => `<rect x="0" y="${120 + i * 130}" width="${SLIDE_WIDTH}" height="2" fill="${primary}" opacity="0.05"/>`),
        `<rect x="34" y="34" width="${SLIDE_WIDTH - 68}" height="${SLIDE_HEIGHT - 68}" rx="20" fill="none" stroke="${primary}" stroke-width="3" stroke-dasharray="18 12" opacity="0.5"/>`,
      ].join(''),
    };
  }
  if (styleId === 'vector_illust') {
    return {
      ...base, bullet: 'square', mutedOpacity: 0.55, leftBar: false, radius: 20,
      panel: { fill: accent, opacity: 0.9, stroke: 5 }, figureInk: text,
      // 顶部插画色带 + 描边几何
      decor: [
        `<rect x="0" y="0" width="${SLIDE_WIDTH}" height="34" fill="${primary}"/>`,
        `<circle cx="1148" cy="96" r="32" fill="${primary}" stroke="${text}" stroke-width="5"/>`,
        `<rect x="1042" y="66" width="58" height="58" fill="${bg}" stroke="${text}" stroke-width="5"/>`,
      ].join(''),
    };
  }
  if (styleId === 'dark_tech') {
    return {
      ...base, mutedOpacity: 0.42, radius: 22,
      panel: { fill: text, opacity: 0.06, stroke: 0 },
      // 极光光带(氛围,不喧宾夺主)
      decor: [
        `<ellipse cx="1010" cy="90" rx="380" ry="170" fill="${primary}" opacity="0.28"/>`,
        `<ellipse cx="180" cy="800" rx="300" ry="130" fill="${accent}" opacity="0.14"/>`,
      ].join(''),
    };
  }
  if (styleId === 'swiss_grid') {
    return {
      ...base, bullet: 'dash', mutedOpacity: 0.55, leftBar: false, radius: 0,
      panel: { fill: text, opacity: 0, stroke: 3 }, figureInk: text,
      // 12 列网格辅助线 + 一块纯色方块
      decor: [
        ...Array.from({ length: 11 }, (_, i) => `<rect x="${88 + (i + 1) * 92}" y="0" width="1" height="${SLIDE_HEIGHT}" fill="${text}" opacity="0.06"/>`),
        `<rect x="1044" y="52" width="136" height="96" fill="${primary}"/>`,
      ].join(''),
    };
  }
  if (styleId === CUSTOM_STYLE_ID) {
    const t = (customText ?? '').trim();
    return {
      ...base, mutedOpacity: 0.5, radius: 22,
      panel: { fill: accent, opacity: 0.3, stroke: 0 }, figureInk: primary,
      decor: `<rect x="30" y="30" width="${SLIDE_WIDTH - 60}" height="${SLIDE_HEIGHT - 60}" rx="18" fill="none" stroke="${primary}" stroke-width="3" stroke-dasharray="14 10" opacity="0.5"/>`,
      footerNote: t ? ` · 自定义:${t.length > 12 ? `${t.slice(0, 12)}…` : t}` : '',
    };
  }
  return base;
}

/** 右侧示意图占位区:按页序轮换四种简单几何示意(直角三角形 / 坐标系 / 三步流程 / 知识网络) */
function figureDecoration(variant: number, ink: string, nodeFill: string): string {
  /** 描边样式(注意:同一元素上不可重复声明 stroke-width,重复属性会让 SVG 变成非法 XML) */
  const line = (w: number) => `stroke="${ink}" stroke-width="${w}" fill="none"`;
  const label = (x: number, y: number, t: string) =>
    `<text x="${x}" y="${y}" font-size="26" fill="${ink}" text-anchor="middle">${t}</text>`;
  if (variant === 0) {
    return [
      `<polygon points="880,540 1080,540 880,360" ${line(5)} stroke-linejoin="round"/>`,
      `<rect x="880" y="512" width="28" height="28" ${line(3)}/>`,
      label(980, 578, 'a'), label(854, 456, 'b'), label(1000, 440, 'c'),
    ].join('');
  }
  if (variant === 1) {
    return [
      `<line x1="866" y1="540" x2="1096" y2="540" ${line(4)}/>`,
      `<line x1="900" y1="576" x2="900" y2="346" ${line(4)}/>`,
      `<line x1="914" y1="528" x2="1070" y2="368" ${line(5)}/>`,
      `<circle cx="958" cy="483" r="9" fill="${ink}"/>`,
      `<circle cx="1036" cy="403" r="9" fill="${ink}"/>`,
      label(1088, 578, 'x'), label(864, 352, 'y'),
    ].join('');
  }
  if (variant === 2) {
    return [0, 1, 2].map((i) => {
      const y = 348 + i * 76;
      return `<rect x="880" y="${y}" width="200" height="52" rx="14" ${line(4)}/>`
        + label(980, y + 34, `第 ${i + 1} 步`)
        + (i < 2 ? `<polyline points="970,${y + 56} 980,${y + 70} 990,${y + 56}" ${line(4)}/>` : '');
    }).join('');
  }
  // 知识网络:先画连线,再用底色实心圆盖住线头,避免线条穿过节点
  const branches = [[884, 360], [1076, 360], [884, 540], [1076, 540]];
  return [
    ...branches.map(([x, y]) => `<line x1="980" y1="450" x2="${x}" y2="${y}" stroke="${ink}" stroke-width="3"/>`),
    `<circle cx="980" cy="450" r="48" fill="${nodeFill}" stroke="${ink}" stroke-width="5"/>`,
    ...branches.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="26" fill="${nodeFill}" stroke="${ink}" stroke-width="3"/>`),
  ].join('');
}

export interface SlideRenderInput {
  seq: number;
  title: string;
  body: string;
  total: number;
  /** 风格 id(见 pages/courseware/lib/styles.ts);缺省为默认风格 */
  styleId?: string;
  /** 自定义风格时教师填的风格描述(mock 只用于页脚示意) */
  customText?: string;
}

/**
 * 模拟 GPT Image 出的「一整张幻灯片图片」:内联 SVG data-URI,横版 1264×848。
 * 版式对齐真实链路验证过的专业教学 PPT:装饰色条 + 大标题 + 3~5 条完整句要点(序号点)
 * + 右侧示意图区 + 右下角页码 n/N;底色/主色/文字色/装饰随所选风格变化(走查时能一眼看出换了风格)。
 * 中文必须走 encodeURIComponent 构造 data URI(base64 会破坏多字节字符)。
 */
export function slideImage(input: SlideRenderInput): string {
  const { seq, title, body, total } = input;
  const t = slideTheme(input.styleId ?? DEFAULT_STYLE_ID, input.customText);
  const titleLines = wrapTitle(title.trim() || `第 ${seq} 页`, 19, 2);
  const bullets = body
    .split('\n')
    .map((l) => l.replace(/^[·•\-\s\d.、]+/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
  const titleBottom = 162 + (titleLines.length - 1) * 62;
  const barY = titleBottom + 24;
  const contentTop = barY + 48;
  const slotH = bullets.length === 0 ? 0 : Math.min(122, Math.floor((760 - contentTop) / bullets.length));

  const muted = (x: number, y: number, size: number, text: string, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${t.ink}" opacity="${t.mutedOpacity}" text-anchor="${anchor}">${xmlText(text)}</text>`;

  const titleSvg = titleLines
    .map((l, i) => {
      const y = 162 + i * 62;
      // 马克笔高亮:中文按字宽≈字号估宽,涂一条半透明色块打底
      const highlight = t.markerTitle
        ? `<rect x="82" y="${y - 44}" width="${Math.min(700, l.length * 53 + 16)}" height="56" rx="6" fill="${t.accent}" opacity="0.55"/>`
        : '';
      return `${highlight}<text x="88" y="${y}" font-size="52" font-weight="700" fill="${t.ink}">${xmlText(l)}</text>`;
    })
    .join('');
  const titleBar = t.sketchyBar
    ? `<path d="M88 ${barY + 4} q28 -6 56 1 t56 -2" fill="none" stroke="${t.primary}" stroke-width="7" stroke-linecap="round"/>`
    : `<rect x="88" y="${barY}" width="112" height="8" rx="${t.radius === 0 ? 0 : 4}" fill="${t.primary}"/>`;

  /** 序号点:圆点 / 描边方块 / 手绘对勾 / 瑞士短横 */
  const marker = (i: number, top: number): string => {
    const cy = top + 22;
    if (t.bullet === 'square') {
      return `<rect x="88" y="${cy - 19}" width="38" height="38" rx="4" fill="${t.primary}" stroke="${t.ink}" stroke-width="4"/>`
        + `<text x="107" y="${cy + 9}" font-size="22" font-weight="700" fill="${t.bg}" text-anchor="middle">${i + 1}</text>`;
    }
    if (t.bullet === 'sketch') {
      return `<circle cx="106" cy="${cy}" r="19" fill="none" stroke="${t.primary}" stroke-width="3"/>`
        + `<text x="106" y="${cy + 9}" font-size="22" font-weight="700" fill="${t.primary}" text-anchor="middle">${i + 1}</text>`;
    }
    if (t.bullet === 'dash') {
      return `<rect x="88" y="${cy - 2}" width="34" height="5" fill="${t.ink}"/>`;
    }
    return `<circle cx="106" cy="${cy}" r="19" fill="${t.primary}"/>`
      + `<text x="106" y="${cy + 9}" font-size="22" font-weight="700" fill="${t.bg}" text-anchor="middle">${i + 1}</text>`;
  };

  const bulletSvg = bullets.map((b, i) => {
    const top = contentTop + i * slotH;
    // 左栏文字区 142~780,字号 29 → 一行约 21 字
    const lines = wrapBullet(b, 21, 2);
    return marker(i, top)
      + lines.map((l, j) => `<text x="142" y="${top + 32 + j * 40}" font-size="29" fill="${t.ink}">${xmlText(l)}</text>`).join('');
  }).join('');

  const panel = [
    t.panel.opacity > 0
      ? `<rect x="792" y="180" width="388" height="440" rx="${t.radius}" fill="${t.panel.fill}" opacity="${t.panel.opacity}"/>` : '',
    t.panel.stroke > 0
      ? `<rect x="792" y="180" width="388" height="440" rx="${t.radius}" fill="none" stroke="${t.figureInk}" stroke-width="${t.panel.stroke}"/>` : '',
  ].join('');

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}" font-family="sans-serif">`,
    `<rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="${t.bg}"/>`,
    t.decor,
    // 左侧竖向装饰条(部分风格不用色条,靠底色与装饰区分)
    t.leftBar ? `<rect x="0" y="0" width="26" height="${SLIDE_HEIGHT}" fill="${t.primary}"/>` : '',
    t.leftBar ? `<rect x="26" y="0" width="10" height="${SLIDE_HEIGHT}" fill="${t.accent}" opacity="0.35"/>` : '',
    // 页眉标签 + 标题 + 标题下的主题色短杠
    muted(88, 96, 26, 'AI 生成课件 · 教学幻灯片'),
    titleSvg,
    titleBar,
    // 左栏要点
    bulletSvg,
    // 右栏示意图区
    panel,
    figureDecoration((seq - 1) % 4, t.figureInk, t.bg),
    muted(986, 668, 24, '示意图', 'middle'),
    // 页脚:左侧署名 + 右下角页码 n/N
    `<line x1="88" y1="770" x2="1180" y2="770" stroke="${t.ink}" stroke-width="2" opacity="0.18"/>`,
    muted(88, 806, 24, `鲸云 AI 教育平台 · 演示用生成图${t.footerNote}`),
    `<text x="1180" y="806" font-size="28" font-weight="700" fill="${t.primary}" text-anchor="end">${seq}/${total}</text>`,
    '</svg>',
  ].filter(Boolean).join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 文字稿 → 课题主题词(取前若干字,串进各页标题) */
export function outlineTopic(sourceText: string): string {
  const first = sourceText
    .split(/[。;;,,!!??::\n\r]/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  if (!first) return '本节课内容';
  return first.length > 14 ? first.slice(0, 14) : first;
}

interface OutlineStage {
  label: (topic: string) => string;
  /** 3~5 条完整句要点(整句才够密,短语会让成品「一页几个字」) */
  bullets: (topic: string) => string[];
  /** 该页配图与版式重点(真实链路会与统一风格前缀 + 整页内容拼成密实提示词,见 README) */
  figure: (topic: string) => string;
}

const STAGE_HEAD: OutlineStage = {
  label: (t) => `${t} · 课题引入`,
  bullets: (t) => [
    '从校园里的真实问题出发,让学生先感到「这个知识用得上」。',
    `复习与「${t}」相关的旧知识,为新课搭好台阶。`,
    '提出本节的核心问题:已知条件之间到底有什么关系?',
    '明确本节目标:理解概念、掌握方法、能独立解题。',
  ],
  figure: (t) => `右栏画一幅校园生活情境示意图(如旗杆与影子、楼梯与斜坡),用箭头标出待求的量,呼应标题「${t}」`,
};

const STAGE_MIDDLE: OutlineStage[] = [
  {
    label: (t) => `${t}的概念澄清`,
    bullets: (t) => [
      `给出「${t}」的规范表述,并逐字拆解其中的关键词。`,
      '标出结论成立的前提条件,条件不满足就不能直接用。',
      '对比两种容易混淆的说法,指出差别究竟在哪一处。',
      '一句话记住:先看条件,再用结论,顺序不能颠倒。',
    ],
    figure: () => '右栏画一张定义卡片,下方两个小方框分别列出「成立条件」与「常见误读」,用对勾与叉号区分',
  },
  {
    label: (t) => `${t}的推导过程`,
    bullets: () => [
      '从图形与等式出发,一步一步把结论推导出来。',
      '每一步都标注依据:用的是定义、定理还是运算律。',
      '推完回看整条链条,确认没有跳步、没有循环论证。',
      '强调结论可以反向使用,便于逆向求出未知量。',
    ],
    figure: () => '右栏画自上而下三步推导流程图,方框之间用箭头相连,旁边配一幅几何示意图标出对应关系',
  },
  {
    label: (t) => `例题精讲 · ${t}`,
    bullets: () => [
      '例题给出典型题面,先圈出已知条件与所求目标。',
      '按四步走:审题、找关系、列式计算、回代检验。',
      '板书完整过程,提醒书写格式与单位不能省略。',
      '算完追问一句:这一步的依据是什么?',
    ],
    figure: () => '右栏上半是题面文字框,下半是「审题→找关系→列式→检验」四步竖排清单,配草稿纸与铅笔元素',
  },
  {
    label: () => '变式训练',
    bullets: (t) => [
      '在例题基础上改动条件,观察解法如何随之迁移。',
      '变式一只换数值,重点检验计算是否稳定。',
      `变式二换一种问法,检验是否真的理解「${t}」。`,
      '归纳:方法始终没变,关键是找到同一个关系式。',
    ],
    figure: () => '右栏并排两张题卡(变式一、变式二),中间一个双向箭头表示对比,卡片下方一行「方法不变」标注',
  },
  {
    label: (t) => `${t}易错辨析`,
    bullets: () => [
      '列出三处高频错误,并现场追问错在哪一步。',
      '错因归类:概念不清、条件漏看、计算失误。',
      '给出自查清单:做完先查条件、再查单位、最后查数值。',
      '把典型错例抄进错题本,下次做题前先看一眼。',
    ],
    figure: () => '右栏三张横排错误卡片,每张左上角一个红色叉号,右下角一个放大镜元素表示「自查」',
  },
  {
    label: (t) => `${t}的生活应用`,
    bullets: (t) => [
      `把「${t}」放回真实场景,先估算结果再动笔验证。`,
      '课堂活动:同桌互相出一道生活情境题并交换解答。',
      '体会流程:实际问题、抽象模型、求解、回答。',
      '讨论一句:估算与精确计算,什么时候该用哪个?',
    ],
    figure: () => '右栏画一幅校园场景示意图(操场、旗杆、楼梯),周围三个标注气泡分别写「测什么」「算什么」「答什么」',
  },
  {
    label: () => '知识结构梳理',
    bullets: (t) => [
      `以「${t}」为中心,把本章相关知识连成一张网络。`,
      '连线上标注关系:由什么推出、又能解决什么问题。',
      '提醒学生把新知识挂到旧知识的树上,而不是死记。',
      '课后自己默画一遍结构图,画不出的地方就是薄弱点。',
    ],
    figure: () => '右栏画思维导图:中心节点向四周发散四条分支,分支端点为小圆节点,线条简洁不加阴影',
  },
];

const STAGE_TAIL: OutlineStage[] = [
  {
    label: () => '分层练习',
    bullets: () => [
      '基础 2 题:直接套用本节结论,人人必须过关。',
      '提升 2 题:需要两步转化,先说思路再动笔。',
      '挑战 1 题:综合运用,鼓励尝试、允许不完整。',
      '订正要求:错题写清错因,不只是抄一遍正确答案。',
    ],
    figure: () => '右栏画三层阶梯图形由低到高,每层标注「基础 2 题」「提升 2 题」「挑战 1 题」,阶梯旁一个向上的小箭头',
  },
  {
    label: () => '课堂小结与作业',
    bullets: (t) => [
      '回顾本节三个关键结论,请学生各用一句话复述。',
      `随机点名:用自己的话说清「${t}」是怎么用的。`,
      '布置课后作业,说明必做与选做的分界。',
      '预告下节内容,让学生带着问题离开教室。',
    ],
    figure: () => '右栏画三行带勾选框的要点清单,下方一个作业便签图形写「必做 / 选做」,配色温暖收束',
  },
];

/**
 * 文字稿 + 期望页数 → 一份像样的示例大纲(教学页序:引入 → 概念/推导/例题/变式/易错 → 练习 → 小结)
 * body 为 3~5 条完整句要点(每行一条,前缀「· 」);imagePrompt = 统一版式要求 + 该页配图说明 + 页码,
 * 与真实链路的提示词组装口径一致(见 pages/courseware/README.md)。
 */
export function coursewareOutline(
  sourceText: string, pageCount: number, style: CoursewareStyleInput = { id: DEFAULT_STYLE_ID },
): { title: string; body: string; imagePrompt: string }[] {
  const topic = outlineTopic(sourceText);
  const styleName = styleLabel(style);
  const count = Math.min(20, Math.max(3, Math.round(pageCount) || 8));
  const tail = count >= 5 ? STAGE_TAIL : STAGE_TAIL.slice(1);
  const middleCount = Math.max(0, count - 1 - tail.length);
  const middle = Array.from({ length: middleCount }, (_, i) => ({ stage: STAGE_MIDDLE[i % STAGE_MIDDLE.length], round: Math.floor(i / STAGE_MIDDLE.length) }));
  const stages = [
    { stage: STAGE_HEAD, round: 0 },
    ...middle,
    ...tail.map((stage) => ({ stage, round: 0 })),
  ];
  return stages.map(({ stage, round }) => {
    const title = `${stage.label(topic)}${round > 0 ? `(${round + 1})` : ''}`;
    return {
      title,
      body: stage.bullets(topic).map((b) => `· ${b}`).join('\n'),
      imagePrompt: `【风格:${styleName}】${stage.figure(topic)}`,
    };
  });
}

export interface CoursewareJobPageState {
  seq: number; title: string; body: string; imagePrompt: string;
  /** 入队时组装的最终提示词(风格前缀 + 整页内容 + 页码);真实后端同口径,见 README */
  finalPrompt: string;
  status: 'pending' | 'done' | 'failed';
  imageUrl?: string;
  /** 该页出图的预计结算时刻(时间驱动模拟:到点即按 mock 规则结算) */
  dueAt: number;
  /** 已重试过 → 不再触发固定失败 */
  retried: boolean;
}

export interface CoursewareJobState {
  id: string; name: string;
  lessonId: number | null; kpNodeId: number | null;
  /** 整套课件的 PPT 风格(逐页出图共用) */
  style: CoursewareStyleInput;
  pages: CoursewareJobPageState[];
  /** 全部页完成后落资源库产生的 Resource id */
  resourceId: number | null;
  createdAt: number;
}

/** 内存 job 表(module 级,页面刷新即重置;测试可直接改 dueAt 模拟时间流逝) */
export const coursewareJobs = new Map<string, CoursewareJobState>();
let coursewareJobSeq = 0;

export function createCoursewareJob(input: {
  name: string; lessonId?: number | null; kpNodeId?: number | null;
  style?: CoursewareStyleInput;
  pages: { title: string; body: string; imagePrompt: string }[];
}): CoursewareJobState {
  const now = Date.now();
  const style: CoursewareStyleInput = { id: input.style?.id ?? DEFAULT_STYLE_ID, customText: input.style?.customText };
  const total = input.pages.length;
  const job: CoursewareJobState = {
    id: `cw-job-${++coursewareJobSeq}`,
    name: input.name,
    lessonId: input.lessonId ?? null,
    kpNodeId: input.kpNodeId ?? null,
    style,
    resourceId: null,
    createdAt: now,
    pages: input.pages.map((p, i) => ({
      seq: i + 1, title: p.title, body: p.body, imagePrompt: p.imagePrompt,
      // 真实后端在入队时做同样的组装:风格前缀 + 整页内容 + 页码
      finalPrompt: composePagePrompt({ style, page: p, seq: i + 1, total }),
      status: 'pending', dueAt: now + (i + 1) * COURSEWARE_MS_PER_PAGE, retried: false,
    })),
  };
  coursewareJobs.set(job.id, job);
  return job;
}

/**
 * 成品落资源库(type=ppt),形状对齐真实后端 courseware-page.service.createResource:
 * - `ossKey` = **首页整页图**(真实是 resource/…/page-1.png;mock 无对象存储,直接放
 *   首页图的 data URI —— resolveOssUrl 对 data: 原样放行,预览仍看得到真图)
 * - `meta.pages` = **逐页对象数组**(seq/title/body/imageOssKey),不是页数数字
 * 此前 mock 用 `pages: 数字` + 自造的 pageTitles/imageUrls,与后端对不上,课堂逐页渲染
 * (classroom buildCourseware 只认对象数组)在 mock 下永远走不到。
 */
function publishCourseware(job: CoursewareJobState): number {
  const id = Math.max(0, ...resources.map((r) => r.id)) + 1;
  const cover = job.pages[0]?.imageUrl ?? `ai/courseware/${job.id}/page-1.png`;
  resources.unshift({
    id, type: 'ppt', name: job.name,
    ossKey: cover,
    size: job.pages.length * 1_250_000,
    meta: {
      kind: 'ai_courseware',
      styleId: job.style.id,
      styleName: styleLabel(job.style),
      pages: job.pages.map((p) => ({
        seq: p.seq,
        title: p.title,
        body: p.body,
        imageOssKey: p.imageUrl ?? null,
      })),
    },
    usedByLessons: [],
    kpNodeId: job.kpNodeId,
    kpNodeName: job.kpNodeId == null ? null : (kpNodes.find((n) => n.id === job.kpNodeId)?.name ?? null),
    createdAt: new Date().toISOString(),
  });
  return id;
}

/** 时间驱动推进:每次查询按经过时间结算到点的页;第 COURSEWARE_FAIL_SEQ 页首轮固定失败 */
export function advanceCoursewareJob(job: CoursewareJobState): CoursewareJobState {
  const now = Date.now();
  for (const p of job.pages) {
    if (p.status !== 'pending' || now < p.dueAt) continue;
    if (p.seq === COURSEWARE_FAIL_SEQ && !p.retried) { p.status = 'failed'; continue; }
    p.status = 'done';
    p.imageUrl = slideImage({
      seq: p.seq, title: p.title, body: p.body, total: job.pages.length,
      styleId: job.style.id, customText: job.style.customText,
    });
  }
  const allDone = job.pages.every((p) => p.status === 'done');
  if (allDone && job.resourceId == null) job.resourceId = publishCourseware(job);
  return job;
}

/** 重试失败页:转 pending 并重新排期(下一轮必成功) */
export function retryCoursewareJob(job: CoursewareJobState): CoursewareJobState {
  const now = Date.now();
  for (const p of job.pages) {
    if (p.status !== 'failed') continue;
    p.status = 'pending';
    p.retried = true;
    p.dueAt = now + COURSEWARE_MS_PER_PAGE;
  }
  return job;
}
