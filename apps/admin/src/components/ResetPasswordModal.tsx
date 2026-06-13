/** 重置学生密码弹窗:确认 → POST reset-password → 显示明文临时密码(可复制 + 当面告知) */
import { useEffect, useState } from 'react';
import { Button, Modal, useToast } from '@qiming/ui';
import { api } from '../api';

export interface ResetPasswordStudent { id: number; name: string; studentNo: string }

export interface ResetPasswordModalProps {
  /** 为 null 时关闭 */
  student: ResetPasswordStudent | null;
  onClose: () => void;
}

export function ResetPasswordModal({ student, onClose }: ResetPasswordModalProps) {
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const { toast } = useToast();

  // 每次打开重置内部状态
  useEffect(() => {
    setPassword(null);
    setFailed(false);
    setBusy(false);
  }, [student]);

  const reset = async () => {
    if (!student) return;
    setBusy(true);
    setFailed(false);
    try {
      const r = await api.post('/admin/students/{id}/reset-password', { params: { id: student.id } });
      setPassword(r.data.password);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      toast('临时密码已复制');
    } catch {
      toast('复制失败,请手动选择密码文本');
    }
  };

  return (
    <Modal
      open={!!student}
      title={student ? `重置密码 · ${student.name}(${student.studentNo})` : ''}
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
          <div className="text-[13.5px] text-ink-2">临时密码已生成,请<b className="text-ink">当面告知学生</b>,学生用学号 + 此密码登录平板:</div>
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
          重置后 <b className="text-ink">{student?.name}</b> 的原密码立即失效,系统会生成一条新的临时密码。
          确定要为该学生重置登录密码吗?
        </div>
      )}
    </Modal>
  );
}
