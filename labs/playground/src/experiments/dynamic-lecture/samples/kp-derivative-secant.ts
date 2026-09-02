import type { LectureScriptInput } from '../script-schema';

/**
 * 知识点课 · 导数的几何意义。
 * 曲线 y = 0.25 x² + 1,在 x0 处 f'(x0) = 0.5 x0;默认 x0=2,导数为 1。
 */
export const kpDerivativeSecant: LectureScriptInput = {
  schemaVersion: '0.1',
  id: 'kp-derivative-secant',
  kind: 'concept',
  subject: 'math',
  grade: '高一',
  title: '导数:割线怎样躺到切线上',
  goal: 'Δx 越小,割线越贴曲线;它的极限位置就是切线,极限斜率就是该点的导数。',
  difficultIdea: '导数不是套公式的结果,而是平均变化率在 Δx 趋于 0 时的极限;Δx 不能真取 0。',
  misconceptions: [
    '以为导数只是求导公式算出来的一个数',
    '以为 Δx 必须等于 0 才叫切线',
  ],
  scene: {
    family: 'coordinate',
    board: { xMin: -0.5, xMax: 6.2, yMin: -0.5, yMax: 6.2, xLabel: 'x', yLabel: 'y', grid: true, keepAspect: true },
    params: [
      { id: 'x0', label: '切点横坐标', min: 2, max: 2, step: 0.1, initial: 2 },
      { id: 'dx', label: 'Δx', min: 0.08, max: 2.4, step: 0.02, initial: 1.8 },
    ],
    elements: [
      { kind: 'functiongraph', id: 'curve', expr: '0.25*x*x + 1', color: 'primary', hidden: true },
      { kind: 'point', id: 'p', x: 'x0', y: '0.25*x0*x0 + 1', label: 'P', color: 'green', hidden: true },
      { kind: 'point', id: 'q', x: 'x0+dx', y: '0.25*(x0+dx)*(x0+dx)+1', label: 'Q', color: 'orange', hidden: true },
      {
        kind: 'segment',
        id: 'secant',
        from: ['x0', '0.25*x0*x0 + 1'],
        to: ['x0+dx', '0.25*(x0+dx)*(x0+dx)+1'],
        color: 'orange',
        hidden: true,
      },
      {
        kind: 'segment',
        id: 'tangent',
        from: ['x0-1.6', '(0.25*x0*x0 + 1) - 1.6*(0.5*x0)'],
        to: ['x0+1.6', '(0.25*x0*x0 + 1) + 1.6*(0.5*x0)'],
        color: 'violet',
        hidden: true,
      },
      {
        kind: 'text',
        id: 'slope',
        x: 0.2,
        y: 5.7,
        text: '割线斜率 {((0.25*(x0+dx)*(x0+dx)+1)-(0.25*x0*x0+1))/dx:2}',
        color: 'orange',
        hidden: true,
      },
      {
        kind: 'text',
        id: 'fp',
        x: 0.2,
        y: 5.15,
        text: "f'(2) = 1.00(切线斜率)",
        color: 'violet',
        hidden: true,
      },
    ],
  },
  steps: [
    {
      id: 's1',
      label: '引入',
      display:
        '曲线上先钉一个点 P。我们要问的不是「P 在哪」,而是「在 P 附近,曲线往哪边走、走得多快」。',
      narration:
        '先看这条曲线,钉一个点 P。这节课不问 P 在哪,问的是在 P 的附近,曲线往哪边走、走得多快。这个快慢,就是待会要说的导数。',
      sceneActions: [
        { op: 'show', target: 'curve' },
        { op: 'show', target: 'p' },
        { op: 'highlight', target: 'p' },
      ],
    },
    {
      id: 's2',
      label: '割线',
      display:
        '在 P 右边再取一点 Q,连 PQ,得到**割线**。割线斜率是这一段的平均变化率:Δy 除以 Δx。现在 Δx 还很大,割线离曲线比较远。',
      narration:
        '在 P 的右边再取一个点 Q,把它们连起来,这条线叫割线。割线的斜率,就是这一段里 y 变了多少除以 x 变了多少,也就是平均变化率。现在两点离得远,割线还贴不紧曲线。',
      sceneActions: [
        { op: 'show', target: 'curve' },
        { op: 'show', target: 'p' },
        { op: 'show', target: 'q' },
        { op: 'show', target: 'secant' },
        { op: 'show', target: 'slope' },
        { op: 'highlight', target: 'secant' },
        { op: 'setParam', param: 'dx', value: 1.8 },
      ],
    },
    {
      id: 's3',
      label: '逼近',
      display:
        '把 Δx 缩小,Q 沿曲线滑向 P,割线慢慢躺平。盯住斜率那个数,看它往哪里走。',
      narration:
        '现在把两点的水平距离缩小。Q 会沿着曲线滑向 P,割线慢慢躺下来。盯住斜率那个数,看它往哪个值靠近。还不要说切线,先让眼睛跟上这个过程。',
      sceneActions: [
        { op: 'show', target: 'q' },
        { op: 'show', target: 'secant' },
        { op: 'show', target: 'slope' },
        { op: 'highlight', target: 'q' },
        { op: 'sweepParam', param: 'dx', from: 1.8, to: 0.25, seconds: 6 },
      ],
    },
    {
      id: 's4',
      label: '动手试',
      display:
        '自己拖 Δx。Δx 越小,割线越贴曲线。记住:不要拖到 0——两点重合就没有割线了。',
      narration:
        '滑杆交给你。把 Δx 拖小,看割线怎么贴上去;再拖大,看它怎么离开。有一个界限:Δx 不能等于零,等于零的时候 Q 和 P 重合,连割线都画不出来。',
      sceneActions: [
        { op: 'show', target: 'q' },
        { op: 'show', target: 'secant' },
        { op: 'show', target: 'slope' },
      ],
      interaction: {
        paramId: 'dx',
        prompt: '拖 Δx,看割线怎样贴向 P',
        targetValue: 0.12,
        feedback:
          'Δx = {dx:2},割线斜率 {((0.25*(x0+dx)*(x0+dx)+1)-(0.25*x0*x0+1))/dx:2}。P 一直钉在原地,变的是 Q 和这条割线。',
      },
      scaffolds: [
        '把滑杆往左拖,Q 会靠近 P。',
        '斜率那个数会越来越接近一个定值。',
        '那个定值就是待会要出现的切线斜率。',
      ],
    },
    {
      id: 's5',
      label: '切线',
      display:
        '紫色这条是 P 处的**切线**。割线的极限位置就是它;极限斜率 $$f\'(2)=1$$ 就是该点的导数。导数是「平均变化率的极限」,不是把 Δx 代入 0。',
      narration:
        '紫色这条,是 P 这一点的切线。割线越贴越紧,最后躺到的位置就是它。切线的斜率是一,这就是这一点的导数。注意:导数是平均变化率的极限,不是把 Δx 换成零去算。零的时候割线已经不存在了。',
      sceneActions: [
        { op: 'show', target: 'tangent' },
        { op: 'show', target: 'fp' },
        { op: 'show', target: 'secant' },
        { op: 'highlight', target: 'tangent' },
        { op: 'setParam', param: 'dx', value: 0.2 },
      ],
    },
    {
      id: 's6',
      label: '收尾',
      display:
        '再看一遍:Δx 由大变小,割线躺向切线,斜率走向 1。本课不讲求导法则,只建立「极限位置」这一个画面。',
      narration:
        '最后再看一遍。Δx 从大到小,割线一点点躺到切线上,斜率走向一。这节课不讲怎么求导,只把这个画面留下来:导数就是割线躺平之后的那个斜率。',
      sceneActions: [
        { op: 'show', target: 'tangent' },
        { op: 'show', target: 'fp' },
        { op: 'sweepParam', param: 'dx', from: 2.0, to: 0.1, seconds: 7 },
      ],
    },
  ],
  reference: [
    { desc: 'x=2 时曲线高度应为 2', expr: '0.25*x*x + 1', params: { x: 2 }, expected: 2, tol: 1e-9 },
    { desc: 'x0=2 时切线斜率应为 1', expr: '0.5*x0', params: { x0: 2 }, expected: 1, tol: 1e-9 },
    {
      desc: 'Δx=0.1 时割线斜率应接近 1.025',
      expr: '((0.25*(2+0.1)*(2+0.1)+1)-(0.25*2*2+1))/0.1',
      params: {},
      expected: 1.025,
      tol: 1e-9,
    },
  ],
};
