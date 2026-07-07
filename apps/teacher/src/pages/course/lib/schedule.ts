/**
 * 讲次排期表单(MVP 口径:排课规则简化为教师手动逐讲设时间,见裁剪手册;
 * 管理员建课自动生成空讲次,上课时间由教师在「我的课程」逐讲设置)。
 * 纯函数便于单测;页面经 PUT /lessons/{id} 提交(契约已有 scheduledStart/scheduledEnd)。
 */
import type { LessonDto } from '@qiming/contracts';

export interface ScheduleForm {
  title: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** ISO → 本地 YYYY-MM-DD / HH:MM(拆给 date/time 输入框) */
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 讲次 → 表单初值(未排期给空,便于占位提示) */
export function scheduleFormFrom(lesson: LessonDto): ScheduleForm {
  return {
    title: lesson.title,
    date: lesson.scheduledStart ? localDate(lesson.scheduledStart) : '',
    start: lesson.scheduledStart ? localTime(lesson.scheduledStart) : '',
    end: lesson.scheduledEnd ? localTime(lesson.scheduledEnd) : '',
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** 校验:{字段: 错误文案},空对象 = 通过(口径同 admin lib/validate) */
export function validateSchedule(f: ScheduleForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.title.trim()) e.title = '请填写讲次标题';
  else if (f.title.trim().length > 128) e.title = '标题不能超过 128 字';
  if (!YMD.test(f.date.trim())) e.date = '请选择上课日期';
  if (!HHMM.test(f.start.trim())) e.start = '开始时间格式应为 HH:MM';
  if (!HHMM.test(f.end.trim())) e.end = '结束时间格式应为 HH:MM';
  if (!e.start && !e.end && f.start.trim() >= f.end.trim()) e.end = '结束时间需晚于开始时间';
  return e;
}

/** 表单 → PUT /lessons/{id} body(本地时区 → ISO;先 validateSchedule 通过再调用) */
export function schedulePayload(f: ScheduleForm): {
  title: string;
  scheduledStart: string;
  scheduledEnd: string;
} {
  return {
    title: f.title.trim(),
    scheduledStart: new Date(`${f.date.trim()}T${f.start.trim()}:00`).toISOString(),
    scheduledEnd: new Date(`${f.date.trim()}T${f.end.trim()}:00`).toISOString(),
  };
}
