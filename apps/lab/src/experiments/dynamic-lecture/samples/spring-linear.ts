/**
 * 手写样题 1 · 一次函数(弹簧模型,中考典型题)。
 * 作用:① 打通播放器全链路;② 作为剧本格式的活文档 —— AI 拆解管线的目标产物长这样。
 *
 * 2026-08-30 教研审查修订:
 * - 术语合规(八年级下):不用「斜率/截距」(高中/超纲),说「k 的意义 / x=0 时的 y / 涨得快慢」;
 * - 台阶(ladder)挪到第 3 步「两个系数」——讲变化率的那一步画面必须有变化率;
 * - 第 6 步隐去观察点与水平引导线,避免与答案点 (12,18) 叠印;
 * - 滑杆上限 11(台阶 dx=1 需要右侧留 1 个单位,防止越出定义域 [0,12]);
 * - 小结拆成「方法」与「边界·再看一遍」两步,后者用参数扫描收尾;
 * - quiz 换成计算型干扰项(每个错误选项对应真实误区)。
 */
import type { LectureScriptInput } from '../script-schema';

export const springLinear: LectureScriptInput = {
  schemaVersion: '0.1',
  id: 'math-linear-spring-1',
  kind: 'problem',
  subject: 'math',
  grade: '八年级下',
  title: '弹簧长度与所挂质量(一次函数)',
  goal: '原长是 b、每千克伸长是 k;已知 y 求 x 要解方程,不能把长度当 x 代入。',
  problem: {
    text:
      '一根弹簧原长 $12\\,\\text{cm}$,每挂 $1\\,\\text{kg}$ 物体伸长 $0.5\\,\\text{cm}$。' +
      '设所挂物体质量为 $x\\,\\text{kg}$,弹簧总长为 $y\\,\\text{cm}$。\n' +
      '(1)写出 $y$ 与 $x$ 的函数关系式;\n' +
      '(2)挂 $6\\,\\text{kg}$ 物体时,弹簧多长?\n' +
      '(3)弹簧最长只能拉到 $18\\,\\text{cm}$,最多能挂多少千克?',
    source: '中考典型题(弹簧一次函数模型)',
  },
  difficultIdea:
    '把「原长 12」翻译成 x 等于 0 时的 y 值、「每千克伸长 0.5」翻译成 x 每增加 1 时 y 的增量——文字条件到 y=kx+b 两个系数的对应关系。',
  misconceptions: [
    '把 12 当成 k、0.5 当成 b(两个系数的位置互换)',
    '求"长度差"时习惯代两次公式再相减,意识不到差值只和 k 与质量差有关、与原长 12 无关',
    '第(3)问照着第(2)问的套路代入,把已知的长度当成 x 代进公式(把「已知 y 求 x」做成了「已知 x 求 y」)',
  ],
  scene: {
    family: 'coordinate',
    board: { xMin: -1, xMax: 15.5, yMin: -2, yMax: 21, xLabel: 'x/kg', yLabel: 'y/cm', grid: true },
    params: [{ id: 'm', label: '所挂质量', min: 0, max: 11, step: 0.5, initial: 2, unit: 'kg' }],
    elements: [
      { kind: 'point', id: 'p0', x: 0, y: 12, label: '(0, 12)', hidden: true },
      { kind: 'text', id: 'len0', x: 0.6, y: 12.8, text: '原长 12 cm', color: 'green', hidden: true },
      { kind: 'functiongraph', id: 'line', expr: '0.5*x + 12', domain: [0, 12], hidden: true },
      // 解析式与实时读数(画布内文字,随步揭示;{表达式:位数} 每帧求值)
      { kind: 'text', id: 'eq', x: 2, y: 20.3, text: 'y = 0.5x + 12', color: 'primary', hidden: true },
      { kind: 'text', id: 'live', x: 2, y: 18.9, text: '挂 {m:1} kg → 长 {0.5*m+12:1} cm', color: 'green', hidden: true },
      // 随参数 m 移动的观察点与虚线引导(讲增量 + 求值两用)
      { kind: 'point', id: 'pm', x: 'm', y: '0.5*m + 12', label: '({m:1}, {0.5*m+12:1})', color: 'orange', hidden: true },
      { kind: 'segment', id: 'guideV', from: ['m', 0], to: ['m', '0.5*m + 12'], dash: true, hidden: true },
      { kind: 'segment', id: 'guideH', from: [0, '0.5*m + 12'], to: ['m', '0.5*m + 12'], dash: true, hidden: true },
      // 台阶 + 行走标记:把「每千克伸长 0.5」读成可数的抬升动作
      { kind: 'ladder', id: 'ladder', expr: '0.5*x + 12', atParam: 'm', dx: 1, color: 'violet', hidden: true },
      // 第(3)问:上限线 y = 18
      { kind: 'segment', id: 'cap18', from: [0, 18], to: [14, 18], color: 'red', dash: true, hidden: true },
      { kind: 'text', id: 'cap18t', x: 9, y: 18.7, text: 'y = 18(上限)', color: 'red', hidden: true },
      { kind: 'point', id: 'p18', x: 12, y: 18, label: '(12, 18)', color: 'red', hidden: true },
    ],
  },
  steps: [
    {
      id: 's1',
      label: '读题',
      display:
        '**读题,圈出两个关键量**:原长 $12\\,\\text{cm}$(不挂东西时的长度),每挂 $1\\,\\text{kg}$ 伸长 $0.5\\,\\text{cm}$(变化的快慢)。不挂东西就是 $x=0$,此时 $y=12$——它对应图上这个点。',
      narration:
        '先看题目里的两个关键数。弹簧原来长十二厘米,这是不挂任何东西时的长度;每挂一千克伸长零点五厘米,这是变化的快慢。不挂东西,就是横坐标为零,这时纵坐标是十二,就是图上亮起来的这个点。',
      sceneActions: [
        { op: 'show', target: 'p0' },
        { op: 'show', target: 'len0' },
        { op: 'highlight', target: 'p0' },
      ],
      scaffolds: [
        '题目里有两个数:12 和 0.5,先分清哪个是"起点"、哪个是"每次变多少"。',
        '"原长"是不挂东西时的长度,对应 x=0 的位置;"每千克伸长"是 x 每加 1 时 y 的增量。',
        '12 是起点,也就是 x=0 时的 y;0.5 是每千克的增量,也就是 y=kx+b 里的 k。',
      ],
    },
    {
      id: 's2',
      label: '建函数',
      display:
        '**建立关系**:总长 = 原长 + 伸长量。挂 $x$ 千克一共伸长 $0.5x$。图象是一条从 $(0,12)$ 出发、向右上方的直线——解析式先不写,先看线。',
      narration:
        '总长等于原长加上伸长的部分。挂了 x 千克,一共伸长零点五乘 x。图象是从不挂东西时的十二厘米出发、向右上方走的一条直线。解析式稍后再写,先把这条线看清楚。',
      sceneActions: [
        { op: 'show', target: 'line' },
        { op: 'highlight', target: 'line' },
      ],
    },
    {
      id: 's3',
      label: '两个系数',
      display:
        '**两个数各管一件事**:$12$ 是**起点**(不挂东西时的长度,也就是与 $y$ 轴交点的纵坐标);$0.5$ 管**涨得快慢**($x$ 每增加 $1$,$y$ 就增加 $0.5$)。台阶把「每千克伸长零点五」读成一次抬升。',
      narration:
        '题目里两个数各管一件事。十二是起点,就是不挂东西时的长度;零点五管涨得快慢,横坐标每增加一,纵坐标就增加零点五。台阶上那一格,就是一千克带来的那一次抬升。',
      sceneActions: [
        { op: 'show', target: 'line' },
        { op: 'show', target: 'ladder' },
        { op: 'highlight', target: 'ladder' },
      ],
    },
    {
      id: 's4',
      label: '动手试',
      display:
        '写出关系式 $$y = 0.5x + 12$$ 再拖滑杆:质量每多 $1\\,\\text{kg}$,长度总是多 $0.5\\,\\text{cm}$——增量在直线上是均匀的。',
      narration:
        '现在可以写出关系式:y 等于零点五乘 x 加十二。十二是起点,零点五是每千克涨多少。拖动滑杆,看点沿着直线移动。质量每多一千克,长度总是多零点五厘米,整条直线上都一样。',
      sceneActions: [
        { op: 'show', target: 'eq' },
        { op: 'show', target: 'pm' },
        { op: 'show', target: 'guideV' },
        { op: 'show', target: 'guideH' },
        { op: 'show', target: 'live' },
        { op: 'hide', target: 'len0' },
        { op: 'highlight', target: 'eq' },
      ],
      interaction: {
        paramId: 'm',
        prompt: '拖动滑杆,观察长度怎么跟着变',
        targetValue: 4,
        feedback: '挂 {m:1} kg,弹簧长 {0.5*m+12:1} cm —— 比空载多 {0.5*m:1} cm,每千克半厘米,一路都一样。',
      },
      quiz: {
        question: '挂 2 kg 和挂 4 kg,弹簧长度相差多少?',
        options: ['1 cm', '2 cm', '0.5 cm'],
        answerIndex: 0,
        reveal:
          '质量差 2 kg,每千克伸长 0.5 cm,差值 = 2 × 0.5 = 1 cm。差多少只跟 $k$ 和质量差有关,和原长 12 无关——这就是 $k$ 的意义。',
      },
      scaffolds: [
        '先把滑杆拖到 2,记下长度;再拖到 4,看长度变成多少。',
        '两次的差,等于质量差乘以每千克的伸长量。',
        '2 千克的差 × 0.5 = 1 厘米,不需要分别算出两个总长再相减。',
      ],
    },
    {
      id: 's5',
      label: '第(2)问',
      display:
        '**第(2)问**:挂 $6\\,\\text{kg}$,代入 $x=6$:$$y = 0.5 \\times 6 + 12 = 15\\,\\text{(cm)}$$ 图上就是横坐标 $6$ 对应的点。',
      narration:
        '第二问,挂六千克。把六代进去,零点五乘六等于三,加十二,得到十五。所以弹簧长十五厘米。在图上,就是横坐标为六时,直线上对应的这个点。',
      sceneActions: [
        { op: 'hide', target: 'ladder' },
        { op: 'setParam', param: 'm', value: 6 },
        { op: 'highlight', target: 'pm' },
      ],
    },
    {
      id: 's6',
      label: '第(3)问',
      display:
        '**第(3)问,反过来问**:已知 $y=18$,求 $x$。解方程 $0.5x + 12 = 18$,得 $0.5x = 6$,$x = 12$。图上是红色上限线与直线的交点 $(12, 18)$——**最多挂 $12\\,\\text{kg}$**。',
      narration:
        '第三问反过来了:已知长度是十八,求质量。列方程,零点五乘 x 加十二等于十八,移项得到零点五 x 等于六,所以 x 等于十二。红色虚线是长度的上限,它和直线的交点,横坐标正好是十二。最多挂十二千克。',
      sceneActions: [
        { op: 'show', target: 'cap18' },
        { op: 'show', target: 'cap18t' },
        { op: 'hide', target: 'pm' },
        { op: 'hide', target: 'guideH' },
        { op: 'setParam', param: 'm', value: 12 },
        { op: 'show', target: 'p18' },
        { op: 'highlight', target: 'p18' },
      ],
      quiz: {
        question: '弹簧长 16 cm 时,挂的是多少千克?',
        options: ['20 kg', '8 kg', '2 kg'],
        answerIndex: 1,
        reveal:
          '把 $y=16$ 代进关系式:$0.5x+12=16$,$0.5x=4$,$x=8$。选 20 的是把 16 当成 $x$ 代进去求了长度,方向弄反了;选 2 的是把伸长量 $4$ 乘了 $0.5$,这里应该是除以 $0.5$。',
      },
      scaffolds: [
        '这问给的是长度,要求的是质量——和第(2)问方向相反。',
        '把已知的长度放到 y 的位置,列方程 0.5x + 12 = 18,再解 x。',
        '先减掉原长:18 − 12 = 6 是"伸出来的",再除以每千克的 0.5,得 12 千克。',
      ],
    },
    {
      id: 's7',
      label: '小结',
      display:
        '**小结·两条方法**:①文字 → 函数:不挂东西时的长度 $12$ 就是 $b$,每千克涨的 $0.5$ 就是 $k$,于是 $y=0.5x+12$;②已知 $x$ 求 $y$ 用**代入**,已知 $y$ 求 $x$ 用**解方程**。',
      narration:
        '小结两条方法。第一,把文字翻译成式子:不挂东西时的长度十二,是式子里的常数项;每多挂一千克涨零点五,是 x 前面的系数。第二,已知质量求长度,直接代入;已知长度求质量,列方程解。',
      sceneActions: [{ op: 'highlight', target: 'eq' }],
    },
    {
      id: 's8',
      label: '边界',
      display:
        '**模型边界·再看一遍**:题目规定弹簧最长 $18\\,\\text{cm}$,所以自变量只能取 $0 \\le x \\le 12$。真实弹簧还有弹性限度,拉过头后伸长不再与质量成正比,这条直线也就不再适用。',
      narration:
        '最后看一遍全过程:质量从零加到十二,长度从十二涨到十八,每千克始终是半厘米。注意边界,质量只能取零到十二千克;真实弹簧有弹性限度,拉过了头,这条直线就不能再用了。',
      sceneActions: [
        { op: 'hide', target: 'p18' },
        { op: 'show', target: 'pm' },
        { op: 'show', target: 'guideV' },
        { op: 'show', target: 'live' },
        { op: 'sweepParam', param: 'm', from: 0, to: 12, seconds: 6 },
      ],
    },
  ],
  reference: [
    { desc: 'x=6 时 y 应为 15', expr: '0.5*x + 12', params: { x: 6 }, expected: 15, tol: 1e-9 },
    { desc: 'x=12 时 y 应为 18(上限)', expr: '0.5*x + 12', params: { x: 12 }, expected: 18, tol: 1e-9 },
    { desc: 'x=0 时 y 应为原长 12', expr: '0.5*x + 12', params: { x: 0 }, expected: 12, tol: 1e-9 },
    { desc: 'y=16 时 x 应为 8(反向解方程)', expr: '(16 - 12) / 0.5', params: {}, expected: 8, tol: 1e-9 },
    { desc: '2 kg 到 4 kg 的长度差应为 1', expr: '(0.5*4 + 12) - (0.5*2 + 12)', params: {}, expected: 1, tol: 1e-9 },
  ],
};
