/**
 * 课堂模式视图类型(B6)
 *
 * ⚠️ 契约缺口(模式同 B5-1,见 README「契约变更申请 B6-1」):
 * ws-protocol 的 ClassSnapshot 不含任何可渲染的题面/课件内容
 * (me.answers 仅 questionId/isCorrect/score),学生侧也没有可取
 * 随堂练题面与课件分页的端点。课堂 mock 沿用 B5-1 的学生题面视图
 * AttemptQuestionView,以 join ack 的**纯增量**字段下发:
 *   snapshot.questions  —— 随堂练卷题面(B5-1 形状)
 *   snapshot.courseware —— 课件分页(含打点小测)
 * 字段缺失时前端降级(随堂练/课件区显示不可用占位,不白屏)。
 */
import type { ClassSnapshot } from '@qiming/contracts';
import type { AttemptQuestionView } from '../homework/types';

/** 课件打点小测(lecture 环节 checkpoints 的载体,mock 形状) */
export interface MiniQuizView {
  stem: string;
  options: { label: string; contentLatex: string }[];
  /** 正确选项 label(打点小测是"软提示",客户端即时反馈即可,不走判分通道) */
  correct: string;
  hint: string;
}

/** 课件单页(mock 形状;真实后端为 OSS 资源,经签名 URL 下发) */
export interface CoursewarePageView {
  title: string;
  /** 正文(TexText 混排) */
  body: string;
  /** 翻到本页时的 AI 旁白 */
  narration: string;
  /** 打点页才有 */
  quiz?: MiniQuizView;
}

/** join ack 的快照 + mock 增量(增量字段全部可选,契约字段逐字不动) */
export type ClassJoinSnapshot = ClassSnapshot & {
  questions?: AttemptQuestionView[];
  courseware?: CoursewarePageView[];
};
