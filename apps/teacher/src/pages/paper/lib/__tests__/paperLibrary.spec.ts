import { describe, expect, it } from 'vitest';
import type { PaperDto } from '@qiming/contracts';
import {
  PAPER_TABS,
  PAPER_TYPE_LABEL,
  countByType,
  filterPapers,
  paperStatusLabel,
} from '../paperLibrary';

const mk = (id: number, name: string, type: PaperDto['type'], status = 'published'): PaperDto => ({
  id, name, type, totalScore: 30, status, questions: [],
});

const papers: PaperDto[] = [
  mk(1, '第4讲 · 随堂练', 'practice'),
  mk(2, '第3讲课后作业 · 待定系数法', 'homework'),
  mk(3, '期中考试卷 · 一次函数综合', 'exam'),
  mk(4, '第5讲课后作业(草稿)', 'homework', 'draft'),
];

describe('PAPER_TYPE_LABEL(中文口径)', () => {
  it('practice=随堂练 / homework=课后作业 / exam=考试', () => {
    expect(PAPER_TYPE_LABEL.practice).toBe('随堂练');
    expect(PAPER_TYPE_LABEL.homework).toBe('课后作业');
    expect(PAPER_TYPE_LABEL.exam).toBe('考试');
  });
  it('页签首项为「全部」,其后三类齐全', () => {
    expect(PAPER_TABS.map((t) => t.key)).toEqual(['all', 'practice', 'homework', 'exam']);
  });
});

describe('filterPapers(按 type 筛选)', () => {
  it('all → 全部', () => {
    expect(filterPapers(papers, 'all', '').map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });
  it('practice → 仅随堂练', () => {
    expect(filterPapers(papers, 'practice', '').map((p) => p.id)).toEqual([1]);
  });
  it('homework → 仅课后作业(含草稿)', () => {
    expect(filterPapers(papers, 'homework', '').map((p) => p.id)).toEqual([2, 4]);
  });
  it('exam → 仅考试', () => {
    expect(filterPapers(papers, 'exam', '').map((p) => p.id)).toEqual([3]);
  });
});

describe('filterPapers(按试卷名搜索)', () => {
  it('关键词匹配名称,忽略首尾空白', () => {
    expect(filterPapers(papers, 'all', ' 考试 ').map((p) => p.id)).toEqual([3]);
  });
  it('大小写不敏感', () => {
    const withEn = [...papers, mk(5, 'Unit Test Paper', 'exam')];
    expect(filterPapers(withEn, 'all', 'unit').map((p) => p.id)).toEqual([5]);
  });
  it('type + 关键词联合过滤', () => {
    expect(filterPapers(papers, 'homework', '草稿').map((p) => p.id)).toEqual([4]);
  });
  it('无命中 → 空态([])', () => {
    expect(filterPapers(papers, 'all', '不存在的卷名')).toEqual([]);
    expect(filterPapers(papers, 'exam', '随堂练')).toEqual([]);
  });
});

describe('countByType(页签角标)', () => {
  it('all=总数,各类分别计数', () => {
    expect(countByType(papers)).toEqual({ all: 4, practice: 1, homework: 2, exam: 1 });
  });
  it('空列表全 0', () => {
    expect(countByType([])).toEqual({ all: 0, practice: 0, homework: 0, exam: 0 });
  });
});

describe('paperStatusLabel(状态文案)', () => {
  it('published=已发布,其余=草稿', () => {
    expect(paperStatusLabel('published')).toBe('已发布');
    expect(paperStatusLabel('draft')).toBe('草稿');
  });
});
