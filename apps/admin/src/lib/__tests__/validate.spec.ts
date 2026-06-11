import { describe, expect, it } from 'vitest';
import { isHHMM, isPhone, validateCourse, validateHours, validateQuota, validateStudent, validateTeacher } from '../validate';

describe('isPhone / isHHMM', () => {
  it('11 位 1 开头手机号', () => {
    expect(isPhone('13800000001')).toBe(true);
    expect(isPhone('2380000000')).toBe(false);
    expect(isPhone('138000')).toBe(false);
  });
  it('HH:MM 24 小时制', () => {
    expect(isHHMM('06:00')).toBe(true);
    expect(isHHMM('22:30')).toBe(true);
    expect(isHHMM('24:00')).toBe(false);
    expect(isHHMM('6:00')).toBe(false);
  });
});

describe('validateTeacher', () => {
  const ok = { name: '张明', phone: '13800000002', stage: '初中', subject: '数学' };
  it('合法表单通过', () => expect(validateTeacher(ok)).toEqual({}));
  it('缺姓名/坏手机号报错', () => {
    expect(validateTeacher({ ...ok, name: ' ' }).name).toBeTruthy();
    expect(validateTeacher({ ...ok, phone: '123' }).phone).toBeTruthy();
  });
});

describe('validateStudent', () => {
  const ok = { name: '林小满', parentPhone: '13900000001', grade: '初二', courseIds: [1] };
  it('合法表单通过', () => expect(validateStudent(ok)).toEqual({}));
  it('家长手机号必须合法', () => {
    expect(validateStudent({ ...ok, parentPhone: 'abc' }).parentPhone).toBeTruthy();
  });
});

describe('validateCourse', () => {
  const ok = { name: '初二数学提高班', classType: 'group', subject: '数学', stage: '初中', teacherId: 2, totalLessons: 15 };
  it('合法表单通过', () => expect(validateCourse(ok)).toEqual({}));
  it('讲次范围 1–99 整数', () => {
    expect(validateCourse({ ...ok, totalLessons: 0 }).totalLessons).toBeTruthy();
    expect(validateCourse({ ...ok, totalLessons: 1.5 }).totalLessons).toBeTruthy();
    expect(validateCourse({ ...ok, totalLessons: 100 }).totalLessons).toBeTruthy();
  });
  it('必须选教师', () => expect(validateCourse({ ...ok, teacherId: 0 }).teacherId).toBeTruthy());
});

describe('validateQuota', () => {
  it('阈值 50–95 整数', () => {
    expect(validateQuota({ monthlyLimit: 3000, alertThreshold: 80, overPolicy: 'disable_qa' })).toEqual({});
    expect(validateQuota({ monthlyLimit: 3000, alertThreshold: 40, overPolicy: 'disable_qa' }).alertThreshold).toBeTruthy();
    expect(validateQuota({ monthlyLimit: 0, alertThreshold: 80, overPolicy: 'disable_qa' }).monthlyLimit).toBeTruthy();
  });
});

describe('validateHours', () => {
  it('合法时段通过', () => expect(validateHours('06:00', '22:30')).toEqual({}));
  it('格式与先后关系校验', () => {
    expect(validateHours('6:00', '22:30').start).toBeTruthy();
    expect(validateHours('23:00', '06:00').end).toBeTruthy();
  });
});
