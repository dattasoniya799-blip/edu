import type { LectureScriptInput } from '../script-schema';

/** 知识点课 · 一次函数 k 与 b(八年级,不说斜率/截距) */
export const kpLinearKb: LectureScriptInput = {
  schemaVersion: '0.1',
  id: 'kp-linear-kb',
  kind: 'concept',
  subject: 'math',
  grade: '八年级',
  title: '一次函数:k 与 b 各管什么',
  goal: 'k 管直线倾斜的方向和陡缓,b 管直线穿过 y 轴的位置,改一个另一个不动。',
  difficultIdea: '两个参数独立:改 k 时直线绕 (0,b) 转,改 b 时整条线平移,交点跟着走但倾斜不变。',
  misconceptions: [
    '把 b 当成直线与 x 轴的交点',
    '以为 k 变了,直线和 y 轴的交点也会跑',
  ],
  scene: {
    family: 'coordinate',
    board: { xMin: -5, xMax: 5, yMin: -4, yMax: 5, xLabel: 'x', yLabel: 'y', grid: true, keepAspect: true },
    params: [
      { id: 'k', label: 'k', min: -2.4, max: 2.4, step: 0.05, initial: 1 },
      { id: 'b', label: 'b', min: -3, max: 3.5, step: 0.1, initial: 1.5 },
      { id: 'mark', label: '台阶位置', min: 1, max: 1, step: 1, initial: 1 },
    ],
    elements: [
      { kind: 'functiongraph', id: 'line', expr: 'k*x + b', color: 'primary', hidden: true },
      { kind: 'point', id: 'pB', x: 0, y: 'b', label: '(0, {b:1})', color: 'green', hidden: true },
      { kind: 'ladder', id: 'ladder', expr: 'k*x + b', atParam: 'mark', dx: 1, color: 'violet', hidden: true },
      { kind: 'text', id: 'eq', x: -4.6, y: 4.5, text: 'y = {k:1}x + {b:1}', color: 'primary', hidden: true },
    ],
    readouts: [{ template: 'k = {k:1}    b = {b:1}', color: 'muted' }],
  },
  steps: [
    {
      id: 's1',
      label: '引入',
      display:
        '把直线想成一条坡道。有两个旋钮:一个管「往右走一格,抬高多少」,一个管「这条坡道从多高开始」。这节课只弄清这两件事互不干扰。',
      narration:
        '把眼前这条直线想成一条坡道。它有两个旋钮。一个管往右走一格会抬高多少,也就是陡不陡;一个管这条坡道从多高的地方起步。这节课只要弄明白:拧其中一个,另一个会不会跟着跑。',
      sceneActions: [{ op: 'show', target: 'line' }, { op: 'highlight', target: 'line' }],
    },
    {
      id: 's2',
      label: '只看 k',
      display:
        '先只动 k。k 变大,同样往右一格,抬得更高,坡道更陡;k 变成负数,往右走反而往下。注意:和 y 轴的交点一直没动。',
      narration:
        '先只管 k。k 变大,同样往右走一格,抬得更高,坡道更陡。k 变成负数,往右走就变成往下走。盯住和纵轴的交点:k 怎么拧,那个点都还在原地。',
      sceneActions: [
        { op: 'show', target: 'line' },
        { op: 'show', target: 'pB' },
        { op: 'highlight', target: 'pB' },
        { op: 'sweepParam', param: 'k', from: 0.4, to: 2.0, seconds: 5 },
      ],
    },
    {
      id: 's3',
      label: '动手拧 k',
      display:
        '自己拖 k。看两件事:① 陡缓变了没有;② 绿点 (0, b) 动了没有。',
      narration:
        '轮到你拧 k。一边拖,一边看两件事:坡道陡了还是缓了;绿色那个点,也就是和纵轴的交点,有没有跟着跑。',
      sceneActions: [
        { op: 'show', target: 'line' },
        { op: 'show', target: 'pB' },
        { op: 'show', target: 'ladder' },
        { op: 'highlight', target: 'ladder' },
      ],
      interaction: {
        paramId: 'k',
        prompt: '拖 k,看陡缓变了没有,绿点动了没有',
        targetValue: -1,
        feedback: 'k = {k:1}。右一格抬 {k:1} 格。绿点仍在 (0, {b:1}),b 没动,交点就不会动。',
      },
      scaffolds: [
        '盯住绿色的点,不要盯整条线。',
        'k 管的是「右一格抬几格」,不管起步有多高。',
        '绿点的纵坐标就是 b,你没拧 b,它就不会走。',
      ],
    },
    {
      id: 's4',
      label: '只看 b',
      display:
        '现在只动 b。整条直线平行上移或下移,倾斜程度一格不改。绿点跟着 b 走——它是与 **y 轴** 的交点,不是与 x 轴的交点。',
      narration:
        '现在改拧 b。整条直线平行地往上或往下挪,陡缓完全没变。绿点跟着 b 走。记住:这个点在纵轴上,不是横轴上。有同学把 b 当成和 x 轴的交点,那是另一回事。',
      sceneActions: [
        { op: 'hide', target: 'ladder' },
        { op: 'show', target: 'pB' },
        { op: 'highlight', target: 'pB' },
        { op: 'setParam', param: 'k', value: 1 },
        { op: 'sweepParam', param: 'b', from: -1.2, to: 2.4, seconds: 5 },
      ],
    },
    {
      id: 's5',
      label: '结论',
      display:
        '现在可以写出 $$y = kx + b$$ k 管倾斜,b 管起步高度。自己拖 b,确认:倾斜不变,绿点跟着走。',
      narration:
        '现在把两件事合在一起写:y 等于 k 乘 x 加 b。k 管倾斜,b 管从多高起步。再拖一次 b,确认坡道的陡缓没变,只有绿点在纵轴上搬家。',
      sceneActions: [
        { op: 'show', target: 'eq' },
        { op: 'show', target: 'pB' },
        { op: 'highlight', target: 'eq' },
      ],
      interaction: {
        paramId: 'b',
        prompt: '拖 b,看绿点搬家时,倾斜变了没有',
        targetValue: -1.5,
        feedback: 'b = {b:1},绿点在 (0, {b:1})。k 仍是 {k:1},陡缓没变。',
      },
    },
    {
      id: 's6',
      label: '收尾',
      display:
        '再看一遍:k 从缓到陡,绿点钉住;这就是「改一个,另一个不动」。模型到此为止,不讲方程、不讲待定系数。',
      narration:
        '最后再看一遍全过程。k 从缓拧到陡,绿点始终钉在原地。记住最容易错的那句:b 是和纵轴的交点,不是和横轴的交点。这节课就到这里。',
      sceneActions: [
        { op: 'show', target: 'eq' },
        { op: 'show', target: 'pB' },
        { op: 'setParam', param: 'b', value: 1.5 },
        { op: 'sweepParam', param: 'k', from: 0.5, to: 2.2, seconds: 6 },
      ],
    },
  ],
  reference: [
    { desc: 'k=1 b=1.5 时 x=2 应得 3.5', expr: 'k*x + b', params: { k: 1, b: 1.5, x: 2 }, expected: 3.5, tol: 1e-9 },
    { desc: 'x=0 时 y 就是 b', expr: 'k*0 + b', params: { k: 2, b: -1.5 }, expected: -1.5, tol: 1e-9 },
    { desc: '只改 k,x=0 处仍为 b', expr: '3*0 + 1.5', params: {}, expected: 1.5, tol: 1e-9 },
  ],
};
