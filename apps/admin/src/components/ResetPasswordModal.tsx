/**
 * 重置密码弹窗(学生 / 教师通用):
 * 确认 → POST reset-password → 显示明文临时密码(可复制 + 当面告知)。
 * 取代旧的「短信发码」流程:管理员当场拿到临时密码,当面告知本人。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, useToast } from '@qiming/ui';
import { api } from '../api';
import { copyText } from '../lib/copyText';

export type ResetPasswordRole = 'student' | 'teacher';

export interface ResetPasswordTarget {
  id: number;
  name: string;
  /** 学号(学生)或工号(教师) */
  no: string;
  role: ResetPasswordRole;
  /** 新建教师/学生后置 true:打开即自动重置,直接取首登明文密码,省去手动「确认重置」一步(P2-12) */
  auto?: boolean;
}

export interface ResetPasswordModalProps {
  /** 为 null 时关闭 */
  target: ResetPasswordTarget | null;
  onClose: () => void;
}

/** 角色相关文案 */
const ROLE_COPY: Record<ResetPasswordRole, { who: string; loginHint: string }> = {
  student: { who: '学生', loginHint: '学生用学号 + 此密码登录平板' },
  teacher: { who: '教师', loginHint: '教师用手机号 + 此密码登录电脑端' },
};

export function ResetPasswordModal({ target, onClose }: ResetPasswordModalProps) {
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const { toast } = useToast();

  const reset = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = target.role === 'teacher'
        ? await api.post('/admin/teachers/{id}/reset-password', { params: { id: target.id } })
        : await api.post('/admin/students/{id}/reset-password', { params: { id: target.id } });
      setPassword(r.data.password);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [target]);

  // 每次打开重置内部状态;新建场景(auto)则自动发起重置直接取明文密码
  useEffect(() => {
    setPassword(null);
    setFailed(false);
    setBusy(false);
    if (target?.auto) void reset();
  }, [target, reset]);

  const copy = async () => {
    if (!password) return;
    // copyText 内部先走 navigator.clipboard,不可用/被拒时回退 execCommand,均失败才返回 false
    const ok = await copyText(password);
    toast(ok ? '临时密码已复制' : '复制失败,请长按/框选下方密码手动复制');
  };

  const roleText = ROLE_COPY[target?.role ?? 'student'];
  const auto = target?.auto ?? false;
  const pwLabel = auto ? '初始密码' : '临时密码';

  return (
    <Modal
      open={!!target}
      title={target ? `${auto ? '初始密码' : '重置密码'} · ${target.name}(${target.no})` : ''}
      onClose={onClose}
      width={420}
      footer={
        password
          ? <Button variant="primary" onClick={onClose}>完成</Button>
          : (
            <>
              <Button onClick={onClose} disabled={busy}>取消</Button>
              <Button variant="primary" onClick={reset} disabled={busy}>{busy ? '重置中…' : '确认重置密码'}</Button>
            </>
          )
      }
    >
      {password ? (
        <div className="flex flex-col items-center gap-3.5 py-1">
          <div className="text-[13.5px] text-ink-2">
            {auto && <>账号已创建。</>}{pwLabel}已生成,请<b className="text-ink">当面告知{roleText.who}</b>,{roleText.loginHint}:
          </div>
          {/* 用 code 而非 button 展示:Safari 中 button 内文本不可框选,复制失败时用户还能手动选中兜底 */}
          <code
            onClick={copy}
            className="cursor-pointer select-all rounded-md border border-line bg-bg px-4 py-2.5 font-mono text-[16px] tracking-[0.12em] text-ink hover:border-primary"
            title="点击复制"
          >
            {password}
          </code>
          <button type="button" className="text-[13px] font-medium text-primary hover:underline" onClick={copy}>复制密码</button>
          <div className="text-xs text-ink-3">出于安全,密码仅此处显示一次;关闭后无法再次查看,可重新重置。</div>
        </div>
      ) : failed ? (
        <div className="py-8 text-center text-[13.5px] text-ink-3">
          {auto
            ? <>账号已创建,但自动生成初始密码失败。<br />可点「确认重置密码」重试,或稍后在列表中手动重置。</>
            : '重置失败,请重试'}
        </div>
      ) : busy ? (
        <div className="py-8 text-center text-[13.5px] text-ink-3">正在生成{pwLabel}…</div>
      ) : (
        <div className="text-sm leading-relaxed text-ink-2">
          重置后 <b className="text-ink">{target?.name}</b> 的原密码立即失效,系统会生成一条新的临时密码。
          确定要为该{roleText.who}重置登录密码吗?
        </div>
      )}
    </Modal>
  );
}
