// @vitest-environment jsdom
/**
 * 实验室门禁两态(E1):有 flag / 无 flag 各渲染成什么样。
 *   有 → 导航出「实验室」分区、分区页出内测卡片、被守卫的页面正常放行;
 *   无 → 导航不出该分区、分区页是空态、直接敲 /courseware/new 落到「内测功能,请联系管理员开通」;
 *   目录还没到(features=null)→ 只显示加载中,不能误判成无权限。
 * 另测:页内请求收到 403+4701 时,守卫把整页翻到同一张提示页。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ERROR_CODES } from '@qiming/contracts';
import type { MyFeatureDto } from '@qiming/contracts';

const featuresState = vi.hoisted(() => ({ current: null as MyFeatureDto[] | null }));
vi.mock('../FeaturesProvider', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../FeaturesProvider')>();
  const { labEntries, hasFeature } = await import('../lib/features');
  return {
    ...orig,
    useFeatures: () => ({
      features: featuresState.current,
      labEntries: labEntries(featuresState.current ?? []),
      has: (key: string) => hasFeature(featuresState.current ?? [], key),
    }),
  };
});

import { FeatureGuard, useFeatureDeny } from '../FeatureGuard';
import { FEATURE_AI_COURSEWARE, isFeatureNotEnabled, labEntries } from '../lib/features';
import { LabPage } from '../../pages/lab/LabPage';
import { navItems } from '../../pages/Shell';

const AI_COURSEWARE: MyFeatureDto = {
  key: FEATURE_AI_COURSEWARE,
  name: 'AI 生成课件',
  stage: 'beta',
  description: '文字稿一键生成逐页课件:大纲确认 → 逐页生图 → 成品落资源库,可挂到讲次环节。',
};

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  featuresState.current = null;
});

function mount(node: React.ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(<MemoryRouter>{node}</MemoryRouter>); });
  return host;
}

const staticHtml = (node: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

const Guarded = () => (
  <FeatureGuard featureKey={FEATURE_AI_COURSEWARE} name="AI 生成课件">
    <div>向导第 1 步</div>
  </FeatureGuard>
);

describe('导航分区', () => {
  it('有教师向条目 → 追加「实验室」;没有 → 导航结构不变', () => {
    const withLab = navItems(labEntries([AI_COURSEWARE]).length > 0);
    expect(withLab.at(-1)).toMatchObject({ to: '/lab', label: '实验室' });
    expect(navItems(labEntries([]).length > 0).some((n) => n.to === '/lab')).toBe(false);
  });
});

describe('实验室分区页', () => {
  it('有 flag → 卡片含「内测」徽标、说明与「进入」按钮', () => {
    featuresState.current = [AI_COURSEWARE];
    const html = staticHtml(<LabPage />);
    expect(html).toContain('AI 生成课件');
    expect(html).toContain('内测');
    expect(html).toContain('逐页生图');
    expect(html).toContain('进入');
  });

  it('无 flag → 空态,不出现任何功能卡片', () => {
    featuresState.current = [];
    const html = staticHtml(<LabPage />);
    expect(html).toContain('暂时没有对你开放的内测功能');
    expect(html).not.toContain('AI 生成课件');
  });
});

describe('courseware 路由守卫', () => {
  it('有 flag → 放行到向导本体', () => {
    featuresState.current = [AI_COURSEWARE];
    expect(mount(<Guarded />).textContent).toContain('向导第 1 步');
  });

  it('无 flag → 拦到提示页(文案含「内测功能,请联系管理员开通」)', () => {
    featuresState.current = [];
    const text = mount(<Guarded />).textContent ?? '';
    expect(text).toContain('内测功能,请联系管理员开通');
    expect(text).not.toContain('向导第 1 步');
  });

  it('目录未到达 → 加载中(不能当作无权限)', () => {
    featuresState.current = null;
    const text = mount(<Guarded />).textContent ?? '';
    expect(text).toContain('加载中');
    expect(text).not.toContain('请联系管理员开通');
  });

  it('页内请求收到 403+4701 → 整页翻到同一张提示页', () => {
    featuresState.current = [AI_COURSEWARE];
    function Inner() {
      const deny = useFeatureDeny();
      return (
        <button type="button" onClick={() => deny(new ApiError(ERROR_CODES.FEATURE_NOT_ENABLED, '该功能未对当前账号开放', { key: FEATURE_AI_COURSEWARE }, 403))}>
          触发 4701
        </button>
      );
    }
    const host = mount(
      <FeatureGuard featureKey={FEATURE_AI_COURSEWARE} name="AI 生成课件"><Inner /></FeatureGuard>,
    );
    act(() => { host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(host.textContent).toContain('内测功能,请联系管理员开通');
  });
});

describe('4701 识别', () => {
  it('只认业务码 4701,其它错误照旧走各自的提示', () => {
    expect(isFeatureNotEnabled(new ApiError(ERROR_CODES.FEATURE_NOT_ENABLED, 'x', undefined, 403))).toBe(true);
    expect(isFeatureNotEnabled(new ApiError(ERROR_CODES.NOT_FOUND, 'x', undefined, 404))).toBe(false);
    expect(isFeatureNotEnabled(new Error('网络波动'))).toBe(false);
  });
});
