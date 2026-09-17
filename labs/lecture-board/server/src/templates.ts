/**
 * 动画模板目录:直接读 lecture-scene 的 manifest(复制自
 * ohmyppt-lecture/resources/lecture-scene/templates/manifest.json,见 src/data/templates-manifest.json)。
 *
 * 校验 template 动画的 params / action 一律以 manifest 为准:
 *  - 参数范围从参数说明里的「a..b」直接解析出来,不另维护一张表(表和 manifest 会走散);
 *  - run 的合法相位从 action 说明里的 phase:'x'|'y' 解析出来;
 *  - board-steps 是「整块白板」而不是一张动画卡,v2 里白板本身就是列 + 卡,所以它不进动画模板目录
 *    (见 shared/ISSUES.md 第 1 条)。
 */
import manifest from './data/templates-manifest.json' with { type: 'json' }

export interface BoardTemplateInfo {
  id: string
  name: string
  subject: string
  fits: string[]
  params: Record<string, string>
  /** 从参数说明里解析出的数值范围;非数值参数(如 linear-shift.points)不在表里 */
  paramRanges: Record<string, [number, number]>
  targets: Record<string, string>
  actions: Record<string, string>
  /** run 动作的合法相位(该模板没有 run 就是空数组) */
  runPhases: string[]
  handles: Record<string, string>
  anchors: Record<string, string>
}

/** 白板里「整块板书」的模板 id;v2 不把它当动画卡 */
export const BOARD_STEPS_TEMPLATE_ID = 'board-steps'

interface RawTemplate {
  id: string
  name: string
  subject: string
  fits?: string[]
  params?: Record<string, string>
  targets?: Record<string, string>
  actions?: Record<string, string>
  handles?: Record<string, string>
  anchors?: Record<string, string>
}

function parseRange(description: string): [number, number] | null {
  const m = description.match(/(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const lo = Number(m[1])
  const hi = Number(m[2])
  return Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi ? [lo, hi] : null
}

function parsePhases(actions: Record<string, string>): string[] {
  const run = actions.run
  if (!run) return []
  const m = run.match(/phase:\s*((?:'[a-zA-Z]+'\s*\|\s*)*'[a-zA-Z]+')/)
  if (!m) return []
  return (m[1].match(/'([a-zA-Z]+)'/g) ?? []).map((q) => q.slice(1, -1))
}

function toInfo(raw: RawTemplate): BoardTemplateInfo {
  const params = raw.params ?? {}
  const paramRanges: Record<string, [number, number]> = {}
  for (const [key, desc] of Object.entries(params)) {
    const range = parseRange(String(desc))
    if (range) paramRanges[key] = range
  }
  const actions = raw.actions ?? {}
  return {
    id: raw.id,
    name: raw.name,
    subject: raw.subject,
    fits: raw.fits ?? [],
    params,
    paramRanges,
    targets: raw.targets ?? {},
    actions,
    runPhases: parsePhases(actions),
    handles: raw.handles ?? {},
    anchors: raw.anchors ?? {}
  }
}

const ALL: BoardTemplateInfo[] = (manifest as unknown as { templates: RawTemplate[] }).templates.map(toInfo)

/** 六个交互动画模板(不含 board-steps) */
export const ANIMATION_TEMPLATES: BoardTemplateInfo[] = ALL.filter((t) => t.id !== BOARD_STEPS_TEMPLATE_ID)

/** manifest 全量(识题时给模型看的目录,含 board-steps 以便它说「这题没有现成场景」) */
export const ALL_TEMPLATES: BoardTemplateInfo[] = ALL

export function findTemplate(id: string): BoardTemplateInfo | undefined {
  return ANIMATION_TEMPLATES.find((t) => t.id === id)
}

/**
 * 每个模板的「底图层」:动画卡一挂上去就该看见的那几层(坐标系 / 圆 / 三角形 / 水槽 / 模型…)。
 * 剧本只发 `run` / `highlight` 而不先 `show` 底图,卡片就是一片空白(2026-09-17 web 侧实测:
 * 浮力题零 show、圆题只 show 了 segBE)。校验器按这张表在首个动作前自动补 `show`。
 *
 * 取的是 manifest 里 targets 的前两项 —— manifest 本来就是「场景在前、标注在后」的顺序;
 * 下面的 assert 保证这张表永远跟得上 manifest,改了 manifest 而没改这里会在启动时就炸。
 */
const BASE_LAYERS: Record<string, string[]> = {
  'quadratic-line': ['axes', 'parabola'],
  'linear-shift': ['axes', 'line'],
  'cart-collision': ['track', 'carts'],
  buoyancy: ['tank', 'model'],
  'circle-angle': ['circle', 'triangle'],
  'parallelogram-angle': ['para', 'diagBD']
}

for (const tpl of ANIMATION_TEMPLATES) {
  const layers = BASE_LAYERS[tpl.id]
  if (!layers) throw new Error(`templates.ts:模板 ${tpl.id} 没有登记底图层(BASE_LAYERS)`)
  for (const layer of layers) {
    if (!(layer in tpl.targets)) throw new Error(`templates.ts:模板 ${tpl.id} 的底图层 ${layer} 不在 manifest 的 targets 里`)
  }
}

/** 该模板的底图层;不是六模板之一(html / static)返回空数组 */
export function baseLayersOf(templateId: string | undefined): string[] {
  return templateId ? (BASE_LAYERS[templateId] ?? []) : []
}
