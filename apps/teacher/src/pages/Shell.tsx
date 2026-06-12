/**
 * 后台布局(原型 .portal:浅色侧边栏 + 58px topbar + 内容区)
 * 激活项 = primarySoft 底 + primary 字(风格基线)
 */
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** 分组标题(出现在该项上方) */
  group?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '工作台', icon: '◧', group: '教 学' },
  { to: '/courses', label: '我的课程', icon: '▦' },
  { to: '/bank', label: '题库维护', icon: '▤' },
  { to: '/resources', label: '资源库', icon: '▣' },
  { to: '/analytics', label: '学情分析', icon: '◔', group: '学 生' },
];

const ROLE_TITLE = '教师工作台';
const CRUMB_PREFIX = '教师端';

export function Shell() {
  const { me, ready, logout } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="flex min-h-screen items-center justify-center text-ink-3">加载中…</div>;
  if (!me) return <Navigate to="/login" replace />;
  const current = NAV_ITEMS.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)))?.label
    // B4 子页面(讲次编排/组卷/监控/批改)归属「我的课程」面包屑
    ?? (/^\/(lessons|grading)/.test(location.pathname) ? '我的课程' : '');

  return (
    <div className="flex min-h-screen bg-bg font-sans text-ink">
      <aside className="flex w-[228px] shrink-0 flex-col border-r border-line bg-card">
        <div className="px-5 pb-3 pt-[22px]">
          <div className="flex items-center gap-2 text-[15px] font-extrabold">
            <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-gradient-to-br from-primary to-primary-deep text-xs font-extrabold text-card">启</span>
            {me.orgName}
          </div>
          <div className="mt-1 pl-8 text-[11.5px] text-ink-3">{ROLE_TITLE}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
          {NAV_ITEMS.map((item) => (
            <div key={item.to}>
              {item.group && <div className="px-2.5 pb-1.5 pt-3.5 text-[11px] tracking-[0.08em] text-ink-3">{item.group}</div>}
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex w-full items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-[13.5px] transition-colors ${
                    isActive ? 'bg-primary-soft font-bold text-primary' : 'font-medium text-ink-2 hover:bg-bg hover:text-ink'
                  }`
                }
              >
                <span className="w-[18px] text-center text-[15px]">{item.icon}</span>
                {item.label}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-line px-4 py-3.5 text-[12.5px] text-ink-2">
          <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-pill bg-orange-soft text-[13px] font-extrabold text-orange">
            {me.name.slice(0, 1)}
          </div>
          <div>
            {me.name}
            <br />
            <button type="button" className="text-ink-3 hover:text-primary" onClick={logout}>退出登录</button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[58px] items-center gap-3.5 border-b border-line bg-card px-7">
          <div className="text-[13px] text-ink-2">
            {CRUMB_PREFIX} / <b className="text-ink">{current}</b>
          </div>
          <div className="ml-auto flex w-[250px] items-center gap-2 rounded-[10px] bg-bg px-3.5 py-2 text-[13px] text-ink-3">⌕ 搜索…</div>
          <div className="relative flex h-9 w-9 items-center justify-center rounded-[10px] bg-bg text-ink-2">
            ◷<span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-pill bg-red" />
          </div>
        </div>
        <div className="flex-1 p-7">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/** 页面头(原型 page-head:21px/800 标题 + sub + 右侧 actions) */
export function PageHead({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-[21px] font-extrabold">{title}</h2>
        {sub && <div className="mt-1 text-[13px] text-ink-2">{sub}</div>}
      </div>
      {actions && <div className="flex gap-2.5">{actions}</div>}
    </div>
  );
}
