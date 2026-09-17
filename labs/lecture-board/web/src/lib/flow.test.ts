import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowScheduler, takeawayTarget, type PlayerHost, type SayRequest, type SpeechHandle } from './flow';
import type { BoardScript } from '../types';

/* ------------------------------ 夹具 ------------------------------ */

function makeScript(): BoardScript {
  return {
    version: 2,
    title: 'T',
    subject: 'physics',
    summary: 's',
    problem: { text: 'p', images: [], answer: 'a' },
    analysis: { given: [], hidden: [], find: [], ideas: [], marks: [] },
    columns: [
      { id: 'c1', title: '第(1)问', phase: 'solve', subq: 1 },
      { id: 'c2', title: '第(2)问', phase: 'solve', subq: 2 },
    ],
    cards: [
      {
        id: 'kb',
        col: 'c1',
        kind: 'board',
        lines: [
          { id: 'la', kind: 'text', text: 'x' },
          { id: 'lb', kind: 'formula', tex: 'p=F/S', speech: '压强等于压力除以面积' },
          { id: 'lc', kind: 'formula', tex: 'W=Fh', speech: '功等于力乘距离' },
        ],
      },
      { id: 'kt', col: 'c1', kind: 'table', markdown: '| a |\n|---|\n| b |', speech: '这张表说的是判据' },
      { id: 'ka', col: 'c2', kind: 'animation', animationId: 'anim1' },
    ],
    figures: [],
    animations: [{ id: 'anim1', kind: 'template', purpose: 'p', template: 'buoyancy', status: 'ready' }],
    steps: [
      {
        id: 's1',
        title: '第一步',
        col: 'c1',
        flow: [
          { do: 'focus', target: 'c1' },
          { say: '先看第一问。' },
          { do: 'reveal', target: 'la' },
          { do: 'reveal', target: 'lb' },
          { say: '再套公式。' },
          { do: 'reveal', target: 'lc' },
          { fx: 'circle', target: 'lc' },
        ],
      },
      {
        id: 's2',
        title: '第二步',
        col: 'c2',
        flow: [
          { do: 'reveal', target: 'ka' },
          { do: 'anim', target: 'anim1', action: { type: 'run', phase: 'rise' } },
          { do: 'pause', ms: 300 },
          { say: '讲完了。' },
        ],
      },
    ],
    takeaways: { knowledge: ['【A】要点'], pitfalls: ['【B】易错'], methods: [], variants: [] },
  };
}

interface Trace {
  events: string[];
  host: PlayerHost;
  says: SayRequest[];
  /** 当前挂着的 say,测试可以手动放行 */
  pending: Array<{ req: SayRequest; resolve: () => void }>;
}

function makeHost(opts: { blockSay?: boolean } = {}): Trace {
  const events: string[] = [];
  const says: SayRequest[] = [];
  const pending: Trace['pending'] = [];
  const host: PlayerHost = {
    reveal(target, o) {
      events.push(`reveal:${target}${o.instant ? ':instant' : ''}`);
    },
    say(req): SpeechHandle {
      says.push(req);
      events.push(`say:${req.key}`);
      let resolve!: () => void;
      const done = new Promise<void>((r) => {
        resolve = r;
      });
      if (opts.blockSay) pending.push({ req, resolve });
      else resolve();
      return { done, cancel: resolve, pause() {}, resume() {} };
    },
    speaking(targets, active) {
      events.push(`speaking:${active ? 'on' : 'off'}:${targets.join(',')}`);
    },
    keep(targets, emph) {
      events.push(`keep:${emph}:${targets.join(',')}`);
    },
    anim(target, action, o) {
      events.push(`anim:${target}:${String(action.type)}${o.instant ? ':instant' : ''}`);
    },
    fx(item) {
      events.push(`fx:${item.fx}:${item.target}`);
    },
    focus(target) {
      events.push(`focus:${target}`);
    },
    async wait(ms) {
      events.push(`wait:${ms}`);
    },
    onStepStart(step) {
      events.push(`step:${step.id}`);
    },
    onPhase(p) {
      events.push(`phase:${p}`);
    },
  };
  return { events, host, says, pending };
}

/* ------------------------------ 用例 ------------------------------ */

describe('flow 调度器 · 顺序执行', () => {
  let script: BoardScript;
  beforeEach(() => {
    script = makeScript();
  });

  it('按 flow 数组顺序跑 focus / say / reveal / fx,reveal 后等 150 ms 浮现', async () => {
    const t = makeHost();
    const sch = new FlowScheduler(script, t.host);
    await sch.run(0);
    const s1 = t.events.slice(t.events.indexOf('step:s1'), t.events.indexOf('step:s2'));
    expect(s1).toEqual([
      'step:s1',
      'focus:c1',
      'speaking:on:', // 没 ref、还没 reveal 过任何东西 → 没有视觉锚点
      'say:steps.s1.flow.1',
      'speaking:off:',
      'reveal:la',
      'wait:150',
      'reveal:lb',
      'wait:150',
      'speaking:on:lb', // 没 ref → 自动锚定到最近一次 reveal(lb)
      'say:steps.s1.flow.4',
      'speaking:off:lb',
      'reveal:lc',
      'wait:150',
      'speaking:on:lc', // autoSpeech 念 lc 自己的 speech,也锚定到 lc
      'say:cards.kb.lines.lc',
      'speaking:off:lc',
      'fx:circle:lc',
    ]);
  });

  it('say 的音频 key 用 flow 下标(不是第几句)', async () => {
    const t = makeHost();
    await new FlowScheduler(script, t.host).run(0);
    expect(t.says.map((s) => s.key)).toContain('steps.s1.flow.1');
    expect(t.says.map((s) => s.key)).toContain('steps.s1.flow.4');
  });

  it('reveal 一条 formula 行、后面没有紧跟 say → 念该行的 speech', async () => {
    const t = makeHost();
    await new FlowScheduler(script, t.host).run(0);
    const auto = t.says.find((s) => s.key === 'cards.kb.lines.lc');
    expect(auto?.text).toBe('功等于力乘距离');
  });

  it('reveal 后面紧跟 say → 不念行的 speech(交给旁白)', async () => {
    const t = makeHost();
    await new FlowScheduler(script, t.host).run(0);
    expect(t.says.some((s) => s.key === 'cards.kb.lines.lb')).toBe(false);
  });

  it('table 卡 reveal 且无紧随 say → 念卡的 speech', async () => {
    script.steps = [{ id: 's9', title: 't', col: 'c1', flow: [{ do: 'reveal', target: 'kt' }] }];
    const t = makeHost();
    await new FlowScheduler(script, t.host).run(0);
    expect(t.says[0]).toEqual({ key: 'cards.kt.speech', text: '这张表说的是判据' });
  });

  it('pause 用给定 ms,缺省 600', async () => {
    script.steps = [
      { id: 's9', title: 't', col: 'c1', flow: [{ do: 'pause', ms: 300 }, { do: 'pause' }] },
    ];
    const t = makeHost();
    await new FlowScheduler(script, t.host).run(0);
    expect(t.events).toContain('wait:300');
    expect(t.events).toContain('wait:600');
  });

  it('fx 不挡后续 flow(同步派发,不等)', async () => {
    const t = makeHost();
    await new FlowScheduler(script, t.host).run(0);
    expect(t.events.indexOf('fx:circle:lc')).toBeLessThan(t.events.indexOf('step:s2'));
  });

  it('全部 steps 跑完 → takeaways 逐条浮现并念 → explore', async () => {
    const t = makeHost();
    const sch = new FlowScheduler(script, t.host);
    await sch.run(0);
    expect(t.events).toContain(`reveal:${takeawayTarget('knowledge', 0)}`);
    expect(t.says.map((s) => s.key)).toContain('takeaways.knowledge.0');
    expect(t.says.find((s) => s.key === 'takeaways.knowledge.0')?.text).toBe('核心知识点。A要点');
    expect(t.events.at(-1)).toBe('phase:explore');
  });
});

describe('flow 调度器 · 跳步补齐', () => {
  it('goTo 把之前每一步的 reveal 瞬时补完,anim 以 durationMs 0 重放', async () => {
    const t = makeHost();
    const sch = new FlowScheduler(makeScript(), t.host);
    await sch.goTo(1);
    const instant = t.events.filter((e) => e.endsWith(':instant'));
    expect(instant).toEqual(['reveal:la:instant', 'reveal:lb:instant', 'reveal:lc:instant']);
    // 补齐发生在第二步开播之前
    expect(t.events.indexOf('reveal:lc:instant')).toBeLessThan(t.events.indexOf('step:s2'));
  });

  it('fastForward 只补 reveal 与 anim,不念旁白、不画 fx', async () => {
    const t = makeHost();
    const sch = new FlowScheduler(makeScript(), t.host);
    await sch.fastForward(2);
    expect(t.says).toHaveLength(0);
    expect(t.events.some((e) => e.startsWith('fx:'))).toBe(false);
    expect(t.events).toContain('anim:anim1:run:instant');
  });

  it('跳步会打断正在播的那一句(旧 token 不再往下跑)', async () => {
    const t = makeHost({ blockSay: true });
    const sch = new FlowScheduler(makeScript(), t.host);
    void sch.run(0);
    await vi.waitFor(() => expect(t.events).toContain('say:steps.s1.flow.1'));
    const before = t.events.length;
    sch.cancel();
    t.pending.forEach((p) => p.resolve());
    await new Promise((r) => setTimeout(r, 20));
    // 取消后不应该再出现新的 reveal
    expect(t.events.slice(before).some((e) => e.startsWith('reveal:'))).toBe(false);
  });
});

describe('flow 调度器 · 末步之后不重播', () => {
  it('最后一步再点「下一步」→ 落到终态,不重跑最后一步的 flow', async () => {
    const t = makeHost();
    const sch = new FlowScheduler(makeScript(), t.host);
    await sch.goTo(1); // 最后一步(s2),跑完后 run 会自己进总结/动手
    const saysAfterS2 = t.says.filter((s) => s.key.startsWith('steps.s2.')).length;
    const before = t.events.length;

    await sch.next();
    await sch.next();
    await sch.next();

    // 最后一步的旁白一次都没有被重播
    expect(t.says.filter((s) => s.key.startsWith('steps.s2.')).length).toBe(saysAfterS2);
    // 也没有重新触发这一步的动画动作(非 instant 的那种)
    expect(t.events.slice(before).filter((e) => e === 'anim:anim1:run')).toHaveLength(0);
    expect(sch.phase).toBe('explore');
  });

  it('连点「下一步」到结尾:takeaways 全部瞬时浮现,不等语音', async () => {
    const t = makeHost({ blockSay: true }); // 语音永远不结束,逐条念的路走不通
    const sch = new FlowScheduler(makeScript(), t.host);
    await sch.toEnd();
    expect(t.events).toContain(`reveal:${takeawayTarget('knowledge', 0)}:instant`);
    expect(t.events).toContain(`reveal:${takeawayTarget('pitfalls', 0)}:instant`);
    expect(t.says).toHaveLength(0); // 不等语音,也不念
    expect(sch.phase).toBe('explore');
  });

  it('终态时 isAtEnd 为真,next 是空操作', async () => {
    const t = makeHost();
    const sch = new FlowScheduler(makeScript(), t.host);
    await sch.toEnd();
    expect(sch.isAtEnd).toBe(true);
    const before = [...t.events];
    await sch.next();
    expect(t.events).toEqual(before);
  });

  it('从终态点「上一步」回到最后一步,而不是倒数第二步', async () => {
    const t = makeHost();
    const sch = new FlowScheduler(makeScript(), t.host);
    await sch.toEnd();
    t.events.length = 0;
    await sch.prev();
    expect(t.events).toContain('step:s2');
    expect(t.events).not.toContain('step:s1');
  });
});

describe('flow 调度器 · 暂停', () => {
  it('暂停后不再推进,resume 后接着跑', async () => {
    const t = makeHost({ blockSay: true });
    const sch = new FlowScheduler(makeScript(), t.host);
    void sch.run(0);
    await vi.waitFor(() => expect(t.events).toContain('say:steps.s1.flow.1'));
    sch.pause();
    expect(sch.isPaused).toBe(true);
    t.pending.forEach((p) => p.resolve()); // 这句播完了,但已暂停
    await new Promise((r) => setTimeout(r, 20));
    const frozen = [...t.events];
    await new Promise((r) => setTimeout(r, 30));
    expect(t.events).toEqual(frozen); // 暂停期间一动不动

    sch.resume();
    await vi.waitFor(() => expect(t.events).toContain('reveal:la'));
    expect(sch.isPaused).toBe(false);
  });

  it('phase 依次是 playing → paused → playing', async () => {
    const t = makeHost({ blockSay: true });
    const sch = new FlowScheduler(makeScript(), t.host);
    void sch.run(0);
    await vi.waitFor(() => expect(t.events).toContain('phase:playing'));
    sch.pause();
    expect(t.events.filter((e) => e.startsWith('phase:')).at(-1)).toBe('phase:paused');
    sch.resume();
    expect(t.events.filter((e) => e.startsWith('phase:')).at(-1)).toBe('phase:playing');
    sch.cancel();
  });
});

describe('flow 调度器 · 讲到哪、亮到哪(protocol.md 播放器时序 §2)', () => {
  /** 每步一句话,方便用 goTo 精确停在某一句,不被前面还没说完的话卡住。 */
  function scriptForHighlight(): BoardScript {
    const s = makeScript();
    s.steps = [
      { id: 'r0', title: 'r0', col: 'c1', flow: [{ do: 'reveal', target: 'la' }] },
      { id: 'r1', title: 'r1', col: 'c1', flow: [{ say: '没写 ref,自动锚定到最近一次 reveal。' }] },
      { id: 'r2', title: 'r2', col: 'c1', flow: [{ say: '显式 ref,念完才留黄底。', ref: 'lb', emph: 'mark' }] },
      { id: 'r3', title: 'r3', col: 'c1', flow: [{ say: '显式 ref,讲到就画圈。', ref: 'lc', emph: 'circle' }] },
    ];
    return s;
  }

  it('没写 ref 的 say 自动锚定到本句之前最近一次 reveal 的目标', async () => {
    const t = makeHost();
    await new FlowScheduler(scriptForHighlight(), t.host).goTo(1);
    expect(t.events).toContain('speaking:on:la');
  });

  it('从未 reveal 过任何东西时,没 ref 的 say 高亮目标是空集(不瞎猜)', async () => {
    const s = scriptForHighlight();
    s.steps = s.steps.slice(1); // 去掉开头那个 reveal
    const t = makeHost();
    await new FlowScheduler(s, t.host).run(0);
    expect(t.events).toContain('speaking:on:');
  });

  it('念完之后「正在讲」淡出(speaking off)', async () => {
    const t = makeHost();
    await new FlowScheduler(scriptForHighlight(), t.host).goTo(1);
    expect(t.events).toContain('speaking:off:la');
  });

  it('emph:"mark" 要等这句念完才 keep,没念完之前不留痕', async () => {
    const t = makeHost({ blockSay: true });
    const sch = new FlowScheduler(scriptForHighlight(), t.host);
    void sch.goTo(2);
    await vi.waitFor(() => expect(t.events).toContain('say:steps.r2.flow.0'));
    expect(t.events.some((e) => e.startsWith('keep:'))).toBe(false); // 还没念完
    t.pending.find((p) => p.req.key === 'steps.r2.flow.0')?.resolve();
    await vi.waitFor(() => expect(t.events).toContain('keep:mark:lb'));
  });

  it('emph:"circle" 讲到就画圈,不必等这句说完', async () => {
    const t = makeHost({ blockSay: true });
    const sch = new FlowScheduler(scriptForHighlight(), t.host);
    void sch.goTo(3);
    await vi.waitFor(() => expect(t.events).toContain('say:steps.r3.flow.0'));
    expect(t.events).toContain('keep:circle:lc'); // 这句话还挂着(pending)没结束,圈已经画上了
    t.pending.forEach((p) => p.resolve());
  });

  it('跳步打断一句还没念完的话:清掉临时高亮,这句的 emph 痕迹不会补上', async () => {
    const t = makeHost({ blockSay: true });
    const sch = new FlowScheduler(scriptForHighlight(), t.host);
    void sch.goTo(2); // ref:lb emph:mark,故意不放行
    await vi.waitFor(() => expect(t.events).toContain('speaking:on:lb'));
    const before = t.events.length;
    sch.cancel();
    const after = t.events.slice(before);
    expect(after).toContain('speaking:off:');
    expect(after.some((e) => e.startsWith('keep:'))).toBe(false); // 没念完,不留痕
  });

  it('跳步补齐(fastForward)时,之前已经念完的 emph 痕迹要一起摊平补上', async () => {
    const t = makeHost();
    const sch = new FlowScheduler(scriptForHighlight(), t.host);
    await sch.fastForward(3); // 走完 r0~r2(不含 r3)
    expect(t.events).toContain('keep:mark:lb');
    expect(t.events.some((e) => e.startsWith('say:'))).toBe(false); // 补齐不播音
  });
});

describe('flow 调度器 · seek(截图/调试)', () => {
  it('seek 到某步某项:之前的 reveal/anim 全部瞬时补齐,fx 也画上,不播音', async () => {
    const t = makeHost();
    const sch = new FlowScheduler(makeScript(), t.host);
    await sch.seek(0, 6);
    expect(t.says).toHaveLength(0);
    expect(t.events).toContain('reveal:lc:instant');
    expect(t.events).toContain('fx:circle:lc');
    expect(sch.isPaused).toBe(true);
  });
});
