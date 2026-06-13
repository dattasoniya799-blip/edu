/**
 * 学生域 msw 有状态 store(B5)
 * - attempt 进度持续保存:浏览器持久化到 sessionStorage(刷新后断点续答可恢复),node(冒烟/vitest)纯内存。
 * - 判分口径对齐 A5(apps/server/README.md):
 *   · POST /student/attempts:已有 in_progress 直接返回(断点续答);submitted/graded 后再 POST → attempt_no+1 新开
 *   · single/multi 即时判分(multi 乱序判对);blank 归一化(去空格+全角转半角);判错才下发 correctAnswer+解析
 *   · solution 存 photoOssKey/text,judged=false(预批队列,mock 不批)
 *   · 交卷:汇总客观分;卷面无 solution → 自动 graded 出分;redo/correction 答对 correct_redo_count+1,达 2 → cleared;
 *     再错 wrong_count+1、re-open 并重置 correct_redo_count
 * - mock 简化(README 注明):客观题错题入账在交卷时立即生效(真实后端在教师 finalize 出分时)。
 * - 题面下发:attempt 响应附 questions(契约 AttemptDto.questions: AttemptQuestionView[]);
 *   correctAnswer/analysisLatex 仅在 status != 'in_progress'(已判/交卷后)下发,作答中为 null(防作弊)。
 */
import type {
  AnswerResponse, AssignmentDto, AttemptDto, AttemptStatus, QuestionDto,
} from '@qiming/contracts';
// 错题项视图含 subject(FIX3 问题5,WrongBookItem 契约暂无,mock 先行)
import type { WrongBookItemView } from './data';
import type { AttemptQuestionView, AttemptWithQuestions } from '../pages/homework/types';
import * as D from './data';

// ---------- 业务错误(handlers 映射为 HTTP 409/404) ----------
export class StoreError extends Error {
  constructor(public code: number, message: string) { super(message); }
}

// ---------- 状态形状 ----------
interface StoredAnswer {
  questionId: number;
  response: AnswerResponse | null;
  isCorrect: boolean | null;
  score: number | null;
  flagged: boolean;
}
interface StoredAttempt {
  id: number; assignmentId: number; status: AttemptStatus; attemptNo: number;
  startedAt: string; submittedAt: string | null;
  score: number | null; objectiveScore: number | null; subjectiveScore: number | null;
  answers: StoredAnswer[];
}
interface PaperRef { id: number; name: string; questions: { questionId: number; score: number }[] }
interface State {
  attempts: StoredAttempt[];
  wrongBook: WrongBookItemView[];
  /** redo / redo-all 动态生成的作业与卷面 */
  extraAssignments: AssignmentDto[];
  extraPapers: PaperRef[];
  nextAttemptId: number; nextAssignmentId: number; nextPaperId: number; nextWrongId: number;
}

const KEY = 'qiming-student-mock-state-v2';

function seedState(): State {
  return {
    attempts: [{ ...D.attempt, answers: D.attempt.answers.map((a) => ({ ...a })) }],
    wrongBook: D.wrongBook.map((w) => ({ ...w, errorTags: [...w.errorTags] })),
    extraAssignments: [],
    extraPapers: [],
    nextAttemptId: 2, nextAssignmentId: 700, nextPaperId: 700, nextWrongId: D.wrongBook.length + 1,
  };
}

function load(): State {
  if (typeof sessionStorage === 'undefined') return seedState();
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as State) : seedState();
  } catch {
    return seedState();
  }
}

let state: State = load();

function save(): void {
  if (typeof sessionStorage === 'undefined') return;
  try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 配额满等忽略 */ }
}

/** 测试/演示复位 */
export function resetStore(): void {
  state = seedState();
  save();
}

// ---------- 取数辅助 ----------
const questionById = (qid: number): QuestionDto | undefined => D.questions.find((q) => q.id === qid);

function paperOf(assignmentId: number): PaperRef {
  const asg = assignmentById(assignmentId);
  if (!asg) throw new StoreError(4040, '作业不存在');
  const seedPaper = D.papers.find((p) => p.id === asg.paperId);
  if (seedPaper) {
    return { id: seedPaper.id, name: seedPaper.name, questions: seedPaper.questions.map((q) => ({ questionId: q.questionId, score: q.score })) };
  }
  const extra = state.extraPapers.find((p) => p.id === asg.paperId);
  if (!extra) throw new StoreError(4040, '试卷不存在');
  return extra;
}

export function assignmentById(id: number): AssignmentDto | undefined {
  return [...D.assignments, ...state.extraAssignments].find((a) => a.id === id);
}

export function listAssignments(status: 'pending' | 'done' | 'all'): AssignmentDto[] {
  const all = [...D.assignments, ...state.extraAssignments];
  if (status === 'all') return all;
  const done = (a: AssignmentDto) =>
    state.attempts.some((at) => at.assignmentId === a.id && at.status !== 'in_progress');
  return all.filter((a) => (status === 'done' ? done(a) : !done(a)));
}

// ---------- 判分(A5 口径) ----------
/** blank 归一化:去空格 + 全角转半角(含全角空格) */
export function normalizeBlank(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, '')
    .replace(/\s+/g, '');
}

/**
 * 含公式的填空(2026-06-13 行为约定):参考答案为 LaTeX(含控制符 `\`)→ 视为公式填空,
 * 不即时判分,交卷后走 AI 预批+教师复核(answer.isCorrect 置 null,与解答题同管线)。
 * 检测口径与后端一致:参考答案任一空含反斜杠即判定为公式填空。
 */
export function isFormulaBlank(q: QuestionDto): boolean {
  if (q.type !== 'blank') return false;
  const ans = q.answer;
  return !!ans && 'texts' in ans && ans.texts.some((t) => /\\/.test(t));
}

/** 客观题判定;solution 返回 null(不即时判) */
export function judge(q: QuestionDto, r: AnswerResponse): boolean | null {
  const ans = q.answer;
  if (!ans) return null;
  if (q.type === 'single') return 'choice' in r && 'choice' in ans && r.choice === ans.choice;
  if (q.type === 'multi') {
    if (!('choices' in r) || !('choices' in ans)) return false;
    return [...r.choices].sort().join(',') === [...ans.choices].sort().join(',');
  }
  if (q.type === 'blank') {
    if (!('texts' in r) || !('texts' in ans)) return false;
    return ans.texts.length === r.texts.length && ans.texts.every((t, i) => normalizeBlank(t) === normalizeBlank(r.texts[i] ?? ''));
  }
  return null; // solution
}

/** 正确答案的展示串(契约 SubmitAnswerResult.correctAnswer: string) */
export function formatCorrectAnswer(q: QuestionDto): string | null {
  const ans = q.answer;
  if (!ans) return null;
  if ('choice' in ans) return ans.choice;
  if ('choices' in ans) return [...ans.choices].sort().join(',');
  if ('texts' in ans) return ans.texts.join('; ');
  return ans.referenceLatex;
}

/** response 形状与题型校验(A5:形状不符 → 400) */
function shapeOk(q: QuestionDto, r: AnswerResponse): boolean {
  if (q.type === 'single') return 'choice' in r;
  if (q.type === 'multi') return 'choices' in r;
  if (q.type === 'blank') return 'texts' in r;
  return 'photoOssKey' in r || 'text' in r; // solution
}

// ---------- attempt 视图 ----------
function toQuestionViews(at: StoredAttempt): AttemptQuestionView[] {
  const paper = paperOf(at.assignmentId);
  const revealed = at.status !== 'in_progress';
  return paper.questions.map((pq, i) => {
    const q = questionById(pq.questionId)!;
    return {
      seq: i + 1,
      questionId: q.id,
      score: pq.score,
      type: q.type,
      stemLatex: q.stemLatex,
      figures: q.figures,
      options: q.options.map((o) => ({ label: o.label, contentLatex: o.contentLatex })),
      // 契约口径:correctAnswer 为 QuestionAnswer 对象;in_progress 不下发(防作弊)
      correctAnswer: revealed ? (q.answer ?? null) : null,
      analysisLatex: revealed ? q.analysisLatex : null,
    };
  });
}

function toDto(at: StoredAttempt): AttemptWithQuestions {
  const paper = paperOf(at.assignmentId);
  const byQid = new Map(at.answers.map((a) => [a.questionId, a]));
  const base: Omit<AttemptDto, 'questions'> = {
    id: at.id, assignmentId: at.assignmentId, status: at.status, attemptNo: at.attemptNo,
    startedAt: at.startedAt, submittedAt: at.submittedAt,
    score: at.score, objectiveScore: at.objectiveScore, subjectiveScore: at.subjectiveScore,
    answers: paper.questions.map((pq) => {
      const a = byQid.get(pq.questionId);
      return {
        questionId: pq.questionId,
        response: a?.response ?? null,
        isCorrect: a?.isCorrect ?? null,
        score: a?.score ?? null,
        flagged: a?.flagged ?? false,
      };
    }),
  };
  return { ...base, questions: toQuestionViews(at) };
}

// ---------- 学生接口实现 ----------
/** POST /student/attempts:in_progress 幂等返回(断点续答);否则 attempt_no+1 新开 */
export function startAttempt(assignmentId: number): AttemptWithQuestions {
  const paper = paperOf(assignmentId); // 不存在 → 404
  const inProgress = state.attempts.find((a) => a.assignmentId === assignmentId && a.status === 'in_progress');
  if (inProgress) return toDto(inProgress);
  const attemptNo = state.attempts.filter((a) => a.assignmentId === assignmentId).length + 1;
  const created: StoredAttempt = {
    id: state.nextAttemptId++,
    assignmentId, status: 'in_progress', attemptNo,
    startedAt: new Date().toISOString(), submittedAt: null,
    score: null, objectiveScore: null, subjectiveScore: null,
    answers: paper.questions.map((pq) => ({ questionId: pq.questionId, response: null, isCorrect: null, score: null, flagged: false })),
  };
  state.attempts.push(created);
  save();
  return toDto(created);
}

/** GET /student/attempts/{id}:断点续答快照 */
export function getAttempt(id: number): AttemptWithQuestions {
  const at = state.attempts.find((a) => a.id === id);
  if (!at) throw new StoreError(4040, '作答不存在');
  return toDto(at);
}

export interface SubmitAnswerResult {
  judged: boolean; isCorrect: boolean | null; correctAnswer: string | null; analysisLatex: string | null;
}

/** PUT /student/attempts/{id}/answers/{qid} */
export function putAnswer(attemptId: number, qid: number, body: { response: AnswerResponse; flagged?: boolean }): SubmitAnswerResult {
  const at = state.attempts.find((a) => a.id === attemptId);
  if (!at) throw new StoreError(4040, '作答不存在');
  if (at.status !== 'in_progress') throw new StoreError(4502, '作答状态冲突:已交卷');
  const slot = at.answers.find((a) => a.questionId === qid);
  if (!slot) throw new StoreError(4040, '非本卷题目');
  const q = questionById(qid)!;
  if (!shapeOk(q, body.response)) throw new StoreError(4000, 'response 形状与题型不符');

  const paper = paperOf(at.assignmentId);
  const full = paper.questions.find((p) => p.questionId === qid)?.score ?? 5;
  // 公式填空与解答题一样不即时判分:isCorrect=null、judged=false(前端显示「待批改」)
  const formulaBlank = isFormulaBlank(q);
  const isCorrect = formulaBlank ? null : judge(q, body.response);
  slot.response = body.response;
  slot.isCorrect = isCorrect;
  slot.score = isCorrect == null ? null : isCorrect ? full : 0;
  if (body.flagged !== undefined) slot.flagged = body.flagged;
  save();

  const wrong = isCorrect === false;
  return {
    judged: q.type !== 'solution' && !formulaBlank,
    isCorrect,
    correctAnswer: wrong ? formatCorrectAnswer(q) : null,
    analysisLatex: wrong ? q.analysisLatex : null,
  };
}

/** POST /student/attempts/{id}/submit */
export function submitAttempt(id: number): AttemptWithQuestions {
  const at = state.attempts.find((a) => a.id === id);
  if (!at) throw new StoreError(4040, '作答不存在');
  if (at.status !== 'in_progress') throw new StoreError(4502, '重复交卷');
  // 待复核 = 解答题 + 公式填空(均 isCorrect=null,走教师复核管线)
  const hasManualReview = at.answers.some((a) => {
    const q = questionById(a.questionId)!;
    return q.type === 'solution' || isFormulaBlank(q);
  });
  at.submittedAt = new Date().toISOString();
  at.objectiveScore = at.answers.reduce((s, a) => s + (a.isCorrect != null ? (a.score ?? 0) : 0), 0);
  if (hasManualReview) {
    at.status = 'submitted'; // 含主观题/公式填空 → 教师 finalize 后出分(mock 不批)
  } else {
    at.status = 'graded';
    at.subjectiveScore = 0;
    at.score = at.objectiveScore;
  }
  settleWrongBook(at);
  save();
  return toDto(at);
}

/** 错题入账/消账(mock 简化:客观题在交卷时立即生效) */
function settleWrongBook(at: StoredAttempt): void {
  const asg = assignmentById(at.assignmentId);
  const isRedoKind = asg?.kind === 'wrong_redo' || asg?.kind === 'correction';
  for (const a of at.answers) {
    if (a.isCorrect == null) continue; // solution 不在交卷时结算
    const q = questionById(a.questionId)!;
    const existing = state.wrongBook.find((w) => w.questionId === a.questionId);
    if (a.isCorrect === false) {
      if (existing) {
        existing.wrongCount += 1;
        existing.status = 'open';
        existing.correctRedoCount = 0; // 再错:re-open 并重置
      } else {
        state.wrongBook.push({
          id: state.nextWrongId++, questionId: q.id, type: q.type, stemLatex: q.stemLatex,
          analysisLatex: q.analysisLatex, wrongCount: 1, correctRedoCount: 0,
          errorTags: [q.tags[0]?.name ?? '待归因'], status: 'open',
          sourceName: asg?.paperName ?? '练习', createdAt: new Date().toISOString(),
          subject: q.subject, // FIX3 问题5:新入账错题携带学科(契约变更申请 FIX3-1)
        });
      }
    } else if (isRedoKind && existing && existing.status === 'open') {
      existing.correctRedoCount += 1;
      if (existing.correctRedoCount >= 2) existing.status = 'cleared'; // 重做对 2 次自动移出
    }
  }
}

// ---------- 错题本 ----------
export function listWrongBook(status?: string): WrongBookItemView[] {
  return state.wrongBook
    .filter((w) => !status || w.status === status)
    .map((w) => ({ ...w, errorTags: [...w.errorTags] }));
}

function createRedoAssignment(items: WrongBookItemView[], name: string): AssignmentDto {
  const paper: PaperRef = {
    id: state.nextPaperId++,
    name,
    questions: items.map((w) => {
      // redo 卷分值沿用来源卷面分,缺省 5(A5 口径)
      const fromPaper = D.papers.flatMap((p) => p.questions).find((pq) => pq.questionId === w.questionId);
      return { questionId: w.questionId, score: fromPaper?.score ?? 5 };
    }),
  };
  state.extraPapers.push(paper);
  const asg: AssignmentDto = {
    id: state.nextAssignmentId++, paperId: paper.id, paperName: name, lessonId: null,
    kind: 'wrong_redo', target: { studentIds: [D.ME_STUDENT.id] },
    publishAt: new Date().toISOString(), dueAt: null, scoreCounted: false,
    questionCount: paper.questions.length, totalScore: paper.questions.reduce((s, q) => s + q.score, 0),
  };
  state.extraAssignments.push(asg);
  save();
  return asg;
}

/** POST /student/wrong-book/{id}/redo */
export function redoOne(wrongId: number): AssignmentDto {
  const w = state.wrongBook.find((x) => x.id === wrongId);
  if (!w) throw new StoreError(4040, '错题不存在');
  if (w.status === 'cleared') throw new StoreError(4503, '错题已消灭,不可重做');
  return createRedoAssignment([w], `错题重做 · ${w.errorTags[0] ?? ''}`.trim());
}

/** POST /student/wrong-book/redo-all */
export function redoAll(): AssignmentDto {
  const open = state.wrongBook.filter((w) => w.status === 'open');
  if (open.length === 0) throw new StoreError(4503, '没有待重练的错题');
  return createRedoAssignment(open, `错题重练卷 · ${open.length} 题`);
}

// ---------- 今日 / 报告 / 讲次 ----------
function progressOf(assignmentId: number, total: number): { answered: number; total: number; status: string } {
  const list = state.attempts.filter((a) => a.assignmentId === assignmentId);
  const latest = list[list.length - 1];
  if (!latest) return { answered: 0, total, status: 'not_started' };
  return {
    answered: latest.answers.filter((a) => a.response != null).length,
    total,
    status: latest.status === 'in_progress' ? 'in_progress' : latest.status,
  };
}

export function todayView() {
  const tasks = [...D.assignments, ...state.extraAssignments].map((a) => ({
    assignmentId: a.id,
    kind: a.kind,
    title: a.paperName,
    questionCount: a.questionCount,
    dueAt: a.dueAt,
    progress: progressOf(a.id, a.questionCount),
  }));
  return { todayLesson: D.studentTodayLesson, tasks };
}

export function reportView() {
  return {
    mastery: D.mastery,
    weekStats: { ...D.studentWeekStats, wrongOpenCount: state.wrongBook.filter((w) => w.status === 'open').length },
  };
}

/** GET /student/courses/{id}/lessons(resources 字段 = 契约变更申请 B5-1 之回看入口) */
export function lessonTimeline(courseId: number) {
  if (courseId !== 1) return [];
  const hw = state.attempts.filter((a) => a.assignmentId === 1).pop();
  const hwPaper = D.papers.find((p) => p.id === 2)!;
  // 错题口径(A5):客观题 isCorrect=false;主观题未拿满分=错
  const hwWrong = hw
    ? hw.answers.filter((a) => {
        const full = hwPaper.questions.find((pq) => pq.questionId === a.questionId)?.score ?? 5;
        return a.isCorrect === false || (a.isCorrect == null && a.score != null && a.score < full);
      }).length
    : 0;
  return D.lessons.map((lesson) => ({
    lesson,
    myHomework: lesson.id === 3 ? { assignmentId: 1, score: hw?.score ?? null, wrongCount: hwWrong } : null,
    resources: lesson.id === 3
      ? [{ id: 2, name: D.resources[1].name, type: D.resources[1].type }]
      : lesson.id === 4
        ? [{ id: 1, name: D.resources[0].name, type: D.resources[0].type }]
        : [],
  }));
}
