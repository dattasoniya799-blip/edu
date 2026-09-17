/**
 * 可暂停的等待。播放器一按暂停,正在跑的 reveal/pause 停顿也要冻住,
 * 否则「暂停」只停住了语音,板书还在自己往下走。
 */
export class Waiter {
  private paused = false;
  private jobs = new Set<{ resolve: () => void; timer: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number }>();

  wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const job = { resolve, timer: null as ReturnType<typeof setTimeout> | null, remaining: ms, startedAt: Date.now() };
      const fire = () => {
        this.jobs.delete(job);
        resolve();
      };
      if (this.paused) {
        this.jobs.add(job);
        return;
      }
      job.timer = setTimeout(fire, ms);
      this.jobs.add(job);
    });
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const job of this.jobs) {
      if (!job.timer) continue;
      clearTimeout(job.timer);
      job.timer = null;
      job.remaining = Math.max(0, job.remaining - (Date.now() - job.startedAt));
    }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const job of this.jobs) {
      if (job.timer) continue;
      job.startedAt = Date.now();
      job.timer = setTimeout(() => {
        this.jobs.delete(job);
        job.resolve();
      }, job.remaining);
    }
  }

  /** 打断:所有等待立即结束(跳步时用)。 */
  flush(): void {
    const jobs = [...this.jobs];
    this.jobs.clear();
    for (const job of jobs) {
      if (job.timer) clearTimeout(job.timer);
      job.resolve();
    }
  }
}
