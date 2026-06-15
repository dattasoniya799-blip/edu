/**
 * 轻量异步信号量(零第三方依赖)—— LlmGateway 的「全局并发闸」:
 * 限制同时在飞的 LLM 调用数(跨四能力的兜底,预批 worker 另有 BullMQ concurrency=5)。
 * - acquire():有空位即占用,否则排队等待 release/扩容唤醒;
 * - release():释放一个名额并唤醒队首等待者;
 * - setMax():运行态改并发上限(PUT /admin/ai/config)。调大立即放行可放行的等待者;
 *   调小不打断在飞调用,仅令后续 acquire 多等(active 自然回落到新上限以内)。
 */
export class Semaphore {
  private max: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max));
  }

  getMax(): number {
    return this.max;
  }

  /** 在飞计数(含已占名额的等待者),测试/可观测用 */
  inFlight(): number {
    return this.active;
  }

  setMax(max: number): void {
    this.max = Math.max(1, Math.floor(max));
    this.drain();
  }

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    // 被 drain 唤醒时名额已在 drain 内预占(active 已自增),无需重复自增
  }

  release(): void {
    if (this.active > 0) this.active--;
    this.drain();
  }

  /** 在不超过 max 的前提下,为队首等待者预占名额并唤醒 */
  private drain(): void {
    while (this.active < this.max && this.waiters.length > 0) {
      const next = this.waiters.shift()!;
      this.active++;
      next();
    }
  }
}
