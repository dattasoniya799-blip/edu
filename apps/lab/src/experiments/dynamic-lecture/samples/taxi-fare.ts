import type { LectureScriptInput } from '../script-schema';

/**
 * 中考一次函数应用 · 出租车计费(分段:先平后涨)。
 * 题型出处:各地中考高频原题(起步价含 3 km,超出按 2 元/km)。
 * 连续模型 y = max(10, 2x+4),课堂不处理「不足 1 km 按 1 km」的取整。
 */
export const taxiFare: LectureScriptInput = {
  schemaVersion: '0.1',
  id: 'math-taxi-fare-1',
  kind: 'problem',
  subject: 'math',
  grade: '八年级下',
  title: '出租车计费(分段一次函数)',
  goal: '3 千米以内车费钉在起步价;超过以后每多 1 千米加 2 元。已知车费求路程,要先判断有没有超过起步段。',
  problem: {
    text:
      '某地出租车收费标准:起步价 $10$ 元(行驶不超过 $3$ 千米,含 $3$ 千米,都付 $10$ 元);' +
      '超过 $3$ 千米以后,每增加 $1$ 千米加价 $2$ 元。设行驶路程为 $x$ 千米,车费为 $y$ 元。\n' +
      '(1)写出 $y$ 与 $x$ 的函数关系式;\n' +
      '(2)行驶 $8$ 千米应付多少元?\n' +
      '(3)某乘客付了 $24$ 元,他大约走了多少千米?',
    source: '中考一次函数应用典型题(出租车计费)',
  },
  difficultIdea:
    '图象不是一条斜线到底:先有一段水平(起步价不变),过 3 千米才开始按 2 元/千米往上走。',
  misconceptions: [
    '一上来就写成 y=2x+10,忘了前 3 千米已经含在起步价里,会多算 6 元',
    '已知 24 元求路程时,把 24 当成 x 代进去',
    '以为起步价 10 元对应的是 x=0 的瞬间,不理解 0 到 3 千米整段都是 10 元',
  ],
  scene: {
    family: 'coordinate',
    board: { xMin: -0.8, xMax: 13, yMin: -2, yMax: 30, xLabel: 'x/km', yLabel: 'y/元', grid: true },
    params: [{ id: 'd', label: '行驶路程', min: 0, max: 11, step: 0.5, initial: 1.5, unit: 'km' }],
    elements: [
      { kind: 'functiongraph', id: 'fareFlat', expr: '10', domain: [0, 3], color: 'primary', hidden: true },
      { kind: 'functiongraph', id: 'fareRise', expr: '2*x + 4', domain: [3, 12], color: 'primary', hidden: true },
      { kind: 'point', id: 'p0', x: 0, y: 10, label: '(0, 10)', color: 'green', hidden: true },
      { kind: 'text', id: 'startt', x: 0.3, y: 12.2, text: '起步价 10 元', color: 'green', hidden: true },
      { kind: 'point', id: 'kink', x: 3, y: 10, label: '(3, 10)', color: 'orange', hidden: true },
      { kind: 'segment', id: 'v3', from: [3, 0], to: [3, 10], dash: true, color: 'muted', hidden: true },
      { kind: 'ladder', id: 'ladder', expr: 'max(10, 2*x + 4)', atParam: 'd', dx: 1, color: 'violet', hidden: true },
      { kind: 'text', id: 'eq', x: 4.2, y: 27.5, text: 'x≤3: y=10;  x>3: y=2x+4', color: 'primary', hidden: true },
      { kind: 'point', id: 'pd', x: 'd', y: 'max(10, 2*d + 4)', label: '({d:1} km, {max(10, 2*d + 4):0} 元)', color: 'orange', hidden: true },
      { kind: 'segment', id: 'guideV', from: ['d', 0], to: ['d', 'max(10, 2*d + 4)'], dash: true, hidden: true },
      { kind: 'point', id: 'p24', x: 10, y: 24, label: '(10, 24)', color: 'red', hidden: true },
      { kind: 'segment', id: 'h24', from: [0, 24], to: [10, 24], dash: true, color: 'red', hidden: true },
    ],
  },
  steps: [
    {
      id: 's1',
      label: '读题',
      display:
        '先圈两个规定:**起步价 10 元**,范围是「不超过 3 千米」。也就是说,从刚上车到走满 3 千米,车费一直是 10 元,图上是一段水平的。',
      narration:
        '先看收费规定。起步价十元,范围是不超过三千米。意思是,从刚上车到走满三千米,车费一直是十元,不会因为多走了一百米就加钱。图上这一点,就是刚上车时付的十元。',
      sceneActions: [
        { op: 'show', target: 'p0' },
        { op: 'show', target: 'startt' },
        { op: 'highlight', target: 'p0' },
      ],
    },
    {
      id: 's2',
      label: '起步段',
      display:
        '把 0 到 3 千米连起来:这一段 $y$ 始终等于 10。拐点 $(3,10)$ 既是起步段的终点,也是开始加价的起点。',
      narration:
        '把零到三千米连成一段。这一段高度始终是十,走了两千米还是十元,走满三千米还是十元。拐弯的那个点,横坐标是三,纵坐标是十。过了它,才开始加钱。',
      sceneActions: [
        { op: 'show', target: 'fareFlat' },
        { op: 'show', target: 'kink' },
        { op: 'show', target: 'v3' },
        { op: 'highlight', target: 'kink' },
        { op: 'setParam', param: 'd', value: 3 },
      ],
    },
    {
      id: 's3',
      label: '加价段',
      display:
        '超过 3 千米以后,每多 $1$ 千米加 $2$ 元。台阶读的就是这一格的抬升。注意:加价是加在起步价之上,不是从零开始按 $2x$ 算。',
      narration:
        '过了三千米,每多一千米加两元。台阶上这一格,就是一千米带来的两元。千万别从零开始按两千米乘二去算,那样会把前三千米已经付过的十元再算一遍。',
      sceneActions: [
        { op: 'show', target: 'fareFlat' },
        { op: 'show', target: 'fareRise' },
        { op: 'show', target: 'ladder' },
        { op: 'highlight', target: 'ladder' },
        { op: 'sweepParam', param: 'd', from: 3, to: 8, seconds: 5 },
      ],
    },
    {
      id: 's4',
      label: '动手试',
      display:
        '自己拖路程。3 千米以内读数钉在 10 元;超过 3 千米,读数才往上走。看清楚「哪一段在变、哪一段没变」。',
      narration:
        '滑杆交给你。把路程拖到三千米以内,看车费动不动;再拖过三,看它怎么往上走。盯住那条折线:先平,后斜,中间在三千米那里拐了一下。',
      sceneActions: [
        { op: 'show', target: 'pd' },
        { op: 'show', target: 'guideV' },
        { op: 'show', target: 'kink' },
        { op: 'hide', target: 'startt' },
      ],
      interaction: {
        paramId: 'd',
        prompt: '拖路程,看车费什么时候开始涨',
        targetValue: 8,
        feedback:
          '走 {d:1} km,应付 {max(10, 2*d + 4):0} 元。{d:1} 不超过 3 时钉在 10;超过 3 以后,每多 1 km 加 2 元。',
      },
      scaffolds: [
        '先把滑杆停在 2,再停在 3,看两个读数是不是一样。',
        '再拖到 5:比 3 千米多了 2 千米,应多付 4 元,总共 14 元。',
        '超过部分的算法:10 + 2×(路程−3)。',
      ],
    },
    {
      id: 's5',
      label: '结论',
      display:
        '分段写下来:$$y=\\begin{cases}10,&0\\le x\\le 3\\\\2x+4,&x>3\\end{cases}$$ 第(2)问:$x=8>3$,$y=2\\times 8+4=20$(元)。',
      narration:
        '现在写成两段。路程不超过三,车费就是十;超过三,车费等于二乘 x 加四。第二问走八千米,已经过了起步段,代入后一段:二乘八加四,得二十元。',
      sceneActions: [
        { op: 'show', target: 'eq' },
        { op: 'setParam', param: 'd', value: 8 },
        { op: 'show', target: 'pd' },
        { op: 'highlight', target: 'eq' },
      ],
    },
    {
      id: 's6',
      label: '反问',
      display:
        '第(3)问已知 $y=24$。$24>10$,说明已经超过起步段。解 $2x+4=24$,得 $x=10$。图上红线与折线交在 $(10,24)$。',
      narration:
        '第三问反过来:付了二十四元,走了多远。二十四比十块大,一定超过了三千米。用后一段列方程,二 x 加四等于二十四,解得 x 等于十。红色虚线和折线的交点,横坐标正好是十。',
      sceneActions: [
        { op: 'hide', target: 'ladder' },
        { op: 'show', target: 'h24' },
        { op: 'show', target: 'p24' },
        { op: 'hide', target: 'pd' },
        { op: 'highlight', target: 'p24' },
        { op: 'setParam', param: 'd', value: 10 },
      ],
      quiz: {
        question: '付 14 元时,大约走了多少千米?',
        options: ['7 km', '5 km', '4 km'],
        answerIndex: 1,
        reveal:
          '14>10,走后一段:$2x+4=14$,$x=5$。选 7 的是把 14 当成了 x;选 4 的只算了超过部分 $4=2\\times 2$,忘了加回起步的 3 千米。',
      },
    },
  ],
  reference: [
    { desc: 'x=0 时为起步价 10', expr: 'max(10, 2*x + 4)', params: { x: 0 }, expected: 10, tol: 1e-9 },
    { desc: 'x=3 时仍为 10', expr: 'max(10, 2*x + 4)', params: { x: 3 }, expected: 10, tol: 1e-9 },
    { desc: 'x=8 时应为 20', expr: 'max(10, 2*x + 4)', params: { x: 8 }, expected: 20, tol: 1e-9 },
    { desc: 'y=24 时 x 应为 10', expr: '(24 - 4) / 2', params: {}, expected: 10, tol: 1e-9 },
    { desc: 'y=14 时 x 应为 5', expr: '(14 - 4) / 2', params: {}, expected: 5, tol: 1e-9 },
  ],
};
