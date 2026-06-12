/**
 * 答题器数据层:开始/断点续答/逐题提交/交卷(全部经 contracts createClient)
 * 断点续答:URL 带 ?attempt= → GET /student/attempts/{id} 恢复快照;
 * 否则 POST /student/attempts(契约口径:已有 in_progress 直接返回 = 同样能续答)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnswerResponse } from '@qiming/contracts';
import { api, errorMessage } from '../../api';
import * as M from './machine';
import type { AttemptWithQuestions } from './types';

export type Phase = 'loading' | 'answering' | 'result' | 'error';

export interface UseAttempt {
  phase: Phase;
  attempt: AttemptWithQuestions | null;
  quiz: M.QuizState;
  /** 本次加载是恢复了已有进度(用于「已从中断处继续」提示) */
  resumed: boolean;
  error: string | null;
  submitting: boolean;
  confirm: (questionId: number, response: AnswerResponse, flagged: boolean) => Promise<void>;
  flag: (questionId: number) => void;
  goTo: (index: number) => void;
  next: () => void;
  submit: () => Promise<void>;
}

export function useAttempt(assignmentId: number, attemptIdInUrl: number | null, onAttemptId: (id: number) => void): UseAttempt {
  const [phase, setPhase] = useState<Phase>('loading');
  const [attempt, setAttempt] = useState<AttemptWithQuestions | null>(null);
  const [quiz, setQuiz] = useState<M.QuizState>({ current: 0, items: [] });
  const [resumed, setResumed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const attemptRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    setPhase('loading');
    (async () => {
      try {
        const r = attemptIdInUrl != null
          ? await api.get('/student/attempts/{id}', { params: { id: attemptIdInUrl } })
          : await api.post('/student/attempts', { body: { assignmentId } });
        if (!alive) return;
        const at = r.data as AttemptWithQuestions;
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
        setPhase('error');
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, attemptIdInUrl]);

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

  return { phase, attempt, quiz, resumed, error, submitting, confirm, flag, goTo, next, submit };
}
