/**
 * 录题表单校验(口径同 A3 后端:rubric 解答题必填、tagNodeIds 至少 1 个教材知识点)
 * 保存草稿 = 基础校验;提交入库 = 全量校验
 */
import type { QuestionForm } from './transform';

export interface FieldError { field: string; message: string }

export function validateQuestion(f: QuestionForm, mode: 'draft' | 'publish'): FieldError[] {
  const errors: FieldError[] = [];
  if (!f.stemLatex.trim()) errors.push({ field: 'stemLatex', message: '题干不能为空' });
  if (!f.stage) errors.push({ field: 'stage', message: '请选择学段' });
  if (!f.subject) errors.push({ field: 'subject', message: '请选择学科' });
  if (mode === 'draft') return errors;

  if (!Number.isInteger(f.difficulty) || f.difficulty < 1 || f.difficulty > 3)
    errors.push({ field: 'difficulty', message: '难度必须为 1–3' });

  // 三维标注:至少 1 个教材知识点(A3 同口径,前端先拦)
  if (!f.tags.some((t) => t.graphType === 'curriculum_knowledge'))
    errors.push({ field: 'tags', message: '至少选择 1 个教材知识点(用于学情归因)' });

  if (f.type === 'single' || f.type === 'multi') {
    const filled = f.options.filter((o) => o.contentLatex.trim() !== '');
    if (filled.length < 2) errors.push({ field: 'options', message: '至少填写 2 个选项' });
    const correct = filled.filter((o) => o.isCorrect).length;
    if (f.type === 'single' && correct !== 1)
      errors.push({ field: 'options', message: '单选题必须恰好设置 1 个正确答案' });
    if (f.type === 'multi' && correct < 2)
      errors.push({ field: 'options', message: '多选题至少设置 2 个正确答案' });
    if (f.options.some((o) => o.isCorrect && o.contentLatex.trim() === ''))
      errors.push({ field: 'options', message: '正确答案对应的选项内容不能为空' });
  }

  if (f.type === 'blank' && !f.blankAnswers.some((t) => t.trim() !== ''))
    errors.push({ field: 'answer', message: '填空题至少填写 1 个参考答案' });

  if (f.type === 'solution') {
    if (!f.referenceLatex.trim())
      errors.push({ field: 'answer', message: '解答题必须填写参考答案' });
    if (f.rubric.length === 0)
      errors.push({ field: 'rubric', message: '解答题必须至少有 1 条评分要点(AI 预批依据)' });
    f.rubric.forEach((r, i) => {
      if (!r.desc.trim()) errors.push({ field: 'rubric', message: `评分要点第 ${i + 1} 行:描述不能为空` });
      if (!(r.score > 0)) errors.push({ field: 'rubric', message: `评分要点第 ${i + 1} 行:分值必须大于 0` });
    });
  }
  return errors;
}
