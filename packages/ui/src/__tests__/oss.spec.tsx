/**
 * resolveOssUrl 单点解析(FIX4-front #2):
 * - 已是可加载 URL(http/data/blob)→ 原样返回
 * - 非 URL 的 ossKey:vitest 环境 VITE_USE_MOCK 未置 'false' → mock 占位 data URL(可见)
 */
import { describe, expect, it } from 'vitest';
import { resolveOssUrl } from '../oss';

describe('resolveOssUrl', () => {
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
