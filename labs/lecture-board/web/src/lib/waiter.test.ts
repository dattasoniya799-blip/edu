import { describe, expect, it } from 'vitest';
import { Waiter } from './waiter';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('可暂停的等待', () => {
  it('暂停期间不计时,resume 后补完剩下的', async () => {
    const w = new Waiter();
    let done = false;
    void w.wait(60).then(() => {
      done = true;
    });
    w.pause();
    await tick(120);
    expect(done).toBe(false); // 暂停时板书不许自己往下走
    w.resume();
    await tick(90);
    expect(done).toBe(true);
  });

  it('flush 让所有等待立刻结束(跳步用)', async () => {
    const w = new Waiter();
    let done = false;
    void w.wait(5000).then(() => {
      done = true;
    });
    w.flush();
    await tick(5);
    expect(done).toBe(true);
  });

  it('ms <= 0 直接过', async () => {
    const w = new Waiter();
    await w.wait(0);
    expect(true).toBe(true);
  });
});
