/**
 * 课堂数据层:WS 客户端 ↔ reducer 装配
 * join 快照渲染 / 心跳 10s / 断线指数退避重连 / 重连快照无感恢复(全部在 ws/client + machine)
 */
import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { AnswerResponse } from '@qiming/contracts';
import { getToken } from '../../auth/token';
import { initialClassState, reduceClass, type ClassState } from './machine';
import { ClassroomWsClient, type ClassWsOptions } from './ws/client';

export interface UseClassroom {
  state: ClassState;
  /** 可点步进器/环节按钮:本地切换 + 上报 class:segment */
  gotoSegment(seq: number): void;
  /** 题格跳转(答题卡/上一题) */
  gotoQuestion(index: number): void;
  flag(questionId: number): void;
  /** 随堂作答(WS 通道);失败抛错由调用方 toast */
  answer(questionId: number, response: AnswerResponse): Promise<void>;
  aiAsk(message: string): void;
  /** 草稿输入等活跃信号(心跳 idleSec 复位) */
  touch(questionId?: number | null): void;
  /** 重连超限(conn=failed)后的手动重试 */
  retry(): void;
  /** 退出课堂(停止重连;进度在服务端) */
  leave(): void;
}

export function useClassroom(sessionId: number, wsOpts?: Partial<ClassWsOptions>): UseClassroom {
  const [state, dispatch] = useReducer(reduceClass, initialClassState);
  const clientRef = useRef<ClassroomWsClient | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const client = new ClassroomWsClient(
      { sessionId, token: getToken(), ...wsOpts },
      {
        onSnapshot: (snap, { resumed }) => dispatch({ type: 'snapshot', snap, resumed }),
        onConn: (s) => dispatch({ type: 'conn', state: s }),
        onNarration: (text) => dispatch({ type: 'narration', text }),
        onAiChunk: (p) => dispatch({ type: 'ai_chunk', ...p }),
        onControl: (control) => dispatch({ type: 'control', control }),
        onState: (self) => dispatch({ type: 'state', self }),
        // join 业务拒绝(课堂已结束/不是本课学生等):client 已停止重连,这里进错误态渲染;
        // 非拒绝类异常(live 期间业务报错)不改连接状态,仅记录
        onException: (p, { rejected }) => {
          if (rejected) dispatch({ type: 'rejected', message: p.message });
          else console.warn('[classroom] exception:', p.message);
        },
      },
    );
    clientRef.current = client;
    client.connect();
    return () => {
      client.close();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const actions = useMemo<Omit<UseClassroom, 'state'>>(() => ({
    gotoSegment(seq) {
      dispatch({ type: 'segment', seq });
      clientRef.current?.segment(seq);
    },
    gotoQuestion(index) {
      dispatch({ type: 'goto', index });
      const qid = stateRef.current.questions[index]?.questionId ?? null;
      clientRef.current?.markActivity(qid);
    },
    flag(questionId) { dispatch({ type: 'flag', questionId }); },
    async answer(questionId, response) {
      const c = clientRef.current;
      if (!c) throw new Error('连接尚未建立');
      const result = await c.answer(questionId, response);
      dispatch({ type: 'answered', questionId, response, result });
    },
    aiAsk(message) {
      const text = message.trim();
      if (!text) return;
      dispatch({ type: 'ai_user', text });
      const qid = stateRef.current.questions[stateRef.current.quiz.current]?.questionId ?? null;
      clientRef.current?.aiAsk(text, qid);
    },
    touch(questionId) { clientRef.current?.markActivity(questionId); },
    retry() { clientRef.current?.retry(); },
    leave() { clientRef.current?.close(); },
  }), []);

  return { state, ...actions };
}
