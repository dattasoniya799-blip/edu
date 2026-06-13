/**
 * ossKey 解析(REV-front #1):
 * - resolveOssUrl(同步):已是 URL → 原样;mock → 占位 data URL;真实非直链 → null(交异步)
 * - resolveOssUrlAsync(异步两跳):mock/直链立即出;真实 → 经 fetchViewUrl 换签名直链 + 按 ossKey 缓存;失败 → null
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOssUrl, resolveOssUrlAsync } from '../oss';

describe('resolveOssUrl(同步)', () => {
  it('已是 http(s) URL → 原样返回', () => {
    expect(resolveOssUrl('https://oss.example.com/a.png')).toBe('https://oss.example.com/a.png');
  });
  it('已是 data/blob URL → 原样返回', () => {
    expect(resolveOssUrl('data:image/png;base64,xxx')).toBe('data:image/png;base64,xxx');
    expect(resolveOssUrl('blob:http://x/y')).toBe('blob:http://x/y');
  });
  it('空 ossKey → null', () => {
    expect(resolveOssUrl('')).toBeNull();
  });
  it('mock 模式下普通 ossKey → 可加载的占位 data URL', () => {
    const url = resolveOssUrl('k/figs/stem-1.png');
    expect(url).toMatch(/^data:image\/svg\+xml,/);
  });
});

describe('resolveOssUrlAsync(异步)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('直链 → 立即原样 resolve,不调用 fetcher', async () => {
    const fetcher = vi.fn();
    await expect(resolveOssUrlAsync('https://cdn/a.png', fetcher)).resolves.toBe('https://cdn/a.png');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('mock 模式 → 占位 data URL,不调用 fetcher', async () => {
    const fetcher = vi.fn();
    const url = await resolveOssUrlAsync('k/figs/m.png', fetcher);
    expect(url).toMatch(/^data:image\/svg\+xml,/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('真实模式 → 经 fetcher 换签名直链,且按 ossKey 缓存(只回签一次)', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'false');
    const fetcher = vi.fn().mockResolvedValue('https://signed/real-1.png?sig=abc');
    const key = 'k/real-1.png';
    const a = await resolveOssUrlAsync(key, fetcher);
    const b = await resolveOssUrlAsync(key, fetcher);
    expect(a).toBe('https://signed/real-1.png?sig=abc');
    expect(b).toBe('https://signed/real-1.png?sig=abc');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('真实模式 fetcher 失败 → resolve(null),不抛;失败后可重试(不长期缓存)', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'false');
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('https://signed/real-2.png');
    const key = 'k/real-2.png';
    await expect(resolveOssUrlAsync(key, fetcher)).resolves.toBeNull();
    await expect(resolveOssUrlAsync(key, fetcher)).resolves.toBe('https://signed/real-2.png');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
