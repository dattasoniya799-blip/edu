/**
 * 登录页 · 视觉=原型 v0.4 登录页(login-brand 渐变品牌区 + login-card 三角色 Tab)
 * 本端为 PC 端:管理员/教师 Tab 提供账密表单(角色不符给出指引);学生 Tab 提示前往平板学生端。
 */
import type { FormEvent } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@qiming/contracts';
import { Button } from '@qiming/ui';
import { APP_ROLE, ROLE_LABEL, useAuth } from '../auth/AuthProvider';

const ROLE_NOTES: Record<Role, string> = {
  admin: '管理员使用电脑浏览器登录,管理机构内的教师与学生账号。',
  teacher: '教师使用电脑浏览器登录,维护题库、课件并发布作业。',
  student: '学生端为平板设计,扫码或输入登录码即可在 iPad / 安卓平板登录。',
};
const APP_PORTS: Record<Role, string> = { admin: '5173', teacher: '5174', student: '5175' };

const BRAND_POINTS = [
  { ic: '✎', t: '专业题库,教师主导', s: 'LaTeX 公式录题、题干配图,支持初高中数理化全学科' },
  { ic: '▣', t: '课件与作业一体化', s: '课件推送到平板,作业自动批改、错题自动归档' },
  { ic: '✦', t: 'AI 学情与引导式答疑', s: '错题归因到知识点,AI 助教只引导、不报答案' },
];

export function LoginPage() {
  const { loginWithPassword } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>(APP_ROLE);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await loginWithPassword(phone.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败,请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen font-sans text-ink">
      {/* 品牌区(原型 login-brand;渐变端点均为 design-tokens 主色) */}
      <div className="relative hidden flex-[1.15] flex-col justify-center overflow-hidden bg-gradient-to-br from-primary-deep via-primary to-primary px-[76px] py-16 text-card lg:flex">
        <div className="absolute -right-[100px] -top-[120px] h-[380px] w-[380px] rounded-pill bg-card/10" />
        <div className="absolute -bottom-20 -left-[60px] h-60 w-60 rounded-pill bg-card/[0.06]" />
        <h1 className="relative text-[38px] font-extrabold leading-[1.4]">
          老师精心出好每道题,
          <br />
          AI 帮学生<em className="rounded-[10px] bg-card/20 px-2.5 not-italic">学透</em>每道题
        </h1>
        <p className="relative mt-[18px] max-w-[440px] text-[15px] text-card/85">
          面向课外辅导机构的 AI 办学平台:教师编排课堂、维护题库与课件,学生在平板上由 AI 带着完成「学 → 练 → 错题 → 报告」闭环。
        </p>
        <div className="relative mt-[42px] flex flex-col gap-[15px]">
          {BRAND_POINTS.map((p) => (
            <div key={p.t} className="flex items-start gap-[13px]">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-card/15 text-base">{p.ic}</div>
              <div>
                <b className="block text-sm">{p.t}</b>
                <span className="text-[12.5px] text-card/75">{p.s}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 登录卡(原型 login-panel / login-card) */}
      <div className="flex flex-1 items-center justify-center bg-card p-10">
        <div className="w-[400px]">
          <h2 className="text-2xl font-extrabold">登录</h2>
          <p className="mb-6 mt-1.5 text-[13px] text-ink-2">选择你的身份进入对应工作台</p>
          <div className="mb-5 flex rounded-md bg-bg p-1" role="tablist">
            {(['admin', 'teacher', 'student'] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={role === r}
                onClick={() => { setRole(r); setError(''); }}
                className={`flex-1 rounded-[9px] py-[9px] text-[13.5px] transition-all ${
                  role === r ? 'bg-card font-bold text-primary shadow-tab' : 'font-medium text-ink-2'
                }`}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <div className="mb-[18px] rounded-[9px] bg-primary-soft px-[13px] py-[9px] text-[12.5px] text-primary-deep">
            {ROLE_NOTES[role]}
          </div>

          {role === 'student' ? (
            <div className="rounded-md border border-line bg-bg/50 px-4 py-5 text-center text-[13px] text-ink-2">
              请在平板上打开学生端(本机调试:
              <span className="font-mono text-primary">localhost:{APP_PORTS.student}</span>
              ),输入家长手机收到的登录码即可。
            </div>
          ) : (
            <form onSubmit={onSubmit}>
              <div className="mb-4">
                <label className="mb-1.5 block text-[13px] font-semibold" htmlFor="phone">账号</label>
                <input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="手机号 / 工号"
                  autoComplete="username"
                  className="w-full rounded-[11px] border-[1.5px] border-line bg-card px-3.5 py-[11px] text-sm outline-none transition-colors focus:border-primary"
                />
              </div>
              <div className="mb-4">
                <label className="mb-1.5 block text-[13px] font-semibold" htmlFor="password">密码</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  className="w-full rounded-[11px] border-[1.5px] border-line bg-card px-3.5 py-[11px] text-sm outline-none transition-colors focus:border-primary"
                />
              </div>
              {error && <div className="mb-3 rounded-[9px] bg-red-soft px-[13px] py-[9px] text-[12.5px] text-red">{error}</div>}
              <Button
                type="submit"
                variant="primary"
                block
                disabled={busy || !phone || !password}
                className="!py-[13px] !text-[15px] shadow-btn"
              >
                {busy ? '正在登录…' : '进入工作台'}
              </Button>
            </form>
          )}
          <div className="mt-[18px] text-center text-xs text-ink-3">登录即代表同意《用户协议》与《隐私政策》</div>
        </div>
      </div>
    </div>
  );
}
