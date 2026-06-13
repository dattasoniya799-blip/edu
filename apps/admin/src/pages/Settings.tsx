/** 平台设置(原型 a-settings,按裁剪表:只留「引导模式开关 + 使用时段」可改,其余固定默认值) */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { OrgSettings } from '@qiming/contracts';
import { Button, Card, EmptyState, Modal, Skeleton, Switch, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { Field, FormRow, RoleNote, TextInput } from '../components/controls';
import { validateHours } from '../lib/validate';
import { PageHead } from './Shell';

export function Settings() {
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await api.get('/admin/settings');
      setSettings(r.data.orgSettings);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleGuideOnly = async (next: boolean) => {
    if (!settings) return;
    setSaving(true);
    const prev = settings;
    setSettings({ ...settings, ai: { ...settings.ai, qaGuideOnly: next } }); // 乐观更新
    try {
      await api.put('/admin/settings', { body: { qaGuideOnly: next } });
      toast(next ? '已开启「仅引导不报答案」模式,对全机构生效' : '已关闭引导模式,AI 可直接讲解答案');
    } catch {
      setSettings(prev);
      toast('保存失败,请重试');
    } finally {
      setSaving(false);
    }
  };

  const saveHours = async (start: string, end: string) => {
    await api.put('/admin/settings', { body: { studentHours: { start, end } } });
    toast('学生端使用时段已更新,对全机构生效');
    setHoursOpen(false);
    await load();
  };

  return (
    <div>
      <PageHead title="平台设置" sub="AI 能力开关与安全策略 · 变更对全机构生效" />
      {failed ? (
        <Card><EmptyState text="设置加载失败" hint="请检查后端或 mock 是否就绪" action={<Button onClick={() => void load()}>重试</Button>} /></Card>
      ) : !settings ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Skeleton className="h-[260px] w-full !rounded-lg" />
          <Skeleton className="h-[260px] w-full !rounded-lg" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title={<span className="flex items-center gap-2">AI 能力 <Tag tone="violet">AI</Tag></span>}>
            <div className="flex flex-col gap-4">
              <SettingRow title="课堂 AI 伴学" desc="上课场景核心能力:按教师编排的流程带学生上课">
                <Tag tone="green">已开启</Tag>
              </SettingRow>
              <SettingRow title="AI 答疑助教" desc="做题时可向 AI 提问;开启后「仅引导不报答案」">
                <span className="flex items-center gap-2.5">
                  {settings.ai.qaGuideOnly ? <Tag tone="orange">仅引导模式</Tag> : <Tag tone="green">已开启</Tag>}
                  <Switch checked={settings.ai.qaGuideOnly} disabled={saving} label="仅引导不报答案" onChange={(v) => void toggleGuideOnly(v)} />
                </span>
              </SettingRow>
              <SettingRow title="主观题预批改" desc="解答题先由 AI 预批,教师复核后才出分">
                <Tag tone="green">已开启</Tag>
              </SettingRow>
              <SettingRow title="学情诊断" desc="错题自动归因到知识点,生成课程与个人薄弱点分析" last>
                <Tag tone="green">已开启</Tag>
              </SettingRow>
            </div>
          </Card>
          <Card title="账号与安全">
            <div className="flex flex-col gap-4">
              <SettingRow title="学生设备绑定" desc="学生平板首次登录后绑定本机,限制 1 人 1 机">
                <Tag tone="green">已开启</Tag>
              </SettingRow>
              <SettingRow title="课堂模式锁定" desc="上课期间平板锁定在课堂应用内,防止切出">
                <Tag tone="green">已开启</Tag>
              </SettingRow>
              <SettingRow
                title="学生端使用时段"
                desc={`每日 ${settings.studentHours.start} – ${settings.studentHours.end} 可登录,超时自动锁定`}
                last
              >
                <button type="button" className="text-[13px] font-medium text-primary hover:underline" onClick={() => setHoursOpen(true)}>
                  修改
                </button>
              </SettingRow>
            </div>
          </Card>
        </div>
      )}

      {settings && (
        <HoursModal
          open={hoursOpen}
          initial={settings.studentHours}
          onClose={() => setHoursOpen(false)}
          onSave={saveHours}
        />
      )}
    </div>
  );
}

function SettingRow({ title, desc, last, children }: { title: string; desc: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={`flex items-center gap-3 ${last ? '' : 'border-b border-line pb-4'}`}>
      <div className="flex-1 text-sm">
        <b className="text-ink">{title}</b>
        <div className="mt-0.5 text-xs text-ink-3">{desc}</div>
      </div>
      {children}
    </div>
  );
}

/** 使用时段弹窗:HH:MM 校验 + start < end */
function HoursModal({ open, initial, onClose, onSave }: {
  open: boolean;
  initial: { start: string; end: string };
  onClose: () => void;
  onSave: (start: string, end: string) => Promise<void>;
}) {
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setStart(initial.start); setEnd(initial.end); setErrors({}); }
  }, [open, initial]);

  const submit = async () => {
    const errs = validateHours(start, end);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await onSave(start, end);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="学生端使用时段"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormRow>
          <Field label="每日开始时间" error={errors.start}>
            <TextInput type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="每日结束时间" error={errors.end}>
            <TextInput type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </FormRow>
        <RoleNote>时段外学生平板将自动锁定、无法登录;正在进行的课堂不受影响。</RoleNote>
      </div>
    </Modal>
  );
}
