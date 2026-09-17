/**
 * 动画 purpose 展示前的净化(README「已知待改」2:动画卡上展示了 purpose 里的动作名列表)。
 *
 * server 校验器(shared 契约冻结前生成的存量剧本)与提示词都已经改了,新剧本的 purpose 应该只是
 * 给学生看的一句话。但 `server/data/lessons` 下 20+ 个已经真跑出来的课,purpose 字段已经把
 * 「动作名:rotate(...), showPerp(...)」这类实现细节写死存进 state.json 了,没法回头重新调模型改写
 * (真接口调用花钱,任务也不允许删样本课)。所以 web 端渲染时兜底做一遍同样的截断,与
 * `server/src/validate.ts` 的 `sanitizePurpose` 逐字对齐,两侧口径一致。
 */

const PURPOSE_ACTION_LEAK = /(动作名|动作包括|参数)[:：]?/;

/** 只保留「动作名/动作包括/参数」之前的那句话给学生看;没有这些词就原样返回 */
export function sanitizePurpose(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  const m = s.match(PURPOSE_ACTION_LEAK);
  if (!m || m.index == null) return s;
  const cut = s.slice(0, m.index).replace(/[，,。;;::、\s]+$/, '').trim();
  return cut || s.slice(0, 40);
}
