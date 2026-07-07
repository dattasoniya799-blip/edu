/**
 * 学生端外壳(平板横屏 1180×820):顶部 logo + 胶囊 Tab(激活 = primary 实底白字)
 * 触控目标 ≥ 44px;按 MVP 裁剪:无学分/连续天数(激励体系延后)
 */
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Stage } from '../Stage';

const TABS = [
  { to: '/', label: '今日' },
  { to: '/courses', label: '我的课程' },
  { to: '/homework', label: '作业' },
  { to: '/wrong-book', label: '错题本' },
  { to: '/report', label: '报告' },
];

export function Shell() {
  const { me, ready, logout } = useAuth();
  if (!ready) return <Stage><div className="flex flex-1 items-center justify-center text-ink-3">加载中…</div></Stage>;
  if (!me) return <Navigate to="/login" replace />;

  return (
    <Stage>
      <div className="flex h-[64px] shrink-0 items-center gap-3.5 border-b border-line bg-card px-6">
        <div className="flex items-center gap-2 text-[15px] font-extrabold">
          <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-gradient-to-br from-primary to-primary-deep text-xs font-extrabold text-card">鲸</span>
          鲸云AI教育平台
        </div>
        <nav className="ml-3.5 flex gap-0.5">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                `min-h-touch flex items-center rounded-pill px-4 text-[13.5px] font-semibold transition-all ${
                  isActive ? 'bg-primary text-card shadow-btn-sm' : 'text-ink-2 hover:text-ink'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5 text-[13px]">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-pill bg-orange-soft text-xs font-extrabold text-orange">
            {me.name.slice(-1)}
          </div>
          {me.name}
          <button type="button" className="min-h-touch px-2 text-xs text-ink-3 hover:text-primary" onClick={logout}>
            退出
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <Outlet />
      </div>
    </Stage>
  );
}
