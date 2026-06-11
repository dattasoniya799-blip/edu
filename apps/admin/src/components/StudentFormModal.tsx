/** 添加学生弹窗(原型 modalStudent):创建并发送登录码 */
import { useEffect, useState } from 'react';
import type { CourseDto, StudentDto } from '@qiming/contracts';
import { Button, Modal, useToast } from '@qiming/ui';
import { api } from '../api';
import { CLASS_TYPE_LABEL, GRADES } from '../lib/labels';
import { validateStudent } from '../lib/validate';
import { Field, FormRow, RoleNote, Select, TextInput } from './controls';

export interface StudentFormModalProps {
  open: boolean;
  /** 可报名课程(供多选) */
  courses: CourseDto[];
  onClose: () => void;
  /** 创建成功(返回新学生,父页面据此刷新并弹登录码) */
  onSaved: (created: StudentDto) => void;
}

const EMPTY = { name: '', studentNo: '', parentPhone: '', grade: '初二' };

export function StudentFormModal({ open, courses, onClose, onSaved }: StudentFormModalProps) {
  const [form, setForm] = useState(EMPTY);
  const [courseIds, setCourseIds] = useState<number[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setCourseIds([]);
    setErrors({});
  }, [open]);

  const set = (k: keyof typeof EMPTY) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggleCourse = (id: number) =>
    setCourseIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const submit = async () => {
    const errs = validateStudent({ ...form, courseIds });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await api.post('/admin/students', {
        body: {
          name: form.name.trim(), parentPhone: form.parentPhone.trim(), grade: form.grade,
          ...(form.studentNo.trim() ? { studentNo: form.studentNo.trim() } : {}),
          courseIds,
        },
      });
      toast('学生已创建,登录码已发送至家长手机');
      onSaved(r.data as StudentDto);
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
      title="添加学生"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? '提交中…' : '创建并发送登录码'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormRow>
          <Field label="姓名" error={errors.name}>
            <TextInput placeholder="学生姓名" value={form.name} onChange={(e) => set('name')(e.target.value)} />
          </Field>
          <Field label="学号(可留空自动生成)">
            <TextInput placeholder="如 S-0287" value={form.studentNo} onChange={(e) => set('studentNo')(e.target.value)} />
          </Field>
        </FormRow>
        <FormRow>
          <Field label="家长手机号" error={errors.parentPhone}>
            <TextInput placeholder="用于接收平板登录码" value={form.parentPhone} onChange={(e) => set('parentPhone')(e.target.value)} />
          </Field>
          <Field label="年级" error={errors.grade}>
            <Select value={form.grade} onChange={(e) => set('grade')(e.target.value)}>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
        </FormRow>
        <div className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-ink-2">
          报名课程(可多选)
          <div className="flex max-h-36 flex-col gap-1 overflow-auto rounded-[10px] border-[1.5px] border-line p-2">
            {courses.length === 0 && <div className="px-1.5 py-1 text-xs font-normal text-ink-3">暂无可报名课程,可先创建学生稍后报名</div>}
            {courses.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-[8px] px-1.5 py-1 text-[13px] font-normal text-ink hover:bg-bg">
                <input type="checkbox" className="accent-primary" checked={courseIds.includes(c.id)} onChange={() => toggleCourse(c.id)} />
                {c.name}
                <span className="text-xs text-ink-3">{CLASS_TYPE_LABEL[c.classType]} · {c.teacherName}</span>
              </label>
            ))}
          </div>
        </div>
        <RoleNote>创建后将向家长手机号发送平板登录二维码,学生在平板扫码即完成设备绑定。</RoleNote>
      </div>
    </Modal>
  );
}
