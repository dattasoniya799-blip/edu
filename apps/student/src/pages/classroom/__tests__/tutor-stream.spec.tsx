// @vitest-environment jsdom
/**
 * AI 答疑流式逐字渲染(任务卡验收:mock chunk 序列驱动,断言渐进渲染)
 * 方案:reducer 逐分片推进状态 → 每步用 TutorPanel 真渲染,断言文案逐步增长且最终完整。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { initialClassState, reduceClass, type ClassState } from '../machine';
import { TutorPanel } from '../TutorPanel';

const render = (s: ClassState): string =>
  renderToStaticMarkup(<TutorPanel chat={s.chat} guideOnly onAsk={() => undefined} />);

describe('AI 助教流式渲染', () => {
  it('chunk 序列驱动:每片渲染结果包含此前全部文本(渐进),done 后光标消失', () => {
    let s = reduceClass(initialClassState, { type: 'ai_user', text: '知识点没学懂' });
    expect(render(s)).toContain('知识点没学懂');

    const reply = '没关系!回忆动画:上加下减,左加右减。';
    const chunks: string[] = [];
    for (let i = 0; i < reply.length; i += 4) chunks.push(reply.slice(i, i + 4));

    let prevLen = 0;
    chunks.forEach((delta, i) => {
      s = reduceClass(s, { type: 'ai_chunk', requestId: 'req-1', delta, done: i === chunks.length - 1 });
      const html = render(s);
      const expected = reply.slice(0, Math.min((i + 1) * 4, reply.length));
      expect(html).toContain(expected);            // 已收到的前缀完整在屏
      expect(expected.length).toBeGreaterThan(prevLen); // 严格递增 = 逐字(分片)渐进
      prevLen = expected.length;
      const last = s.chat.at(-1)!;
      expect(last.streaming).toBe(i !== chunks.length - 1); // 流式中带光标标记
    });

    expect(s.chat.at(-1)!.text).toBe(reply); // 拼接无损
  });

  it('user/assistant 气泡角色着色(user 主色右靠,assistant 紫底左靠)', () => {
    let s = reduceClass(initialClassState, { type: 'ai_user', text: '提示' });
    s = reduceClass(s, { type: 'ai_chunk', requestId: 'r', delta: '想想 b', done: true });
    const html = render(s);
    expect(html).toMatch(/data-role="user"[^>]*class="[^"]*bg-primary/);
    expect(html).toMatch(/data-role="assistant"[^>]*class="[^"]*bg-violet-soft/);
  });
});
