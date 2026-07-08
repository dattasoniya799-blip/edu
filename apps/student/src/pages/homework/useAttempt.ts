/**
 * 答题器数据层:开始/断点续答/逐题提交/交卷(全部经 contracts createClient)
 * 断点续答:URL 带 ?attempt= → GET /student/attempts/{id} 恢复快照;
 * 否则 POST /student/attempts(契约口径:已有 in_progress 直接返回 = 同样能续答)。
 *
 * 409 两态兜底(B1/m2):
 * - 创建撞唯一约束(dev StrictMode 双发)→ 降级重试一次创建(服务端幂等化后重试即得已有
 *   attempt);仍失败才进错误态,错误态可「重试」;
 * - 「该作业已完成,不可重复作答」→ 取 GET /student/assignments?status=all 里该作业的
 *   myAttempt.attemptId,直接加载成绩单(onAttemptId 会把 ?attempt= 补进 URL);
 *   拿不到 attemptId 才进错误态(errorKind='completed',页面给「回作业列表」)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerResponse, AssignmentDto } from '@qiming/contracts';
import { api, errorMessage, isConflictAlreadyExists, isConflictAttemptCompleted } from '../../api';
import * as M from './machine';
import type { AttemptWithQuestions } from './types';

export type Phase = 'loading' | 'answering' | 'result' | 'error';
/** 错误态分类:completed=作业已完成但定位不到成绩单;load=其余加载失败(可重试) */
export type ErrorKind = 'completed' | 'load';

export interface UseAttempt {
  phase: Phase;
  attempt: AttemptWithQuestions | null;
  quiz: M.QuizState;
  /** 本次加载是恢复了已有进度(用于「已从中断处继续」提示) */
  resumed: boolean;
  error: string | null;
  errorKind: ErrorKind | null;
  submitting: boolean;
  /** 错误态重试(重新走一次加载;加载中防重入) */
  retry: () => void;
  confirm: (questionId: number, response: AnswerResponse, flagged: boolean) => Promise<void>;
  flag: (questionId: number) => void;
  goTo: (index: number) => void;
  next: () => void;
  submit: () => Promise<void>;
}

/** 已完成但作业列表里拿不到 myAttempt.attemptId(定位不到成绩单)的标记错误 */
class CompletedNoAttemptError extends Error {}

export function useAttempt(assignmentId: number, attemptIdInUrl: number | null, onAttemptId: (id: number) => void): UseAttempt {
  const [phase, setPhase] = useState<Phase>('loading');
  const [attempt, setAttempt] = useState<AttemptWithQuestions | null>(null);
  const [quiz, setQuiz] = useState<M.QuizState>({ current: 0, items: [] });
  const [resumed, setResumed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadSeq, setLoadSeq] = useState(0);
  const attemptRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;

  useEffect(() => {
    let alive = true;
    setPhase('loading');
    setError(null);
    setErrorKind(null);

    /** 拿到本次要展示的 attempt 快照(含 409 两态兜底);每次加载最多 2 次创建,不会循环 */
    const load = async (): Promise<AttemptWithQuestions> => {
      if (attemptIdInUrl != null) {
        const r = await api.get('/student/attempts/{id}', { params: { id: attemptIdInUrl } });
        return r.data as AttemptWithQuestions;
      }
      const create = async () =>
        (await api.post('/student/attempts', { body: { assignmentId } })).data as AttemptWithQuestions;
      try {
        return await create();
      } catch (e) {
        if (isConflictAlreadyExists(e)) {
          // B1:StrictMode 双发撞唯一约束 → 降级重试一次(仍失败走外层错误态,可手动重试)
          return await create();
        }
        if (isConflictAttemptCompleted(e)) {
          // m2:已完成作业无 ?attempt= 直开 → 从作业列表定位 myAttempt.attemptId 看成绩单
          const list = (await api.get('/student/assignments', { query: { status: 'all' } })).data as AssignmentDto[];
          const attemptId = list.find((a) => a.id === assignmentId)?.myAttempt?.attemptId;
          if (attemptId != null) {
            const r = await api.get('/student/attempts/{id}', { params: { id: attemptId } });
            return r.data as AttemptWithQuestions;
          }
          throw new CompletedNoAttemptError('该作业已完成,但未能定位到你的作答记录,请从作业列表进入');
        }
        throw e;
      }
    };

    (async () => {
      try {
        const at = await load();
        if (!alive) return;
        attemptRef.current = at.id;
        onAttemptId(at.id);
        setAttempt(at);
        const q = M.initQuiz(at);
        setQuiz(q);
        if (at.status !== 'in_progress') {
          setPhase('result');
        } else {
          setResumed(M.answeredCount(q) > 0);
          setPhase('answering');
        }
      } catch (e) {
        if (!alive) return;
        setError(errorMessage(e, '加载失败,请重试'));
        setErrorKind(e instanceof CompletedNoAttemptError ? 'completed' : 'load');
        setPhase('error');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, attemptIdInUrl, loadSeq]);

  const retry = useCallback(() => {
    if (phaseRef.current === 'loading') return; // 防重入:加载中忽略
    setLoadSeq((n) => n + 1);
  }, []);

  const confirm = useCallback(async (questionId: number, response: AnswerResponse, flagged: boolean) => {
    const id = attemptRef.current;
    if (id == null) return;
    const r = await api.put('/student/attempts/{id}/answers/{qid}', {
      params: { id, qid: questionId },
      body: { response: response as never, flagged },
    });
    const fb = r.data as { judged: boolean; isCorrect: boolean | null; correctAnswer: string | null; analysisLatex: string | null };
    setQuiz((s) => M.applyAnswer(s, questionId, response, fb));
  }, []);

  const flag = useCallback((questionId: number) => setQuiz((s) => M.toggleFlag(s, questionId)), []);
  const goTo = useCallback((index: number) => setQuiz((s) => M.goTo(s, index)), []);
  const next = useCallback(() => setQuiz((s) => M.goTo(s, M.nextIndex(s))), []);

  const submit = useCallback(async () => {
    const id = attemptRef.current;
    if (id == null) return;
    setSubmitting(true);
    try {
      await api.post('/student/attempts/{id}/submit', { params: { id } });
      // 交卷后重新拉快照:此时 questions 才下发 correctAnswer/analysisLatex(看解析)
      const r = await api.get('/student/attempts/{id}', { params: { id } });
      const at = r.data as AttemptWithQuestions;
      setAttempt(at);
      setQuiz(M.initQuiz(at));
      setPhase('result');
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { phase, attempt, quiz, resumed, error, errorKind, submitting, retry, confirm, flag, goTo, next, submit };
}
