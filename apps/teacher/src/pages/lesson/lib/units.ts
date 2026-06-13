/**
 * 知识点单元 ↔ lesson_segments 互转(C2 #5)
 *
 * 编排页模型 = 开场白(lesson.openingConfig)+ 多个「知识点单元」。
 * 每个单元 = 一个 kpNode + 三段固定内容槽:讲解(lecture·挂 resource)/
 * 随堂练(practice·挂 paper)/ 小结巩固(summary·config)。
 *
 * 保存:每单元产出 lecture/practice/summary 三段,带同一 unitSeq 与 kpNodeId,按 seq 顺序提交。
 * 读取:按 unitSeq 分组还原为单元卡(无 unitSeq 的旧环节各自落为独立单元,避免丢数据)。
 * 全部纯函数,vitest 覆盖单元编排往返。
 */
import type { LessonDto, LessonSegmentDto, SegmentType } from '@qiming/contracts';

/** 单元内三段固定槽(顺序固定:讲解→随堂练→小结) */
export const UNIT_SLOT_TYPES = ['lecture', 'practice', 'summary'] as const;
export type UnitSlotType = (typeof UNIT_SLOT_TYPES)[number];

export const UNIT_SLOT_LABEL: Record<UnitSlotType, string> = {
  lecture: '讲解', practice: '随堂练', summary: '小结巩固',
};

export interface UnitSlot {
  /** 已存在段的 id(往返保持稳定) */ id?: number;
  durationMin: number;
  config: Record<string, unknown>;
  resourceId: number | null; // lecture 用
  paperId: number | null;    // practice 用
}

export interface KpUnit {
  unitSeq: number;
  kpNodeId: number | null;
  kpNodeName: string | null;
  lecture: UnitSlot;
  practice: UnitSlot;
  summary: UnitSlot;
}

const SLOT_DEFAULT: Record<UnitSlotType, () => UnitSlot> = {
  lecture: () => ({ durationMin: 30, config: {}, resourceId: null, paperId: null }),
  practice: () => ({ durationMin: 30, config: { ai_guide: true, stuck_alert_min: 3 }, resourceId: null, paperId: null }),
  summary: () => ({ durationMin: 20, config: { personal_consolidation: { min: 2, max: 4 } }, resourceId: null, paperId: null }),
};

export function newUnit(unitSeq: number): KpUnit {
  return {
    unitSeq,
    kpNodeId: null,
    kpNodeName: null,
    lecture: SLOT_DEFAULT.lecture(),
    practice: SLOT_DEFAULT.practice(),
    summary: SLOT_DEFAULT.summary(),
  };
}

/** lesson_segments → 知识点单元(按 unitSeq 分组;旧无 unitSeq 段各自独立成单元) */
export function segmentsToUnits(segments: LessonSegmentDto[]): KpUnit[] {
  const order: number[] = [];
  const map = new Map<number, KpUnit>();
  let autoKey = -1;
  for (const s of segments) {
    if (!UNIT_SLOT_TYPES.includes(s.type as UnitSlotType)) continue; // warmup/homework/break 不入单元模型
    const key = s.unitSeq ?? autoKey--;
    if (!map.has(key)) {
      const u = newUnit(0);
      u.kpNodeId = s.kpNodeId;
      u.kpNodeName = s.kpNodeName;
      map.set(key, u);
      order.push(key);
    }
    const u = map.get(key)!;
    if (u.kpNodeId == null && s.kpNodeId != null) { u.kpNodeId = s.kpNodeId; u.kpNodeName = s.kpNodeName; }
    u[s.type as UnitSlotType] = {
      id: s.id,
      durationMin: s.durationMin,
      config: s.config ?? {},
      resourceId: s.resourceId,
      paperId: s.paperId,
    };
  }
  return order.map((k, i) => ({ ...map.get(k)!, unitSeq: i + 1 }));
}

/** 知识点单元 → lesson_segments(每单元三段;seq 按整页顺序;unitSeq=单元序) */
export function unitsToSegments(units: KpUnit[]): LessonSegmentDto[] {
  const out: LessonSegmentDto[] = [];
  units.forEach((u, ui) => {
    const unitSeq = ui + 1;
    for (const type of UNIT_SLOT_TYPES) {
      const slot = u[type];
      out.push({
        ...(slot.id != null ? { id: slot.id } : {}),
        seq: out.length + 1,
        type: type as SegmentType,
        durationMin: slot.durationMin,
        config: slot.config ?? {},
        resourceId: type === 'lecture' ? slot.resourceId : null,
        paperId: type === 'practice' ? slot.paperId : null,
        kpNodeId: u.kpNodeId,
        kpNodeName: u.kpNodeName,
        unitSeq,
      });
    }
  });
  return out;
}

/** 单元软提示(建议齐全;缺则提示不强制) */
export function unitWarnings(u: KpUnit): string[] {
  const w: string[] = [];
  if (u.kpNodeId == null) w.push('未选择知识点');
  if (u.lecture.resourceId == null) w.push('讲解未挂课件');
  if (u.practice.paperId == null) w.push('随堂练未挂题目/卷');
  return w;
}

// ---------- 开场白(lesson.openingConfig)----------
export interface OpeningConfig {
  enabled: boolean;
  text: string;
  resourceId: number | null;
}

export function openingFromLesson(lesson: Pick<LessonDto, 'openingConfig'>): OpeningConfig {
  const c = (lesson.openingConfig ?? {}) as Record<string, unknown>;
  return {
    enabled: c.enabled === true || typeof c.text === 'string' || c.resourceId != null,
    text: typeof c.text === 'string' ? c.text : '',
    resourceId: typeof c.resourceId === 'number' ? c.resourceId : null,
  };
}

/** 开场白 → openingConfig(未启用 → null,清空挂载) */
export function openingToConfig(o: OpeningConfig): Record<string, unknown> | null {
  if (!o.enabled) return null;
  return { enabled: true, text: o.text, resourceId: o.resourceId };
}

/** 单元列表总时长(分钟) */
export function unitsDuration(units: KpUnit[]): number {
  return units.reduce(
    (sum, u) => sum + u.lecture.durationMin + u.practice.durationMin + u.summary.durationMin,
    0,
  );
}
