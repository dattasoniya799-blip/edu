/** 平板登录码弹窗:二维码内容 = ticket token(验收项) */
import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, QrCode, Skeleton, useToast } from '@qiming/ui';
import { api } from '../api';
import { formatDateCn } from '../lib/format';

export interface TicketStudent { id: number; name: string; studentNo: string }

export interface LoginTicketModalProps {
  /** 为 null 时关闭 */
  student: TicketStudent | null;
  onClose: () => void;
}

export function LoginTicketModal({ student, onClose }: LoginTicketModalProps) {
  const [ticket, setTicket] = useState<{ token: string; expiresAt: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const { toast } = useToast();

  const issue = useCallback(async (id: number, silent = false) => {
    setTicket(null);
    setFailed(false);
    try {
      const r = await api.post('/admin/students/{id}/login-ticket', { params: { id } });
      setTicket(r.data);
      if (!silent) toast('已生成新的平板登录二维码');
    } catch {
      setFailed(true);
    }
  }, [toast]);

  useEffect(() => {
    if (student) void issue(student.id, true);
  }, [student, issue]);

  return (
    <Modal
      open={!!student}
      title={student ? `平板登录码 · ${student.name}(${student.studentNo})` : ''}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={() => student && issue(student.id)} disabled={!ticket && !failed}>重新生成</Button>
          <Button variant="primary" onClick={onClose}>完成</Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3.5 py-1">
        {failed ? (
          <div className="py-10 text-[13.5px] text-ink-3">登录码生成失败,请重试</div>
        ) : ticket ? (
          <>
            <div className="rounded-md border border-line p-3">
              <QrCode value={ticket.token} size={180} />
            </div>
            <div className="font-mono text-[13px] tracking-[0.08em] text-ink">{ticket.token}</div>
            <div className="text-xs text-ink-3">有效期至 {formatDateCn(ticket.expiresAt)} · 学生在平板登录页扫码即完成设备绑定</div>
          </>
        ) : (
          <>
            <Skeleton className="h-[204px] w-[204px]" />
            <Skeleton className="h-4 w-40" />
          </>
        )}
      </div>
    </Modal>
  );
}
