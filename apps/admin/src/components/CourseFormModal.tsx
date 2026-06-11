/** 新建课程弹窗(原型 modalCourse;按裁剪表:排课规则/开课日期延后,创建后教师逐讲设时间) */
import { useEffect, useState } from 'react';
import type { ClassType, TeacherDto } from '@qiming/contracts';
import { Button, Modal, useToast } from '@qiming/ui';
import { api } from '../api';
import { CLASS_TYPE_LABEL, STAGES, SUBJECTS } from '../lib/labels';
import { validateCourse } from '../lib/validate';
import { Field, FormRow, RoleNote, Select, TextInput } from './controls';

export interface CourseFormModalProps {
  open: boolean;
  teachers: TeacherDto[];
  onClose: () => void;
  onSaved: () => void;
}

const CLASS_TYPES = Object.keys(CLASS_TYPE_LABEL) as ClassType[];

export function CourseFormModal({ open, teachers, onClose, onSaved }: CourseFormModalProps) {
  const activeTeachers = teachers.filter((t) => t.status === 'active');
  const [form, setForm] = useState({ name: '', classType: 'group' as ClassType, subject: '数学', stage: '初中', teacherId: 0, totalLessons: 15 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm({ name: '', classType: 'group', subject: '数学', stage: '初中', teacherId: activeTeachers[0]?.id ?? 0, totalLessons: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    const errs = validateCourse(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api.post('/admin/courses', {
        body: {
          name: form.name.trim(), classType: form.classType, subject: form.subject,
          stage: form.stage, teacherId: form.teacherId, totalLessons: form.totalLessons,
        },
      });
      toast(`课程已创建,已自动生成 ${form.totalLessons} 个讲次`);
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : '创建失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="新建课程"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? '提交中…' : '创建课程'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="课程名称" error={errors.name}>
          <TextInput placeholder="如:2026 暑期初二数学提高班" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <FormRow>
          <Field label="班型" error={errors.classType}>
            <Select value={form.classType} onChange={(e) => setForm((f) => ({ ...f, classType: e.target.value as ClassType }))}>
              {CLASS_TYPES.map((t) => <option key={t} value={t}>{CLASS_TYPE_LABEL[t]}</option>)}
            </Select>
          </Field>
          <Field label="学段" error={errors.stage}>
            <Select value={form.stage} onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value }))}>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        </FormRow>
        <FormRow>
          <Field label="学科" error={errors.subject}>
            <Select value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}>
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="授课教师" error={errors.teacherId}>
            <Select value={form.teacherId} onChange={(e) => setForm((f) => ({ ...f, teacherId: Number(e.target.value) }))}>
              <option value={0}>请选择</option>
              {activeTeachers.map((t) => <option key={t.id} value={t.id}>{t.name}({t.subject})</option>)}
            </Select>
          </Field>
        </FormRow>
        <FormRow>
          <Field label="总讲次" error={errors.totalLessons}>
            <TextInput
              type="number" min={1} max={99} value={form.totalLessons}
              onChange={(e) => setForm((f) => ({ ...f, totalLessons: Number(e.target.value) }))}
            />
          </Field>
          <div className="flex-1" />
        </FormRow>
        <RoleNote>创建后系统自动生成全部讲次,上课时间由教师在「我的课程」中逐讲设置(MVP 口径),并逐讲编排课堂。</RoleNote>
      </div>
    </Modal>
  );
}
