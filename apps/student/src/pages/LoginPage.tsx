/**
 * 学生端登录页(平板 1180×820)· 视觉=原型登录页(品牌区 + 三角色 Tab 登录卡)
 * 学生 Tab:学号 + 密码登录(调 /auth/student/login);管理员/教师 Tab 提示前往 PC 端。
 */
import type { FormEvent } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@qiming/contracts';
import { Button } from '@qiming/ui';
import { ROLE_LABEL, useAuth } from '../auth/AuthProvider';
import { Stage } from '../Stage';

const ROLE_NOTES: Record<Role, string> = {
  admin: '管理员使用电脑浏览器登录,管理机构内的教师与学生账号。',
  teacher: '教师使用电脑浏览器登录,维护题库、课件并发布作业。',
  student: '输入老师发给你的学号与密码登录;忘记密码请找老师重置。',
};
const APP_PORTS: Record<Role, string> = { admin: '5173', teacher: '5174', student: '5175' };

export function LoginPage() {
  const { loginWithPassword } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>('student');
  const [studentNo, setStudentNo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await loginWithPassword(studentNo, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败,请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stage>
      <div className="flex h-full font-sans text-ink">
        {/* 品牌区(渐变端点均为 design-tokens 主色) */}
        <div className="relative flex flex-[1.15] flex-col justify-center overflow-hidden bg-gradient-to-br from-primary-deep via-primary to-primary px-14 text-card">
          <div className="absolute -right-[100px] -top-[120px] h-[380px] w-[380px] rounded-pill bg-card/10" />
          <div className="absolute -bottom-20 -left-[60px] h-60 w-60 rounded-pill bg-card/[0.06]" />
          <h1 className="relative text-[32px] font-extrabold leading-[1.4]">
            老师精心出好每道题,
            <br />
            AI 帮学生<em className="rounded-[10px] bg-card/20 px-2.5 not-italic">学透</em>每道题
          </h1>
          <p className="relative mt-4 max-w-[420px] text-[14px] text-card/85">
            学生在平板上由 AI 带着完成「学 → 练 → 错题 → 报告」闭环。
          </p>
        </div>

        {/* 登录卡 */}
        <div className="flex flex-1 items-center justify-center bg-card p-10">
          <div className="w-[380px]">
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
                  className={`min-h-touch flex-1 rounded-[9px] text-[13.5px] transition-all ${
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

            {role !== 'student' ? (
              <div className="rounded-md border border-line bg-bg/50 px-4 py-5 text-center text-[13px] text-ink-2">
                请使用电脑浏览器访问{ROLE_LABEL[role]}端(本机调试:
                <span className="font-mono text-primary">localhost:{APP_PORTS[role]}</span>)。
              </div>
            ) : (
              <form onSubmit={onSubmit}>
                <div className="mb-4">
                  <label className="mb-1.5 block text-[13px] font-semibold" htmlFor="studentNo">学号</label>
                  <input
                    id="studentNo"
                    value={studentNo}
                    onChange={(e) => setStudentNo(e.target.value)}
                    placeholder="输入学号(mock 演示:S-0001)"
                    autoComplete="username"
                    className="min-h-touch w-full rounded-[11px] border-[1.5px] border-line bg-card px-3.5 py-[11px] text-sm outline-none transition-colors focus:border-primary"
                  />
                </div>
                <div className="mb-4">
                  <label className="mb-1.5 block text-[13px] font-semibold" htmlFor="password">密码</label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="输入密码(mock 演示:Student@123)"
                    autoComplete="current-password"
                    className="min-h-touch w-full rounded-[11px] border-[1.5px] border-line bg-card px-3.5 py-[11px] text-sm outline-none transition-colors focus:border-primary"
                  />
                </div>
                {error && <div className="mb-3 rounded-[9px] bg-red-soft px-[13px] py-[9px] text-[12.5px] text-red">{error}</div>}
                <Button
                  type="submit"
                  variant="primary"
                  block
                  disabled={busy || !studentNo.trim() || !password}
                  className="min-h-touch !py-[13px] !text-[15px] shadow-btn"
                >
                  {busy ? '正在登录…' : '进入学习'}
                </Button>
                <div className="mt-3 text-center text-xs text-ink-3">首次登录或忘记密码,请找老师重置后再登录</div>
              </form>
            )}
            <div className="mt-[18px] text-center text-xs text-ink-3">登录即代表同意《用户协议》与《隐私政策》</div>
          </div>
        </div>
      </div>
    </Stage>
  );
}
