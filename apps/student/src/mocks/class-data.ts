/**
 * 课堂模式 mock 数据(B6,集中于 src/mocks/,禁止散落组件)
 * 口径 = data.ts 的第 4 讲(lesson 4 · ready · segments 已编排)+ 原型 v0.4 课堂各段文案。
 * 题面沿用 B5-1 学生视图形状(pages/homework/types.ts);课件分页/打点小测为 mock 增量
 * (契约无载体,见 README「契约变更申请 B6-1」),前端对缺失字段已做降级。
 */
import type { ClassSnapshot } from '@qiming/contracts';
import type { AttemptQuestionView } from '../pages/homework/types';
import type { CoursewarePageView } from '../pages/classroom/types';
import * as D from './data';

/** 今日第 4 讲的课堂会话 id(/student/today 的 sessionId 指向它) */
export const CLASS_SESSION_ID = 401;

export const CLASS_LESSON_TITLE = '初二数学提高班 · 第 4 讲 一次函数的图象平移';

/** 环节(契约形状,来自 data.segments[4]) */
export const CLASS_SEGMENTS: ClassSnapshot['session']['segments'] =
  D.segments[4].map((s) => ({ seq: s.seq, type: s.type, durationMin: s.durationMin }));

/** 课堂模式(自由节奏 · 引导模式 · practice 环节 stuck_alert_min=3) */
export const CLASS_MODE: ClassSnapshot['session']['mode'] = {
  guideOnly: true, stuckAlertMin: 3, lockdown: false, syncSegments: false,
};

/**
 * 随堂练卷(paper 1「第4讲 · 随堂练」总分 30):大题(解答题)排最后压轴,
 * 与原型一致(第 1–4 题客观 5 分,第 5 题解答 10 分)。
 */
export const CLASS_PAPER: { questionId: number; score: number }[] = [
  { questionId: 1, score: 5 },  // single
  { questionId: 2, score: 5 },  // single
  { questionId: 3, score: 5 },  // blank
  { questionId: 5, score: 5 },  // single
  { questionId: 4, score: 10 }, // solution(大题)
];

/** 随堂练题面(B5-1 学生视图形状;课堂内不下发 correctAnswer/analysisLatex) */
export const CLASS_QUESTIONS: AttemptQuestionView[] = CLASS_PAPER.map((pq, i) => {
  const q = D.questions.find((x) => x.id === pq.questionId)!;
  return {
    seq: i + 1,
    questionId: q.id,
    score: pq.score,
    type: q.type,
    stemLatex: q.stemLatex,
    figures: q.figures,
    options: q.options.map((o) => ({ label: o.label, contentLatex: o.contentLatex })),
    correctAnswer: null,
    analysisLatex: null,
  };
});

/** 各环节 AI 旁白(原型 classNarrs) */
export const SEGMENT_NARRATIONS: Record<number, string> = {
  1: '小启:上课啦!先用 3 道上讲错题热热身,准备好了就开始~',
  2: '小启:看动画里蓝色直线整体往下「滑」——它的倾斜程度变了吗?想好了告诉我。',
  3: '小启:这道题考查的正是刚才动画里的「上加下减」。先想想:向下平移时,$b$ 会变大还是变小?',
  4: '小启:本堂课辛苦啦!错的题我已经收进错题本,课后作业里见~',
};

/** 课件分页(原型 slides 3 页节选;末页带打点小测) */
export const CLASS_COURSEWARE: CoursewarePageView[] = [
  {
    title: '什么是直线的平移?',
    body: '把直线 $y=2x+1$ 沿 $y$ 轴方向整体「滑动」——每个点都移动同样的距离,直线的形状与倾斜程度保持不变。',
    narration: '小启:看动画里蓝色直线整体往下「滑」——它的倾斜程度变了吗?想好了告诉我。',
  },
  {
    title: '向下平移 3 个单位',
    body: '$y=2x+1$ 向下平移 $3$ 个单位得到 $y=2x-2$:$k$ 没变,只有 $b$ 从 $+1$ 变成了 $-2$。',
    narration: '小启:k 没变,只有 b 从 +1 变成了 −2。这就是「上加下减」!',
  },
  {
    title: '口诀总结',
    body: '**上加下减 · 左加右减** —— 上下平移改 $b$,左右平移改 $x$。',
    narration: '小启:记住口诀后,来个小测验证一下——答对就进随堂练!',
    quiz: {
      stem: '直线 $y=2x+1$ 向下平移后,$k$ 和 $b$ 谁会变?',
      options: [
        { label: 'A', contentLatex: '只有 $b$ 变' },
        { label: 'B', contentLatex: '只有 $k$ 变' },
        { label: 'C', contentLatex: '都会变' },
      ],
      correct: 'A',
      hint: '再想想:平移不改变倾斜程度($k$)哦',
    },
  },
];

/** AI 助教 canned 回复(引导式,宪法 §4:mock 不接 LLM;命中关键词,否则默认引导) */
export const AI_REPLIES: { key: string; reply: string }[] = [
  { key: '提示', reply: '想一想:直线「向下平移」时,解析式里 $k$ 和 $b$ 哪个会变?🤔' },
  { key: '没学懂', reply: '没关系!回忆刚才课件里的动画:上加下减(改 $b$),左加右减(改 $x$)。比如 $y=2x+1$ 向上平移 $2$ 个单位 → $y=2x+3$。要不要再看一个向下的例子?' },
  { key: '例子', reply: '好!把 $y=3x+5$ 向下平移 $2$ 个单位,$b$ 从 $5$ 变成 $3$,得 $y=3x+3$。现在回到题目算算看?' },
  { key: '怎么设', reply: '平移后的直线经过 $A$、$B$ 两点,所以先设它为 $y=kx+b\'$,把两点代进去就能求出来。' },
  { key: '还原', reply: '关键来了:题目是「向下平移」得到现在这条,那原直线在它上方——还原时要把 $b$ 加回去,方向别搞反哦。' },
];

export const AI_DEFAULT_REPLY =
  '好问题!我先不直接说答案——你觉得「向下平移」会让每个点的纵坐标变大还是变小?顺着这个思路想想 $b$ 的变化。';

/** 作答旁白模板(AnswerResult.narration,A6「模板旁白」口径) */
export const NARRATION_CORRECT = '小启:答对啦 🎉 继续保持,下一题!';
export const NARRATION_WRONG = '小启:没关系,记住「上加下减」——这道题已收入错题本,小结环节我会安排同类巩固。';

/** 大题(解答题)提交后的 AI 预批旁白(结构化预批无契约载体,按行渲染 ✓/✕,README 报备) */
export const NARRATION_PRE_GRADE = [
  'AI 预批 · 8 / 10 分(最终得分以老师复核为准)',
  '✓ 步骤 1:正确判断平移后直线过 $A$、$B$ 两点,设 $y=kx+b\'$(3 分)',
  '✓ 步骤 2:联立求得 $k$、$b\'$,得到平移后直线(4 分)',
  '✕ 步骤 3:还原原直线时方向反了——应「向上加回」(本步 3 分得 1 分)',
].join('\n');
