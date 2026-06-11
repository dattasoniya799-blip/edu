/** 添加/编辑教师弹窗(原型 modalTeacher) */
import { useEffect, useState } from 'react';
import type { TeacherDto } from '@qiming/contracts';
import { Button, Modal, useToast } from '@qiming/ui';
import { api } from '../api';
import { STAGES, SUBJECTS } from '../lib/labels';
import { validateTeacher } from '../lib/validate';
import { Field, FormRow, RoleNote, Select, TextInput } from './controls';

export interface TeacherFormModalProps {
  open: boolean;
  /** 传入则为编辑,否则为新增 */
  initial?: TeacherDto | null;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY = { name: '', teacherNo: '', phone: '', stage: '初中', subject: '数学' };

export function TeacherFormModal({ open, initial, onClose, onSaved }: TeacherFormModalProps) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(initial
      ? { name: initial.name, teacherNo: initial.teacherNo, phone: initial.phone, stage: initial.stage, subject: initial.subject }
      : EMPTY);
  }, [open, initial]);

  const set = (k: keyof typeof EMPTY) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const errs = validateTeacher(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const body = { name: form.name.trim(), phone: form.phone.trim(), stage: form.stage, subject: form.subject, ...(form.teacherNo.trim() ? { teacherNo: form.teacherNo.trim() } : {}) };
      if (initial) {
        await api.put('/admin/teachers/{id}', { params: { id: initial.id }, body });
        toast('教师信息已保存');
      } else {
        await api.post('/admin/teachers', { body });
        toast('教师账号已创建,初始密码已短信发送');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={initial ? '编辑教师' : '添加教师'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? '提交中…' : initial ? '保存' : '创建账号'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormRow>
          <Field label="姓名" error={errors.name}>
            <TextInput placeholder="教师姓名" value={form.name} onChange={(e) => set('name')(e.target.value)} />
          </Field>
          <Field label="工号(可留空自动生成)">
            <TextInput placeholder="如 T-0013" value={form.teacherNo} onChange={(e) => set('teacherNo')(e.target.value)} />
          </Field>
        </FormRow>
        <FormRow>
          <Field label="手机号" error={errors.phone}>
            <TextInput placeholder="用于登录与接收初始密码" value={form.phone} onChange={(e) => set('phone')(e.target.value)} />
          </Field>
          <Field label="学段" error={errors.stage}>
            <Select value={form.stage} onChange={(e) => set('stage')(e.target.value)}>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        </FormRow>
        <FormRow>
          <Field label="学科" error={errors.subject}>
            <Select value={form.subject} onChange={(e) => set('subject')(e.target.value)}>
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <div className="flex-1" />
        </FormRow>
        {!initial && <RoleNote>创建后系统将通过短信发送初始密码,教师首次登录需修改密码。</RoleNote>}
      </div>
    </Modal>
  );
}
