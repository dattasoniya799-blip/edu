/**
 * flow 调度器 —— shared/protocol.md「播放器时序」的唯一实现。
 *
 * 纯逻辑:所有副作用(浮现、播音、驱动动画、画红圈、滚视口、等待)经 PlayerHost 注入,
 * 因此可以在 jsdom 里用 mock host 完整单测(见 flow.test.ts)。
 */
import type { BoardScript, FlowItem, Step } from '../types';
import {
  TAKEAWAY_GROUPS,
  cardSpeechKey,
  lineSpeechKey,
  stepFlowKey,
  takeawayKey,
  takeawaySpeechText,
} from './audio-keys';
import { buildIndex, type ScriptIndex } from './script-index';
import { refTargets, takeawayTarget } from './targets';

/** 卡/行浮现动画时长(protocol.md:150 ms)。 */
export const REVEAL_MS = 150;
/** pause 默认停顿(schema.ts:默认 600)。 */
export const DEFAULT_PAUSE_MS = 600;

export interface SayRequest {
  text: string;
  key: string;
}

export interface SpeechHandle {
  done: Promise<void>;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export { takeawayTarget } from './targets';

export interface PlayerHost {
  /** instant=true 时不播浮现动画(跳步补齐)。 */
  reveal(target: string, opts: { instant: boolean }): void;
  say(req: SayRequest): SpeechHandle;
  /**
   * 「讲到哪、亮到哪」:一句 say 开口前把 ref 目标标成「正在讲」,念完(active=false)淡出。
   * targets 为空表示这句没有视觉锚点(整篇还没 reveal 过任何东西)。
   */
  speaking(targets: string[], active: boolean): void;
  /** emph:念完之后留下的痕迹(mark=保留黄底 / circle=画个红圈留着)。 */
  keep(targets: string[], emph: 'mark' | 'circle'): void;
  anim(target: string, action: Record<string, unknown>, opts: { instant: boolean }): Promise<void> | void;
  fx(item: Extract<FlowItem, { fx: unknown }>): void;
  focus(target: string): void;
  /** 受播放器控制的等待(暂停时不计时由 host 自己决定)。 */
  wait(ms: number): Promise<void>;
  onStepStart?(step: Step, index: number): void;
  onStepEnd?(step: Step, index: number): void;
  onFlowIndex?(stepIndex: number, flowIndex: number): void;
  onPhase?(phase: SchedulerPhase): void;
}

export type SchedulerPhase = 'idle' | 'playing' | 'paused' | 'takeaways' | 'explore';

export class FlowScheduler {
  private token = 0;
  /** 跳步意图的序号:连点时只有最后一下算数 */
  private seq = 0;
  private paused = false;
  private waiters: Array<() => void> = [];
  private speech: SpeechHandle | null = null;
  private readonly idx: ScriptIndex;

  phase: SchedulerPhase = 'idle';
  stepIndex = -1;
  flowIndex = -1;
  /** 最近一次 reveal 的目标:say 没写 ref 时拿它当视觉锚点 */
  private lastReveal: string | null = null;

  constructor(
    private readonly script: BoardScript,
    private readonly host: PlayerHost,
  ) {
    this.idx = buildIndex(script);
  }

  get stepCount(): number {
    return this.script.steps.length;
  }

  /* ------------------------------ 控制 ------------------------------ */

  /** 从第 from 步开始连播,直到全部 steps → 总结 → 动手。 */
  async run(from = 0): Promise<void> {
    const token = ++this.token;
    this.paused = false;
    this.setPhase('playing');
    for (let i = from; i < this.script.steps.length; i++) {
      if (token !== this.token) return;
      await this.runStep(i, token);
    }
    if (token !== this.token) return;
    await this.runTakeaways(token);
    if (token !== this.token) return;
    this.revealExploreColumn();
    this.setPhase('explore');
  }

  /**
   * 跳到第 i 步:瞬时补齐之前所有 reveal/anim,再从该步开头播。
   * stepIndex 在 await 之前就同步更新 —— 否则快速连点「下一步」时,后面几下读到的还是旧值,
   * 会反复跳回同一步(表现为旁白重复播)。
   */
  async goTo(stepIndex: number): Promise<void> {
    const i = Math.max(0, Math.min(this.script.steps.length - 1, stepIndex));
    const seq = ++this.seq;
    this.cancel();
    this.stepIndex = i;
    this.flowIndex = -1;
    await this.fastForward(i);
    if (seq !== this.seq) return; // 补齐期间又点了一下,这次作废
    await this.run(i);
  }

  /** 已经在最后一步(或总结/动手)了吗 —— 到了就不该再有「下一步」。 */
  get isAtEnd(): boolean {
    return this.phase === 'explore' || this.phase === 'takeaways' || this.stepIndex >= this.script.steps.length - 1;
  }

  /**
   * 下一步。**最后一步之后不重播**:直接落到终态(总结 + 动手),
   * 已经在终态就什么都不做。
   */
  next(): Promise<void> {
    if (this.phase === 'explore') return Promise.resolve();
    if (this.stepIndex >= this.script.steps.length - 1) return this.toEnd();
    return this.goTo(this.stepIndex + 1);
  }

  /** 上一步。从总结/动手往回退时回到最后一步,而不是倒数第二步。 */
  prev(): Promise<void> {
    if (this.phase === 'explore' || this.phase === 'takeaways') return this.goTo(this.script.steps.length - 1);
    return this.goTo(this.stepIndex - 1);
  }

  /**
   * 直接落到终态:补齐所有 reveal/anim,**全部 takeaways 瞬时浮现**(不等语音),
   * 再进动手。连点「下一步」或点「跳到结尾」都走这里。
   */
  async toEnd(): Promise<void> {
    const seq = ++this.seq;
    this.cancel();
    this.stepIndex = Math.max(0, this.script.steps.length - 1);
    this.flowIndex = -1;
    this.setPhase('explore'); // 同步落定,连点时后面几下才知道「已经到头了」
    await this.fastForward(this.script.steps.length);
    if (seq !== this.seq) return;
    this.revealExploreColumn();
    for (const group of TAKEAWAY_GROUPS) {
      const items = this.script.takeaways?.[group] ?? [];
      items.forEach((_, i) => this.host.reveal(takeawayTarget(group, i), { instant: true }));
    }
    // 取景落到总结列,别停在中间某一问上
    const endCol = this.script.columns.find((c) => c.phase === 'summary') ?? this.script.columns.at(-1);
    if (endCol) this.host.focus(endCol.id);
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.speech?.pause();
    this.setPhase('paused');
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.speech?.resume();
    this.setPhase(this.stepIndex >= this.script.steps.length - 1 && this.flowIndex < 0 ? 'takeaways' : 'playing');
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** 打断当前播放(跳步 / 销毁):临时的「正在讲」高亮清掉,emph 留下的痕迹不动。 */
  cancel(): void {
    this.token++;
    this.speech?.cancel();
    this.speech = null;
    this.paused = false;
    this.host.speaking([], false);
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  /**
   * 把第 upto 步之前的 reveal / anim 瞬时应用一遍(跳步补齐),
   * 顺带把这些步里 say 留下的 emph 痕迹(mark 黄底 / circle 红圈)也补上——
   * 每次都是从 0 重新算一遍,所以跳到第 n 步只会看到第 n 步之前的痕迹,跟正常顺序播放一致。
   */
  async fastForward(upto: number): Promise<void> {
    this.lastReveal = null;
    for (let k = 0; k < upto && k < this.script.steps.length; k++) {
      for (const item of this.script.steps[k].flow) {
        if ('say' in item) {
          if (item.emph) {
            const targets = refTargets(item) ?? (this.lastReveal ? [this.lastReveal] : []);
            if (targets.length) this.host.keep(targets, item.emph);
          }
          continue;
        }
        if ('do' in item && item.do === 'reveal') {
          this.host.reveal(item.target, { instant: true });
          this.lastReveal = item.target;
        } else if ('do' in item && item.do === 'anim') {
          this.revealAnimationCard(item.target, true);
          await this.host.anim(item.target, { ...item.action, durationMs: 0 }, { instant: true });
        }
      }
    }
  }

  /**
   * 动作指向的那张动画卡还没浮现就补一张(与 schema 里「reveal 行会先浮现它的卡」同精神)。
   * 动手列的卡不在这里放,那是讲完之后的事。
   */
  private revealAnimationCard(animationId: string, instant: boolean): void {
    for (const cardId of this.idx.animationCards.get(animationId) ?? []) {
      const card = this.idx.cards.get(cardId);
      const col = card ? this.idx.columns.get(card.col) : undefined;
      if (col?.phase === 'explore') continue;
      this.host.reveal(cardId, { instant });
    }
  }

  /** 进动手环节:把 explore 列里的卡(动画卡等)全部放出来。 */
  private revealExploreColumn(): void {
    const cols = new Set(this.script.columns.filter((c) => c.phase === 'explore').map((c) => c.id));
    if (!cols.size) return;
    for (const card of this.script.cards) if (cols.has(card.col)) this.host.reveal(card.id, { instant: true });
  }

  /* ------------------------------ 执行 ------------------------------ */

  private setPhase(p: SchedulerPhase): void {
    this.phase = p;
    this.host.onPhase?.(p);
  }

  private async gate(token: number): Promise<boolean> {
    if (token !== this.token) return false;
    if (!this.paused) return true;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    return token === this.token;
  }

  private async runStep(stepIndex: number, token: number): Promise<void> {
    const step = this.script.steps[stepIndex];
    if (!step) return;
    this.stepIndex = stepIndex;
    this.host.onStepStart?.(step, stepIndex);
    for (let i = 0; i < step.flow.length; i++) {
      if (!(await this.gate(token))) return;
      this.flowIndex = i;
      this.host.onFlowIndex?.(stepIndex, i);
      await this.runItem(step, i, token);
      if (token !== this.token) return;
    }
    this.flowIndex = -1;
    this.host.onStepEnd?.(step, stepIndex);
  }

  private async runItem(step: Step, i: number, token: number): Promise<void> {
    const item = step.flow[i];
    if ('say' in item) {
      const targets = refTargets(item) ?? undefined;
      await this.speak({ text: item.say, key: stepFlowKey(step.id, i) }, token, targets, item.emph);
      return;
    }
    if ('fx' in item) {
      this.host.fx(item); // fx 不挡后续 flow
      return;
    }
    switch (item.do) {
      case 'reveal': {
        this.host.reveal(item.target, { instant: false });
        this.lastReveal = item.target;
        await this.host.wait(REVEAL_MS);
        const auto = this.autoSpeech(step, i, item.target);
        if (auto) await this.speak(auto, token);
        return;
      }
      case 'anim':
        // 剧本可能只发动作、忘了 reveal 那张动画卡(圆题就是),补一下,不然动作发给了空气
        this.revealAnimationCard(item.target, false);
        await this.host.anim(item.target, item.action, { instant: false });
        return;
      case 'focus':
        this.host.focus(item.target);
        return;
      case 'pause':
        await this.host.wait(item.ms ?? DEFAULT_PAUSE_MS);
        return;
    }
  }

  /**
   * reveal 一条 formula 行(或 table 卡)且 flow 里没有紧随的 say 时,念它自己的 speech。
   * protocol.md 只写死了 formula 行这条;table 卡的 speech 有 key 却没写触发时机,
   * 这里采用同一口径(已记 shared/ISSUES.md)。
   */
  private autoSpeech(step: Step, i: number, target: string): SayRequest | null {
    const next = step.flow[i + 1];
    if (next && 'say' in next) return null;
    const line = this.idx.lines.get(target);
    if (line) {
      if (line.line.kind !== 'formula' || !line.line.speech) return null;
      return { text: line.line.speech, key: lineSpeechKey(line.card.id, line.line.id) };
    }
    const card = this.idx.cards.get(target);
    if (card && card.kind === 'table' && card.speech) {
      return { text: card.speech, key: cardSpeechKey(card.id) };
    }
    return null;
  }

  /**
   * 念一句:开口前给 targets(没传就取 lastReveal)加「正在讲」高亮,念完淡出;
   * emph:'mark' 念完才留痕(黄底本来就是「正在讲」的样子,留痕只是不淡出);
   * emph:'circle' 提前留痕——手绘圈跟着讲到就画上,不必等这句话说完(shared/ISSUES.md 记了这条口径)。
   */
  private async speak(req: SayRequest, token: number, targets?: string[], emph?: 'mark' | 'circle'): Promise<void> {
    const anchors = targets ?? (this.lastReveal ? [this.lastReveal] : []);
    this.host.speaking(anchors, true);
    if (emph === 'circle' && anchors.length) this.host.keep(anchors, 'circle');
    const handle = this.host.say(req);
    this.speech = handle;
    if (this.paused) handle.pause();
    await handle.done;
    if (this.speech === handle) this.speech = null;
    if (token !== this.token) return; // 被跳步打断:cancel() 已经清过临时高亮,这里不用再管
    this.host.speaking(anchors, false);
    if (emph === 'mark' && anchors.length) this.host.keep(anchors, 'mark');
  }

  /* ---------------------------- 总结环节 ---------------------------- */

  /** 全部 steps 结束 → takeaways 逐条浮现并念。 */
  async runTakeaways(token: number): Promise<void> {
    const groups = TAKEAWAY_GROUPS.filter((g) => (this.script.takeaways?.[g] ?? []).length > 0);
    if (!groups.length) return;
    this.setPhase('takeaways');
    for (const group of groups) {
      const items = this.script.takeaways[group] ?? [];
      for (let i = 0; i < items.length; i++) {
        if (!(await this.gate(token))) return;
        const target = takeawayTarget(group, i);
        this.host.reveal(target, { instant: false });
        this.host.focus(target);
        await this.host.wait(REVEAL_MS);
        if (token !== this.token) return;
        await this.speak({ text: takeawaySpeechText(group, items[i], i), key: takeawayKey(group, i) }, token, [target]);
        if (token !== this.token) return;
      }
    }
  }

  /**
   * 给截图脚本/调试用:瞬时推进到第 stepIndex 步的第 flowIndex 项(含)之后,不播音。
   * flowIndex 那一项如果正好是 say,当成「此刻正在念这句」处理(讲到哪、亮到哪的高亮生效,
   * 但 emph 还不留痕——念完才留痕);flowIndex 越界(≥ flow.length)等于「这一步已经放完」,
   * 里面每句 say 的 emph 痕迹都按已念完补上,没有任何「正在讲」的临时高亮。
   */
  async seek(stepIndex: number, flowIndex: number): Promise<void> {
    this.cancel();
    await this.fastForward(stepIndex);
    const step = this.script.steps[stepIndex];
    if (!step) return;
    this.stepIndex = stepIndex;
    this.flowIndex = Math.min(flowIndex, step.flow.length - 1);
    this.host.onStepStart?.(step, stepIndex);
    for (let i = 0; i <= flowIndex && i < step.flow.length; i++) {
      const item = step.flow[i];
      const isCurrent = i === flowIndex;
      if ('say' in item) {
        const targets = refTargets(item) ?? (this.lastReveal ? [this.lastReveal] : []);
        if (isCurrent) {
          this.host.speaking(targets, true);
          if (item.emph === 'circle' && targets.length) this.host.keep(targets, 'circle');
        } else if (item.emph && targets.length) {
          this.host.keep(targets, item.emph);
        }
        continue;
      }
      if ('do' in item && item.do === 'reveal') {
        this.host.reveal(item.target, { instant: true });
        this.lastReveal = item.target;
      } else if ('do' in item && item.do === 'anim') {
        this.revealAnimationCard(item.target, true);
        await this.host.anim(item.target, item.action, { instant: true });
      } else if ('do' in item && item.do === 'focus') this.host.focus(item.target);
      else if ('fx' in item) this.host.fx(item);
    }
    this.setPhase('paused');
    this.paused = true;
  }
}
