/**
 * 重置密码弹窗(学生 / 教师通用):
 * 确认 → POST reset-password → 显示明文临时密码(可复制 + 当面告知)。
 * 取代旧的「短信发码」流程:管理员当场拿到临时密码,当面告知本人。
 */
import { useEffect, useState } from 'react';
import { Button, Modal, useToast } from '@qiming/ui';
import { api } from '../api';

export type ResetPasswordRole = 'student' | 'teacher';

export interface ResetPasswordTarget {
  id: number;
  name: string;
  /** 学号(学生)或工号(教师) */
  no: string;
  role: ResetPasswordRole;
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

  // 每次打开重置内部状态
  useEffect(() => {
    setPassword(null);
    setFailed(false);
    setBusy(false);
  }, [target]);

  const copy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      toast('临时密码已复制');
    } catch {
      toast('复制失败,请手动选择密码文本');
    }
  };

  const reset = async () => {
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
  };

  const copyText = ROLE_COPY[target?.role ?? 'student'];

  return (
    <Modal
      open={!!target}
      title={target ? `重置密码 · ${target.name}(${target.no})` : ''}
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
            临时密码已生成,请<b className="text-ink">当面告知{copyText.who}</b>,{copyText.loginHint}:
          </div>
          <button
            type="button"
            onClick={copy}
            className="select-all rounded-md border border-line bg-bg px-4 py-2.5 font-mono text-[16px] tracking-[0.12em] text-ink hover:border-primary"
            title="点击复制"
          >
            {password}
          </button>
          <button type="button" className="text-[13px] font-medium text-primary hover:underline" onClick={copy}>复制密码</button>
          <div className="text-xs text-ink-3">出于安全,密码仅此处显示一次;关闭后无法再次查看,可重新重置。</div>
        </div>
      ) : failed ? (
        <div className="py-8 text-center text-[13.5px] text-ink-3">重置失败,请重试</div>
      ) : (
        <div className="text-sm leading-relaxed text-ink-2">
          重置后 <b className="text-ink">{target?.name}</b> 的原密码立即失效,系统会生成一条新的临时密码。
          确定要为该{copyText.who}重置登录密码吗?
        </div>
      )}
    </Modal>
  );
}
