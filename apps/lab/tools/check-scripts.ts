/**
 * 动画课堂剧本质检:schema + 自查算例 + 教学语言禁词。
 * 跑: npm run check:scripts
 */
import { parseLectureScript } from '../src/experiments/dynamic-lecture/script-schema';
import { runReferenceChecks } from '../src/experiments/dynamic-lecture/expr';
import { DEMO_LESSONS } from '../src/experiments/dynamic-lecture/samples';

const JUNIOR_IDS = new Set(['kp-linear-kb', 'math-linear-spring-1']);
const FORBIDDEN_SPEECH = /我来画|接下来添加|让我画|我来添加/;
const JUNIOR_TERMS = /斜率|截距/;

let failed = 0;
const fail = (msg: string) => {
  failed += 1;
  console.error('FAIL', msg);
};

try {
  parseLectureScript({
    schemaVersion: '0.1',
    id: 'too-short',
    kind: 'concept',
    subject: 'math',
    title: '短',
    goal: '结论',
    scene: {
      family: 'coordinate',
      board: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
      params: [{ id: 'a', label: 'a', min: 0, max: 1, step: 0.1, initial: 0 }],
      elements: [],
    },
    steps: [
      { id: 'a', label: '引入', display: 'd', narration: 'n' },
      { id: 'b', label: '展开一', display: 'd', narration: 'n' },
    ],
  });
  fail('少于 5 拍的剧本应当被拒绝');
} catch {
  console.log('ok  短剧本被拒绝');
}

for (const raw of DEMO_LESSONS) {
  let parsed;
  try {
    parsed = parseLectureScript(raw);
  } catch (err) {
    fail(`${raw.id} schema: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  const refs = runReferenceChecks(parsed.reference, parsed.scene.params.map((p) => p.id));
  if (refs.length) fail(`${raw.id} 自查: ${refs.join('; ')}`);
  if (parsed.steps.length < 5) fail(`${raw.id} 不足 5 拍`);
  if (!parsed.steps.some((s) => s.interaction)) fail(`${raw.id} 没有动手拍`);
  for (const st of parsed.steps) {
    if (FORBIDDEN_SPEECH.test(st.narration)) fail(`${raw.id}/${st.id} 讲稿播报动作`);
    if (JUNIOR_IDS.has(raw.id) && JUNIOR_TERMS.test(st.narration + st.display)) {
      fail(`${raw.id}/${st.id} 出现八年级禁用词`);
    }
  }
  const intro = parsed.steps[0];
  if (/y\s*=\s*.*x|f'\s*\(/.test(intro.display) && raw.kind === 'concept') {
    fail(`${raw.id} 引入拍过早出现公式`);
  }
  console.log(`ok  ${raw.id}  ${parsed.kind}  ${parsed.steps.length}拍`);
}

if (failed) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
