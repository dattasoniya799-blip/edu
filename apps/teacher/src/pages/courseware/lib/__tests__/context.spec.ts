/**
 * 向导上下文(?lessonId=&kpNodeId=&job=):解析 / 下发字段 / 自身路径 / 返回编排路径 / 提示文案
 */
import { describe, expect, it } from 'vitest';
import type { WizardContext } from '../context';
import {
  EMPTY_CONTEXT, arrangePath, contextBody, contextHint, parseWizardContext, wizardPath,
} from '../context';

/** 测试用上下文(只写关心的字段) */
const ctx = (patch: Partial<WizardContext> = {}): WizardContext => ({ ...EMPTY_CONTEXT, ...patch });

describe('parseWizardContext', () => {
  it('从编排页进入:两个 id 都解析', () => {
    expect(parseWizardContext('lessonId=4&kpNodeId=102')).toEqual(ctx({ lessonId: 4, kpNodeId: 102 }));
  });

  it('带 ? 前缀 / URLSearchParams 两种入参等价', () => {
    expect(parseWizardContext('?lessonId=4')).toEqual(ctx({ lessonId: 4 }));
    expect(parseWizardContext(new URLSearchParams('lessonId=4'))).toEqual(ctx({ lessonId: 4 }));
  });

  it('从资源库直接进入(无参)→ 空上下文', () => {
    expect(parseWizardContext('')).toEqual(EMPTY_CONTEXT);
  });

  it('脏参数(空串/非数字/0/负数/小数)→ null,不下发脏 id', () => {
    expect(parseWizardContext('lessonId=&kpNodeId=abc')).toEqual(EMPTY_CONTEXT);
    expect(parseWizardContext('lessonId=0&kpNodeId=-3')).toEqual(EMPTY_CONTEXT);
    expect(parseWizardContext('lessonId=1.5')).toEqual(EMPTY_CONTEXT);
  });

  it('?job= 解析为 jobId(契约里是字符串,不做数字校验);空串按无', () => {
    expect(parseWizardContext('job=cw-job-7')).toEqual(ctx({ jobId: 'cw-job-7' }));
    expect(parseWizardContext('lessonId=4&job=cw-job-7'))
      .toEqual(ctx({ lessonId: 4, jobId: 'cw-job-7' }));
    expect(parseWizardContext('job=')).toEqual(EMPTY_CONTEXT);
    expect(parseWizardContext('job=%20%20')).toEqual(EMPTY_CONTEXT);
  });

  it('?step= 解析为 1|2|3(返回键退上一步);越界/脏值 → null 交页面兜底', () => {
    expect(parseWizardContext('step=2')).toEqual(ctx({ step: 2 }));
    expect(parseWizardContext('step=4')).toEqual(EMPTY_CONTEXT);
    expect(parseWizardContext('step=abc')).toEqual(EMPTY_CONTEXT);
  });
});

describe('contextBody', () => {
  it('只带非空字段(避免 lessonId:null 脏字段;jobId 不进报文)', () => {
    expect(contextBody(ctx({ lessonId: 4, kpNodeId: 102 }))).toEqual({ lessonId: 4, kpNodeId: 102 });
    expect(contextBody(ctx({ lessonId: 4 }))).toEqual({ lessonId: 4 });
    expect(contextBody(ctx({ jobId: 'cw-job-7' }))).toEqual({});
    expect(contextBody(EMPTY_CONTEXT)).toEqual({});
  });
});

describe('wizardPath', () => {
  it('把 jobId 写进 ?job= 且保留编排上下文(刷新后能恢复进度)', () => {
    expect(wizardPath(ctx({ lessonId: 4, kpNodeId: 102 }), 'cw-job-7'))
      .toBe('/courseware/new?lessonId=4&kpNodeId=102&job=cw-job-7');
    expect(wizardPath(EMPTY_CONTEXT, 'cw-job-7')).toBe('/courseware/new?job=cw-job-7');
  });

  it('不传 jobId(任务过期后回第 1 步)→ 清掉 ?job=,其余参数不动', () => {
    expect(wizardPath(ctx({ lessonId: 4, jobId: 'cw-job-7' }))).toBe('/courseware/new?lessonId=4');
    expect(wizardPath(EMPTY_CONTEXT)).toBe('/courseware/new');
    expect(wizardPath(EMPTY_CONTEXT, '  ')).toBe('/courseware/new');
  });

  it('步骤进地址栏(?step=),与 job / 编排上下文共存', () => {
    expect(wizardPath(EMPTY_CONTEXT, null, 2)).toBe('/courseware/new?step=2');
    expect(wizardPath(ctx({ lessonId: 4 }), 'cw-job-7', 3))
      .toBe('/courseware/new?lessonId=4&job=cw-job-7&step=3');
  });
});

describe('arrangePath', () => {
  it('有讲次 → 返回编排页路径;无讲次 → null(不显示该按钮)', () => {
    expect(arrangePath(ctx({ lessonId: 4, kpNodeId: 102 }))).toBe('/lessons/4/arrange');
    expect(arrangePath(EMPTY_CONTEXT)).toBeNull();
  });
});

describe('contextHint', () => {
  it('无上下文 → null(不显示提示条)', () => {
    expect(contextHint(EMPTY_CONTEXT)).toBeNull();
  });

  it('拿到知识点名/讲次标题 → 完整提示', () => {
    expect(contextHint(ctx({ lessonId: 4, kpNodeId: 102 }), { kpNodeName: '一次函数的图象', lessonTitle: '第4讲 · 一次函数的图象平移' }))
      .toBe('将结合知识点「一次函数的图象」生成 · 来自《第4讲 · 一次函数的图象平移》的编排');
  });

  it('名称解析失败 → 退化为 id 展示', () => {
    expect(contextHint(ctx({ lessonId: 4, kpNodeId: 102 }))).toBe('将结合知识点 #102 生成 · 来自讲次 #4 的编排');
  });

  it('只有讲次(未选知识点)→ 只提示来源', () => {
    expect(contextHint(ctx({ lessonId: 4 }), { lessonTitle: '第4讲' })).toBe('来自《第4讲》的编排');
  });

  it('只带 ?job= 回来(无编排上下文)→ 不显示提示条', () => {
    expect(contextHint(ctx({ jobId: 'cw-job-7' }))).toBeNull();
  });
});
