/** 二次确认弹窗(重置密码 / 停用 / 解绑等) */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button, Modal } from '@qiming/ui';

export interface ConfirmModalProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  confirmText?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmModal({ open, title, children, confirmText = '确认', onConfirm, onClose }: ConfirmModalProps) {
  const [busy, setBusy] = useState(false);
  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={handleConfirm} disabled={busy}>{busy ? '处理中…' : confirmText}</Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-ink-2">{children}</div>
    </Modal>
  );
}
