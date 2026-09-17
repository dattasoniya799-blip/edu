import { describe, expect, it } from 'vitest';
import { sanitizePurpose } from './purpose';

/**
 * README「已知待改」2:动画卡上展示了 purpose 里的动作名列表。
 * server 侧校验器已经切了这段(见 server/src/validate.ts 的 sanitizePurpose),
 * 这里是同一个口径的 web 兜底,专门覆盖已经落盘的老剧本(state.json 里 purpose 已经写死了)。
 */
describe('sanitizePurpose · 只给学生看一句话', () => {
  it('「动作名:…」之后的实现细节被切掉(真题实测句式)', () => {
    const raw = '演示三角形AEF绕点A逆时针旋转，展示对应边始终相等。动作名：rotate(旋转动画), showPerp(显示垂直状态)';
    expect(sanitizePurpose(raw)).toBe('演示三角形AEF绕点A逆时针旋转，展示对应边始终相等');
  });

  it('「动作包括:…」同样被切掉', () => {
    const raw = '演示等腰直角三角形绕正方形顶点 A 逆时针旋转的过程。动作包括:startRotate(开始连续旋转), stopAtPerp(停止在垂直位置)。';
    expect(sanitizePurpose(raw)).toBe('演示等腰直角三角形绕正方形顶点 A 逆时针旋转的过程');
  });

  it('滑轮组真题实测句式(半角冒号)', () => {
    const raw = '演示滑轮组结构，展示物体上升高度 h 与绳端移动距离 s 的关系。动作名: showStructure(显示滑轮组), liftObject(提升物体)。';
    expect(sanitizePurpose(raw)).toBe('演示滑轮组结构，展示物体上升高度 h 与绳端移动距离 s 的关系');
  });

  it('正常的一句话不受影响', () => {
    const raw = '演示模型入水沉底、排水后竖直上浮,并显示力箭头。';
    expect(sanitizePurpose(raw)).toBe(raw);
  });

  it('空值不炸', () => {
    expect(sanitizePurpose(undefined)).toBe('');
    expect(sanitizePurpose(null)).toBe('');
    expect(sanitizePurpose('')).toBe('');
  });
});
