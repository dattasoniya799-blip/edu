// @vitest-environment jsdom
/**
 * 拍照预批门禁两态(E1)+ 时间线删除「回看课件」后的渲染。
 *
 * 门禁只管「AI 预批」这层展示:关(当前 photo_pregrade=off)时作业流里一个「预批」字都不出现,
 * 但拍照上传作为作答附件的入口必须原样保留 —— 这是本用例的核心断言。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LessonDto } from '@qiming/contracts';
import { QuestionPanel } from '../homework/QuestionPanel';
import type { AttemptQuestionView } from '../homework/types';
import type { ItemState } from '../homework/machine';
import { LessonTimeline, type TimelineItem } from '../course/LessonTimeline';

const qSolution: AttemptQuestionView = {
  seq: 1, questionId: 4, score: 12, type: 'solution',
  stemLatex: '已知一次函数经过 $(1,3)$ 与 $(2,5)$,求解析式。',
  figures: [], options: [], correctAnswer: null, analysisLatex: null,
};
const submitted: ItemState = {
  questionId: 4,
  response: { photoOssKey: 'demo/answer/4.jpg' },
  flagged: false,
  feedback: { judged: false, isCorrect: null, correctAnswer: null, analysisLatex: null },
};
const noop = () => undefined;
const asyncNoop = () => Promise.resolve('k');

const solutionHtml = (preGrade: boolean) =>
  renderToStaticMarkup(
    <QuestionPanel q={qSolution} item={submitted} draft={null} onDraft={noop} onUploadPhoto={asyncNoop} preGrade={preGrade} />,
  );

describe('拍照预批门禁(photo_pregrade)', () => {
  it('关(默认)→ 不出现「预批」字样,提交后只说待老师批改', () => {
    const html = solutionHtml(false);
    expect(html).not.toContain('预批');
    expect(html).toContain('待老师批改');
    expect(html).toContain('由老师批改给分');
  });

  it('开 → 恢复 AI 预批文案', () => {
    const html = solutionHtml(true);
    expect(html).toContain('待 AI 预批');
    expect(html).toContain('AI 预批后由老师复核');
  });

  it('两态下拍照上传入口都在(门禁不碰作答附件能力)', () => {
    for (const preGrade of [false, true]) {
      const html = renderToStaticMarkup(
        <QuestionPanel
          q={qSolution}
          item={{ questionId: 4, response: null, flagged: false, feedback: null }}
          draft={null} onDraft={noop} onUploadPhoto={asyncNoop} preGrade={preGrade}
        />,
      );
      expect(html).toContain('📷 拍照上传');
      expect(html).toContain('拍摄纸质作答并上传');
      expect(html).toContain('type="file"');
    }
  });

  it('公式填空待批改文案同样跟着门禁走', () => {
    const qBlank: AttemptQuestionView = { ...qSolution, questionId: 7, type: 'blank', stemLatex: '解析式为 ________。' };
    const item: ItemState = {
      questionId: 7, response: { texts: ['y=2x+1'] }, flagged: false,
      feedback: { judged: false, isCorrect: null, correctAnswer: null, analysisLatex: null },
    };
    const off = renderToStaticMarkup(<QuestionPanel q={qBlank} item={item} draft={null} onDraft={noop} preGrade={false} />);
    expect(off).toContain('待批改');
    expect(off).not.toContain('预批');
    expect(renderToStaticMarkup(<QuestionPanel q={qBlank} item={item} draft={null} onDraft={noop} preGrade />))
      .toContain('AI 预批');
  });
});

describe('讲次时间线(「回看课件」已删)', () => {
  const finished: LessonDto = {
    id: 3, courseId: 1, seq: 3, title: '第3讲 · 待定系数法',
    scheduledStart: '2026-06-06T06:00:00.000Z', scheduledEnd: null, status: 'finished',
    prepChecklist: {}, openingConfig: null, sessionId: null,
  };
  const render = (item: TimelineItem, correctionByLesson: Record<number, number> = {}) =>
    renderToStaticMarkup(
      <LessonTimeline items={[item]} correctionByLesson={correctionByLesson} onCorrect={noop} onEnterClass={noop} onOpenResult={noop} />,
    );

  it('已结课讲次:不再出现回看按钮,订正入口照常', () => {
    const html = render({ lesson: finished, myHomework: { assignmentId: 1, attemptId: 55, score: 16, wrongCount: 3 } }, { 3: 2 });
    expect(html).not.toContain('回看课件');
    expect(html).toContain('订正错题');
    expect(html).toContain('作业 16 分');
  });

  it('已结课且无订正 → 整条操作行不渲染(不留空按钮位)', () => {
    const html = render({ lesson: finished, myHomework: { assignmentId: 1, attemptId: null, score: 20, wrongCount: 0 } });
    expect(html).not.toContain('<button');
    expect(html).toContain('作业全对,无需订正');
  });
});
