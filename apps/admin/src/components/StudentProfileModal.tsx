/** 学生档案弹窗(原型 modalStuDetail):mini-stats + 在读课程 */
import { useCallback, useEffect, useState } from 'react';
import type { MasteryItemDto, StudentDto } from '@qiming/contracts';
import { Button, Modal, Skeleton, Tag } from '@qiming/ui';
import { api } from '../api';
import { formatDurationHM } from '../lib/format';
import { CLASS_TYPE_LABEL } from '../lib/labels';
import type { ResetPasswordTarget } from './ResetPasswordModal';

interface Profile { student: StudentDto; mastery: MasteryItemDto[]; wrongOpenCount: number }

export interface StudentProfileModalProps {
  /** 为 null 时关闭 */
  studentId: number | null;
  onClose: () => void;
  /** 提供则显示「重置密码」入口 */
  onResetPassword?: (target: ResetPasswordTarget) => void;
}

export function StudentProfileModal({ studentId, onClose, onResetPassword }: StudentProfileModalProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (id: number) => {
    setFailed(false);
    try {
      const r = await api.get('/admin/students/{id}/profile', { params: { id } });
      setProfile(r.data as Profile);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    setProfile(null);
    if (studentId != null) void load(studentId);
  }, [studentId, load]);

  const s = profile?.student;
  const avgMastery = profile && profile.mastery.length
    ? Math.round(profile.mastery.reduce((acc, m) => acc + m.mastery, 0) / profile.mastery.length)
    : null;

  return (
    <Modal
      open={studentId != null}
      title={s ? `学生档案 · ${s.name}(${s.studentNo})` : '学生档案'}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>关闭</Button>
          {s && onResetPassword && (
            <Button variant="primary" onClick={() => onResetPassword({ id: s.id, name: s.name, no: s.studentNo, role: 'student' })}>
              重置密码
            </Button>
          )}
        </>
      }
    >
      {failed ? (
        <div className="py-10 text-center text-[13.5px] text-ink-3">档案加载失败,请重试</div>
      ) : !profile || !s ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-[64px] w-full" />
          <Skeleton className="h-5 w-full" lines={3} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-2">
            <MiniStat value={String(s.courses.length)} label="在读课程" />
            <MiniStat
              value={avgMastery != null ? `${avgMastery}%` : '—'}
              label="平均掌握率"
              tone={avgMastery == null ? undefined : avgMastery >= 80 ? 'green' : avgMastery < 60 ? 'red' : undefined}
            />
            <MiniStat value={formatDurationHM(s.weekStudySec)} label="近 7 日时长" />
            <MiniStat value={String(profile.wrongOpenCount)} label="待消灭错题" tone={profile.wrongOpenCount > 0 ? 'red' : undefined} />
          </div>
          <div className="flex flex-col gap-3">
            {s.courses.length === 0 && (
              <div className="rounded-[10px] bg-bg px-3.5 py-3 text-[13px] text-ink-3">暂未报名课程</div>
            )}
            {s.courses.map((c) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-line pb-3 text-sm">
                <div className="flex-1">
                  <b>{c.name}</b>
                  <div className="text-xs text-ink-3">{CLASS_TYPE_LABEL[c.classType]}</div>
                </div>
                <Tag tone="green">在读</Tag>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function MiniStat({ value, label, tone }: { value: string; label: string; tone?: 'green' | 'red' }) {
  const color = tone === 'green' ? 'text-green' : tone === 'red' ? 'text-red' : 'text-ink';
  return (
    <div className="rounded-md bg-bg px-3 py-2.5 text-center">
      <b className={`block text-[17px] tabular-nums ${color}`}>{value}</b>
      <small className="text-[11px] text-ink-3">{label}</small>
    </div>
  );
}
