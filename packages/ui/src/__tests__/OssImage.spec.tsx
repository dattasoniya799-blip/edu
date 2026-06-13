/**
 * OssImage(REV-front #1)三分支(SSR 可观测,不依赖 effect):
 * - 同步 resolveSrc 返回直链 → 立即出 <img>(SSR 友好)
 * - 同步返回 null → 占位框(⛶ + alt)
 * - 返回 Promise → loading 占位(脉冲框,data-figure-loading),先不出 <img>
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OssImage } from '../OssImage';

describe('OssImage · 渲染分支', () => {
  it('同步直链 → 出 <img>', () => {
    const html = renderToStaticMarkup(
      <OssImage ossKey="x" alt="图 1" resolveSrc={() => 'https://cdn/x.png'} />,
    );
    expect(html).toContain('<img');
    expect(html).toContain('https://cdn/x.png');
  });

  it('同步 null → 占位框(⛶ + alt,title=ossKey)', () => {
    const html = renderToStaticMarkup(
      <OssImage ossKey="k/none.png" alt="图 2" resolveSrc={() => null} />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('⛶');
    expect(html).toContain('图 2');
    expect(html).toContain('k/none.png');
  });

  it('异步(Promise) → 先 loading 占位,不出 <img>', () => {
    const html = renderToStaticMarkup(
      <OssImage ossKey="k/async.png" alt="图 3" resolveSrc={() => Promise.resolve('https://cdn/late.png')} />,
    );
    expect(html).toContain('data-figure-loading');
    expect(html).not.toContain('<img');
  });
});
