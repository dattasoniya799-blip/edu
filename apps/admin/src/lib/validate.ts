/** 表单校验(纯函数,vitest 覆盖)。返回 {字段: 错误文案},空对象 = 通过 */

export const isPhone = (v: string): boolean => /^1\d{10}$/.test(v.trim());

/** HH:MM(24 小时制) */
export const isHHMM = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());

export interface TeacherForm { name: string; phone: string; stage: string; subject: string; teacherNo?: string }

export function validateTeacher(f: TeacherForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = '请填写姓名';
  else if (f.name.trim().length > 32) e.name = '姓名不能超过 32 字';
  if (!isPhone(f.phone)) e.phone = '请填写 11 位手机号';
  if (!f.stage) e.stage = '请选择学段';
  if (!f.subject) e.subject = '请选择学科';
  return e;
}

export interface StudentForm { name: string; parentPhone: string; grade: string; studentNo?: string; courseIds: number[] }

export function validateStudent(f: StudentForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = '请填写姓名';
  else if (f.name.trim().length > 32) e.name = '姓名不能超过 32 字';
  if (!isPhone(f.parentPhone)) e.parentPhone = '请填写 11 位家长手机号';
  if (!f.grade) e.grade = '请选择年级';
  return e;
}

export interface CourseForm { name: string; classType: string; subject: string; stage: string; teacherId: number; totalLessons: number }

export function validateCourse(f: CourseForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = '请填写课程名称';
  if (!f.classType) e.classType = '请选择班型';
  if (!f.subject) e.subject = '请选择学科';
  if (!f.stage) e.stage = '请选择学段';
  if (!f.teacherId) e.teacherId = '请选择授课教师';
  if (!Number.isInteger(f.totalLessons) || f.totalLessons < 1 || f.totalLessons > 99) e.totalLessons = '总讲次为 1–99 的整数';
  return e;
}

export interface QuotaForm { monthlyLimit: number; alertThreshold: number; overPolicy: string }

export function validateQuota(f: QuotaForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!Number.isFinite(f.monthlyLimit) || f.monthlyLimit <= 0) e.monthlyLimit = '月度额度需大于 0';
  if (!Number.isInteger(f.alertThreshold) || f.alertThreshold < 50 || f.alertThreshold > 95) e.alertThreshold = '告警阈值为 50–95';
  if (!f.overPolicy) e.overPolicy = '请选择超额策略';
  return e;
}

/** 学生端使用时段:HH:MM 且 start < end */
export function validateHours(start: string, end: string): Record<string, string> {
  const e: Record<string, string> = {};
  if (!isHHMM(start)) e.start = '开始时间格式应为 HH:MM';
  if (!isHHMM(end)) e.end = '结束时间格式应为 HH:MM';
  if (!e.start && !e.end && start >= end) e.end = '结束时间需晚于开始时间';
  return e;
}
