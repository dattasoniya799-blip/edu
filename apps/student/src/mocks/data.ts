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
  QuestionFigure,
} from '@qiming/contracts';

const ORG = '鲸云演示机构';
const orgSettings: MeDto['orgSettings'] = {
  ai: { qaGuideOnly: true, preGrading: true },
  studentHours: { start: '06:00', end: '22:30' },
  deviceBinding: true,
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
  device: i === 0 ? { name: 'iPad (A2602)', boundAt: '2026-03-02T08:00:00.000Z' }
    : i === 1 ? { name: '小米平板 6', boundAt: '2026-03-05T08:00:00.000Z' } : null,
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
export const lessons: LessonDto[] = LESSON_TITLES.map((t, i) => {
  const start = new Date(Date.UTC(2026, 4, 23, 6, 0));
  start.setUTCDate(start.getUTCDate() + i * 7);
  return {
    id: i + 1, courseId: 1, seq: i + 1, title: `第${i + 1}讲 · ${t}`,
    scheduledStart: start.toISOString(),
    scheduledEnd: new Date(start.getTime() + 2 * 3600e3).toISOString(),
    status: i < 3 ? 'finished' as const : i === 3 ? 'ready' as const : 'draft' as const,
    prepChecklist: (i === 3 ? { practice: true, homework: true } : {}) as Record<string, boolean>,
    // C2 #5:开场白配置(可空)
    openingConfig: i === 3 ? { enabled: true, text: '上节课我们认识了一次函数的图象,这节课一起研究图象的平移规律。', resourceId: null } : null,
  };
});

// C2 #5:知识点单元式编排(同 unitSeq + kpNodeId 为一个单元;开场回顾 warmup 为单元外环节 unitSeq=null)
// 注:学生课堂流程(class-data)消费本数组,保留 warmup 开场回顾段。
export const segments: Record<number, LessonSegmentDto[]> = {
  4: [
    { id: 1, seq: 1, type: 'warmup', durationMin: 10, config: { source: 'auto_wrong', count: 3 }, resourceId: null, paperId: null, kpNodeId: null, kpNodeName: null, unitSeq: null },
    { id: 2, seq: 2, type: 'lecture', durationMin: 35, config: { checkpoints: [3, 8, 12, 18, 22] }, resourceId: 1, paperId: null, kpNodeId: 102, kpNodeName: '一次函数的图象', unitSeq: 1 },
    { id: 3, seq: 3, type: 'practice', durationMin: 30, config: { ai_guide: true, stuck_alert_min: 3 }, resourceId: null, paperId: 1, kpNodeId: 104, kpNodeName: '图象的平移', unitSeq: 1 },
    { id: 4, seq: 4, type: 'summary', durationMin: 25, config: { personal_consolidation: { min: 2, max: 4 } }, resourceId: null, paperId: null, kpNodeId: null, kpNodeName: null, unitSeq: 1 },
  ],
};

export const resources: ResourceDto[] = [
  {
    id: 1, type: 'interactive', name: '函数图象平移 · 动画演示', ossKey: 'demo/courseware/translation.html',
    size: 2457600, meta: { pages: 24, checkpoints: [3, 8, 12, 18, 22] },
    usedByLessons: [{ lessonId: 4, lessonTitle: '第4讲 · 一次函数的图象平移' }],
    kpNodeId: 104, kpNodeName: '图象的平移', createdAt: '2026-05-20T03:00:00.000Z',
  },
  {
    id: 2, type: 'video', name: '待定系数法 · 微课视频', ossKey: 'demo/video/undetermined.mp4',
    size: 104857600, meta: { durationSec: 756 }, usedByLessons: [],
    kpNodeId: 103, kpNodeName: '待定系数法', createdAt: '2026-05-21T03:00:00.000Z',
  },
];

export const kpGraphs: KpGraphDto[] = [
  { id: 1, code: 'pep-math-junior', graphType: 'curriculum_knowledge', subject: '数学', nodeCount: 312 },
  { id: 2, code: 'ability-math', graphType: 'problem_solving_ability', subject: '数学', nodeCount: 46 },
  { id: 3, code: 'strategy-math', graphType: 'problem_solving_strategy', subject: '数学', nodeCount: 38 },
];

const KP_NAMES = ['一次函数的概念', '一次函数的图象', '待定系数法', '图象的平移', '一次函数与方程', '函数增减性'];
export const kpNodes: KpNodeDto[] = KP_NAMES.map((name, i) => ({
  id: 101 + i, graphId: 1, code: `PEP-19-${i + 1}`, name, parentCode: 'PEP-19', level: 3,
  category: '知识点', grade: '初二', chapter: '第十九章 一次函数', section: `19.${i + 1}`,
  difficulty: 1 + (i % 3), examWeight: 0.6 + i * 0.05, summary: null, content: null,
}));

/**
 * 演示用题目插图(方案 A:figures 带 anchor,多位置插图)。
 * mock 阶段 ossKey 无可签名 URL → 学生端渲染为占位缩略框(与录题预览一致),
 * 验证 anchor 把图正确落到 题干/选项/解析/参考答案 各位置。
 */
function demoFigures(id: number): QuestionFigure[] {
  if (id === 13) return [
    { ossKey: 'demo/figures/q13-stem.png', position: 1, anchor: { target: 'stem' } },
    { ossKey: 'demo/figures/q13-optA.png', position: 2, anchor: { target: 'option', ref: 'A' } },
    { ossKey: 'demo/figures/q13-analysis.png', position: 3, anchor: { target: 'analysis' } },
  ];
  if (id === 9) return [{ ossKey: 'demo/figures/q9-stem.png', position: 1, anchor: { target: 'stem' } }];
  if (id === 4) return [
    { ossKey: 'demo/figures/q4-stem.png', position: 1, anchor: { target: 'stem' } },
    { ossKey: 'demo/figures/q4-rubric2.png', position: 2, anchor: { target: 'rubric', ref: '2' } },
  ];
  return [];
}

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
      stemLatex: stem, figures: demoFigures(i + 1), options,
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
        { nodeId: 201 + (i % 4), graphType: 'problem_solving_ability', code: `ABL-${(i % 4) + 1}`, name: ['运算求解', '数形结合', '逻辑推理', '建模'][i % 4] },
        { nodeId: 301 + (i % 3), graphType: 'problem_solving_strategy', code: `STR-${(i % 3) + 1}`, name: ['待定系数', '数形转化', '逆向还原'][i % 3] },
      ],
      stats: { correctRate: i % 4 === 3 ? null : 55 + ((i * 7) % 40), usedInPapers: i < 10 ? 1 + (i % 3) : 0 },
      ownerName: '张明', createdAt: '2026-06-02T03:00:00.000Z',
    });
  }
  return out;
}
export const questions: QuestionDto[] = genQuestions();

/**
 * 演示「含公式填空」(2026-06-13 行为约定):参考答案为 LaTeX(含控制符)的填空,
 * 交卷后不即时判分,后端置 isCorrect=null 走 AI 预批+教师复核。
 * 取一道未被流程测试占用的填空题(qid 7)改造为公式填空,简单填空(如 qid 11)保持即时判分。
 */
const formulaBlankQ = questions[6]; // qid 7
if (formulaBlankQ && formulaBlankQ.type === 'blank') {
  formulaBlankQ.stemLatex = '一次函数 $y=kx+b$ 的图象经过点 $(0,1)$ 与 $(2,2)$,则该函数的解析式为 ________。';
  formulaBlankQ.answer = { texts: ['y=\\dfrac{1}{2}x+1'] };
  formulaBlankQ.analysisLatex = '代入两点得 $k=\\dfrac{1}{2},\\,b=1$,故 $y=\\dfrac{1}{2}x+1$。';
}

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
  // 第 3 讲作业链(seed 口径):作业判出 3 道错题 → 老师下发订正卷(单选 q13 + 填空 q11 + 解答 q4)
  {
    id: 3, name: '第3讲课后作业 · 订正', type: 'homework', totalScore: 20, status: 'published',
    questions: [13, 11, 4].map((qid, j) => {
      const q = questions[qid - 1];
      return { seq: j + 1, questionId: q.id, score: j === 2 ? 10 : 5, type: q.type, stemLatex: q.stemLatex };
    }),
  },
  // 自检卷:单选(即时判分)+ 简单填空(即时判分)+ 公式填空(待批改),验证混合判分口径
  {
    id: 4, name: '混合判分 · 自检练', type: 'practice', totalScore: 15, status: 'published',
    questions: [13, 11, 7].map((qid, j) => {
      const q = questions[qid - 1];
      return { seq: j + 1, questionId: q.id, score: 5, type: q.type, stemLatex: q.stemLatex };
    }),
  },
];

export const assignments: AssignmentDto[] = [
  {
    id: 1, paperId: 2, paperName: '第3讲课后作业 · 待定系数法', lessonId: 3, kind: 'homework',
    target: { courseId: 1 }, publishAt: '2026-06-06T08:10:00.000Z', dueAt: '2026-06-10T14:00:00.000Z',
    scoreCounted: true, questionCount: 5, totalScore: 35,
  },
  {
    id: 2, paperId: 3, paperName: '第3讲课后作业 · 订正', lessonId: 3, kind: 'correction',
    target: { studentIds: [4] }, publishAt: '2026-06-10T12:30:00.000Z', dueAt: '2026-06-13T13:00:00.000Z',
    scoreCounted: false, questionCount: 3, totalScore: 20,
  },
  {
    id: 3, paperId: 4, paperName: '混合判分 · 自检练', lessonId: null, kind: 'homework',
    target: { courseId: 1 }, publishAt: '2026-06-11T08:00:00.000Z', dueAt: '2026-06-20T14:00:00.000Z',
    scoreCounted: true, questionCount: 3, totalScore: 15,
  },
];

/** 第 3 讲课后作业的已批改作答:q11(填空)/q13(单选)答错,解答 q4 得 6/10(未满分=错,A5 口径) */
// 题面(questions)由 store 的 toQuestionViews 按卷面派生,seed 仅存作答快照
export const attempt: Omit<AttemptDto, 'questions'> = {
  id: 1, assignmentId: 1, status: 'graded', attemptNo: 1,
  startedAt: '2026-06-07T10:00:00.000Z', submittedAt: '2026-06-07T10:24:00.000Z',
  score: 16, objectiveScore: 10, subjectiveScore: 6,
  answers: [9, 10, 11, 13, 4].map((qid, j) => ({
    questionId: qid,
    response: j === 4 ? { photoOssKey: 'demo/answers/1-4.jpg' } : j === 2 ? { texts: ['y=2x+1'] } : { choice: j === 3 ? 'A' : 'B' },
    isCorrect: j === 4 ? null : j !== 2 && j !== 3,
    score: j === 4 ? 6 : j === 2 || j === 3 ? 0 : 5,
    flagged: false,
  })),
};

export const gradingPending = [
  { assignmentId: 1, paperName: '第3讲课后作业 · 待定系数法', pendingCount: 4, aiAvgScore: 8.2 },
];

export const gradingItem: GradingItemDto = {
  answerId: 41, studentId: 4, studentName: '林小满', questionId: 4,
  stemLatex: questions[3].stemLatex, rubric: questions[3].rubric,
  photoUrl: null, textResponse: '设平移后直线 y=kx+b\',代入 A、B 两点解得 k=2, b\'=1;所以原直线 y=2x-2。',
  aiScore: 7, aiSteps: [{ step: 1, ok: true }, { step: 2, ok: true }, { step: 3, ok: false, comment: '还原方向错误' }],
  aiErrorTags: ['还原平移方向'], finalScore: null, comment: null,
};

/** 6 条错题(seed 口径):3 条来自第 3 讲作业链 + 3 条历史讲次 */
const WRONG_SEED: { qid: number; wrongCount: number; tags: string[]; source: string; at: string }[] = [
  { qid: 13, wrongCount: 1, tags: ['图象平移符号'], source: '第3讲课后作业 · 待定系数法', at: '2026-06-07T10:30:00.000Z' },
  { qid: 11, wrongCount: 1, tags: ['待定系数代入'], source: '第3讲课后作业 · 待定系数法', at: '2026-06-07T10:30:00.000Z' },
  { qid: 4, wrongCount: 1, tags: ['还原平移方向'], source: '第3讲课后作业 · 待定系数法', at: '2026-06-07T10:30:00.000Z' },
  { qid: 1, wrongCount: 2, tags: ['图象平移符号'], source: '第2讲随堂练', at: '2026-05-30T07:40:00.000Z' },
  { qid: 7, wrongCount: 1, tags: ['计算失误'], source: '第2讲课后作业', at: '2026-06-01T11:05:00.000Z' },
  { qid: 17, wrongCount: 1, tags: ['概念辨析'], source: '第1讲随堂练', at: '2026-05-23T07:20:00.000Z' },
];
/**
 * 错题项视图(FIX3 问题5):WrongBookItem 已正式含 `subject: string`(2026-06-13 批准,
 * 源自题目学科)。mock 直接产出契约字段;当前 seed 为数学单科 → 学科筛选优雅退化(不显示)。
 */
// C2 #7:契约 WrongBookItemDto 仅 analysisLatex;mock 前瞻下发简单/详细两档(后端补齐即生效)
export type WrongBookItemView = WrongBookItemDto & {
  analysisBriefLatex?: string | null;
  analysisDetailLatex?: string | null;
};
export const wrongBook: WrongBookItemView[] = WRONG_SEED.map((w, i) => {
  const q = questions[w.qid - 1];
  return {
    id: i + 1, questionId: q.id, type: q.type, stemLatex: q.stemLatex, analysisLatex: q.analysisLatex,
    analysisBriefLatex: q.analysisBriefLatex, analysisDetailLatex: q.analysisDetailLatex,
    wrongCount: w.wrongCount, correctRedoCount: 0, errorTags: w.tags, status: 'open',
    sourceName: w.source, createdAt: w.at, subject: q.subject,
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

export const studentTodayLesson = {
  lessonId: 4, courseName: '初二数学提高班', title: '第4讲 · 一次函数的图象平移',
  startAt: '2026-06-13T06:00:00.000Z', endAt: '2026-06-13T08:00:00.000Z',
  // B6:课堂 mock 会话已开(WS 假服务 class-data.CLASS_SESSION_ID = 401)
  canEnterAt: '2026-06-13T05:50:00.000Z', sessionId: 401,
};

/** 周数据(wrongOpenCount 由 student-store 按错题实况覆盖)
 *  correctRate 为 0–1 比值(后端口径;前端 formatCorrectRate ×100 展示),区别于 mastery 的 0–100。 */
export const studentWeekStats = { answeredCount: 38, correctRate: 0.78, studySec: 24120, wrongOpenCount: wrongBook.length };

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

export const aiHealth = {
  providers: [
    { feature: 'qa', provider: 'demo-llm', model: 'demo-model-s', healthy: true },
    { feature: 'pre_grading', provider: 'demo-llm', model: 'demo-model-s', healthy: true },
  ],
};
