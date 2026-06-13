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
} from '@qiming/contracts';

const ORG = '鲸云演示机构';
/** 全机构设置(各 Me 共享同一引用;PUT /admin/settings 时由 handlers 原地修改) */
export const orgSettings: MeDto['orgSettings'] = {
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
  // 1 名停用学生(演示「已停用」筛选 + 恢复启用);后端已改不再软删,仍可查到
  status: i === 10 ? 'disabled' : 'active',
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

/**
 * 课程在册学生(有状态 mock,入班/移出原地修改):
 * 课程 1 = 全员;课程 2 = 一对一(李一诺);新建课程默认空名单。
 */
export const courseMembers: Record<number, number[]> = {
  1: students.map((s) => s.id),
  2: students.filter((s) => s.name === '李一诺').map((s) => s.id),
};

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
    prepChecklist: (i === 3 ? { warmup: true, lecture: true, practice: true, homework: false } : {}) as Record<string, boolean>,
    // 契约 2026-06-13 新增必填:开场白配置(可空)
    openingConfig: i === 3 ? { resourceId: 1, text: '上节课我们学了图象平移,今天先回顾再练习。' } : null,
  };
});

export const segments: Record<number, LessonSegmentDto[]> = {
  4: [
    // 契约 2026-06-13 新增可空字段 unitSeq(知识点单元序号;null=单元外环节)
    { id: 1, seq: 1, type: 'warmup', durationMin: 10, config: { source: 'auto_wrong', count: 3 }, resourceId: null, paperId: null, kpNodeId: null, kpNodeName: null, unitSeq: null },
    { id: 2, seq: 2, type: 'lecture', durationMin: 35, config: { checkpoints: [3, 8, 12, 18, 22] }, resourceId: 1, paperId: null, kpNodeId: 102, kpNodeName: '一次函数的图象', unitSeq: 1 },
    { id: 3, seq: 3, type: 'practice', durationMin: 30, config: { ai_guide: true, stuck_alert_min: 3 }, resourceId: null, paperId: 1, kpNodeId: 104, kpNodeName: '图象的平移', unitSeq: 1 },
    { id: 4, seq: 4, type: 'summary', durationMin: 25, config: { personal_consolidation: { min: 2, max: 4 } }, resourceId: null, paperId: null, kpNodeId: null, kpNodeName: null, unitSeq: null },
  ],
};

export const resources: ResourceDto[] = [
  {
    id: 1, type: 'interactive', name: '函数图象平移 · 动画演示', ossKey: 'demo/courseware/translation.html',
    size: 2457600, meta: { pages: 24, checkpoints: [3, 8, 12, 18, 22] },
    usedByLessons: [{ lessonId: 4, lessonTitle: '第4讲 · 一次函数的图象平移' }], createdAt: '2026-05-20T03:00:00.000Z',
  },
  {
    id: 2, type: 'video', name: '待定系数法 · 微课视频', ossKey: 'demo/video/undetermined.mp4',
    size: 104857600, meta: { durationSec: 756 }, usedByLessons: [], createdAt: '2026-05-21T03:00:00.000Z',
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
  difficulty: 1 + (i % 3), examWeight: 0.6 + i * 0.05, summary: null,
}));

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
      analysisLatex: `平移口诀:上加下减(改 $b$)。本题 $b$ 由 $${b}$ 变化 $${d}$ 个单位。`,
      // 契约 2026-06-13 新增必填(可空):简单 / 详细解析
      analysisBriefLatex: `上加下减:向下平移 $${d}$ 个单位,$b$ 减 $${d}$。`,
      analysisDetailLatex: `平移只改变常数项 $b$,斜率 $k$ 不变。向下平移 $${d}$ 个单位即 $y=${k}x${sign(b)}-${d}$,合并得 $y=${k}x${sign(b - d)}$。`,
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
];

export const assignments: AssignmentDto[] = [
  {
    id: 1, paperId: 2, paperName: '第3讲课后作业 · 待定系数法', lessonId: 3, kind: 'homework',
    target: { courseId: 1 }, publishAt: '2026-06-06T08:10:00.000Z', dueAt: '2026-06-10T14:00:00.000Z',
    scoreCounted: true, questionCount: 5, totalScore: 35,
  },
];

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
  // 契约 2026-06-13·C1 新增必填:作答题面(admin 仅档案只读展示,题面取自题库,已判故下发答案/解析)
  questions: [9, 10, 11, 13, 4].map((qid, j) => {
    const q = questions[qid - 1];
    return {
      seq: j + 1, questionId: qid, score: j === 4 ? 10 : 5, type: q.type,
      stemLatex: q.stemLatex, figures: q.figures, options: q.options,
      correctAnswer: q.answer, analysisLatex: q.analysisLatex,
    };
  }),
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

export const wrongBook: WrongBookItemDto[] = [11, 9].map((qid, i) => {
  const q = questions[qid - 1];
  return {
    id: i + 1, questionId: q.id, type: q.type, stemLatex: q.stemLatex, analysisLatex: q.analysisLatex,
    wrongCount: 1 + i, correctRedoCount: 0, errorTags: ['图象平移符号'], status: 'open',
    sourceName: '第3讲课后作业 · 待定系数法', createdAt: '2026-06-07T10:30:00.000Z',
    subject: q.subject ?? '数学', // 契约 2026-06-13 新增必填 subject
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

export const aiHealth = {
  providers: [
    { feature: 'qa', provider: 'demo-llm', model: 'demo-model-s', healthy: true },
    { feature: 'pre_grading', provider: 'demo-llm', model: 'demo-model-s', healthy: true },
  ],
};
