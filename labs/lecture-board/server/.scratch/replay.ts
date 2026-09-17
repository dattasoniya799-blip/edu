import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { animationUsage } from '../src/board-discipline'
import { ANIMATION_TEMPLATES } from '../src/templates'
import { extractJson, normalizeBoardScript } from '../src/validate'

const root = 'data/lessons'
for (const dir of readdirSync(root).sort()) {
  const log = join(root, dir, 'log.ndjson')
  let planning: string | undefined
  let answer = ''
  let problemText = ''
  try {
    for (const line of readFileSync(log, 'utf8').trim().split('\n')) {
      const rec = JSON.parse(line)
      if (rec.kind === 'planning') planning = rec.response
    }
    const st = JSON.parse(readFileSync(join(root, dir, 'state.json'), 'utf8'))
    answer = st.input.answer
    problemText = st.keypoints?.source?.problemText ?? ''
  } catch { continue }
  if (!planning) continue
  let parsed: unknown
  try { parsed = extractJson(planning) } catch { console.log(`${dir}: 草稿不是 JSON,跳过`); continue }
  const r = normalizeBoardScript(parsed, { problemText, answerText: answer, templates: ANIMATION_TEMPLATES })
  const fixes = r.warnings.filter((w) => w.startsWith('已自动修正'))
  console.log(`\n=== ${dir} ===`)
  console.log(`errors ${r.errors.length} / warnings ${r.warnings.length}(自动修正 ${fixes.length})`)
  for (const e of r.errors) console.log(`  [E] ${e}`)
  for (const f of fixes) console.log(`  [FIX] ${f.replace(/^已自动修正 · /, '')}`)
  for (const w of r.warnings.filter((x) => !x.startsWith('已自动修正'))) console.log(`  [W] ${w}`)
  for (const u of animationUsage(r.script)) {
    console.log(`  usage ${u.id}(${u.kind}) 卡=${u.cardId ?? '无'} 驱动=${u.actions}[${u.actionNames.join(',')}] 指向画面say=${u.screenSays}`)
  }
}
