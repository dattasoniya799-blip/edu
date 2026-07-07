/**
 * copyText 三态用例(vitest 环境为 node,navigator/document 全部手动 stub):
 * 1) clipboard 可用且成功 → true,不触发回退;
 * 2) clipboard reject(Safari 权限/手势拒绝)→ 回退 execCommand 成功 → true;
 * 3) clipboard 不存在(http://局域网IP 非安全上下文)→ 回退成功 → true;
 * 4) 两条路径都失败 → false(调用方据此提示手动复制,而非误报「已复制」)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '../copyText';

/** 构造最小可用的 document stub,记录 execCommand 与 textarea 行为 */
function stubDocument(execResult: boolean | (() => boolean)) {
  const removed: unknown[] = [];
  const ta: Record<string, unknown> = {
    value: '',
    style: {},
    parentNode: null as unknown,
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
  };
  const body = {
    appendChild: vi.fn((node: typeof ta) => { node.parentNode = body; }),
    removeChild: vi.fn((node: typeof ta) => { removed.push(node); node.parentNode = null; }),
  };
  const execCommand = vi.fn(() => (typeof execResult === 'function' ? execResult() : execResult));
  vi.stubGlobal('document', { body, createElement: vi.fn(() => ta), execCommand });
  return { ta, body, execCommand, removed };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copyText · clipboard 可用', () => {
  it('writeText 成功 → true,且不走 execCommand 回退', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { execCommand } = stubDocument(true);

    await expect(copyText('pw-123456')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('pw-123456');
    expect(execCommand).not.toHaveBeenCalled();
  });
});

describe('copyText · clipboard reject(Safari 手势/权限拒绝)', () => {
  it('回退 execCommand 成功 → true,不向外抛异常', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { ta, execCommand, removed } = stubDocument(true);

    await expect(copyText('pw-reject')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(ta.value).toBe('pw-reject');
    // 临时 textarea 用完即清理
    expect(removed).toContain(ta);
  });
});

describe('copyText · clipboard 不存在(非安全上下文,如 http://局域网IP)', () => {
  it('直接走回退且成功 → true,不会因读 undefined.writeText 抛错', async () => {
    vi.stubGlobal('navigator', {}); // navigator.clipboard === undefined
    const { execCommand } = stubDocument(true);

    await expect(copyText('pw-insecure')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('navigator 整体不存在(node 环境)也不抛错', async () => {
    vi.stubGlobal('navigator', undefined);
    const { execCommand } = stubDocument(true);

    await expect(copyText('pw-node')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledOnce();
  });
});

describe('copyText · 两条路径都失败', () => {
  it('clipboard reject + execCommand 返回 false → false', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const { removed, ta } = stubDocument(false);

    await expect(copyText('pw-fail')).resolves.toBe(false);
    expect(removed).toContain(ta); // 失败路径也要清理 textarea
  });

  it('clipboard 不存在 + execCommand 抛异常 → false,不向外抛', async () => {
    vi.stubGlobal('navigator', {});
    stubDocument(() => { throw new Error('execCommand not supported'); });

    await expect(copyText('pw-throw')).resolves.toBe(false);
  });

  it('连 document 都不存在 → false', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', undefined);

    await expect(copyText('pw-no-dom')).resolves.toBe(false);
  });
});
