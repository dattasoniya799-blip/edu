/**
 * 组卷选题的题库拉取纯逻辑(vitest 覆盖)。
 *
 * 背景:此前组卷两页只 GET /questions?page=1&size=50,题库已 143+ 题时其余题选不到。
 * 参照 paperLibrary.collectPaperPages 范式,按后端单页上限 50 分页把 published 题拉齐,
 * 客户端搜索(QuestionPicker 内)即可覆盖全部已入库题。留页数上限防题库异常膨胀时无限翻页。
 */
import type { QuestionDto } from '@qiming/contracts';

/** GET /questions 单页 size(与后端 size 上限一致);组卷选题按此分页拉齐。 */
export const QUESTION_PICKER_PAGE_SIZE = 50;

/** 拉齐页数上限:20 页 = 1000 题;触及即截断并提示,避免无限翻页。 */
export const QUESTION_PICKER_MAX_PAGES = 20;

type QuestionPage = { items: QuestionDto[]; total: number };

export interface CollectedQuestions {
  questions: QuestionDto[];
  /** 因触及页数上限而未拉全(题库超过 MAX_PAGES × PAGE_SIZE 题)→ 需提示教师用搜索缩小范围 */
  truncated: boolean;
}

/**
 * 按 50/页拉齐 published 题(fetchPage 由调用方注入,通常是 GET /questions?status=published)。
 * 直到累计条数达到后端 total、或遇空页、或触及页数上限为止。
 *
 * subject / tagNodeId 透传给 fetchPage(→ 服务端 GET /questions?subject=&tagNodeId=,
 * 按学科 + 知识点精确过滤),只拉命中的题以减少翻页量;
 * 空串/未传 = 不过滤(与后端 `q.subject ? ...` 同口径)。
 */
export async function collectQuestionPages(
  fetchPage: (page: number, size: number, subject?: string, tagNodeId?: number) => Promise<QuestionPage>,
  subject?: string,
  tagNodeId?: number,
): Promise<CollectedQuestions> {
  const all: QuestionDto[] = [];
  let total = Number.POSITIVE_INFINITY;
  let page = 1;

  while (all.length < total && page <= QUESTION_PICKER_MAX_PAGES) {
    const r = await fetchPage(page, QUESTION_PICKER_PAGE_SIZE, subject, tagNodeId);
    all.push(...r.items);
    total = r.total;
    if (r.items.length === 0) break;
    page += 1;
  }

  return { questions: all, truncated: all.length < total };
}

/**
 * 讲次组卷(PaperBuilderPage)默认预选学科:取该讲次所属课程的 subject。
 * 课程列表来自 GET /teacher/courses;找不到对应课程(异常情况)则返回空串 = 全部学科。
 */
export function resolveDefaultSubject(
  courses: { id: number; subject: string }[],
  courseId: number,
): string {
  return courses.find((c) => c.id === courseId)?.subject ?? '';
}
