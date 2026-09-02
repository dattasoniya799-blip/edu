import type { LectureScriptInput } from '../script-schema';

/**
 * 中考一次函数应用 · 相向相遇。
 * 甲距甲地 y=40x,乙距甲地 y=120-60x,相遇 40x=120-60x → x=1.2,路程 48。
 */
export const meetOnRoad: LectureScriptInput = {
  schemaVersion: '0.1',
  id: 'math-meet-120-1',
  kind: 'problem',
  subject: 'math',
  grade: '八年级下',
  title: '甲乙相向而行(一次函数相遇)',
  goal: '把两人位置都写成「离开甲地的距离」,图上两条线的交点就是相遇;列方程 40x=120-60x。',
  problem: {
    text:
      '甲、乙两地相距 $120$ 千米。甲车从甲地开往乙地,速度 $40$ 千米/时;' +
      '乙车同时从乙地开往甲地,速度 $60$ 千米/时。设行驶时间为 $x$ 小时。\n' +
      '(1)分别写出甲车、乙车离开甲地的距离 $y$(千米)与 $x$ 的关系式;\n' +
      '(2)几小时后两车相遇?\n' +
      '(3)相遇时,甲车行驶了多少千米?',
    source: '中考一次函数应用典型题(相向相遇)',
  },
  difficultIdea:
    '乙车是从 120 往回走,关系式是 120 减去 60x,不是 60x;两条线对的是同一个「离开甲地的距离」。',
  misconceptions: [
    '把乙车也写成 y=60x,两条线同向往上,交不出相遇',
    '相遇时间用 120÷40 或 120÷60,当成一辆车跑完全程',
    '列出 40x+60x=120 后得到 1.2,却把 1.2 当成甲车走的千米数',
  ],
  scene: {
    family: 'coordinate',
    board: { xMin: -0.15, xMax: 2.2, yMin: -8, yMax: 135, xLabel: 'x/时', yLabel: '离开甲地/km', grid: true },
    params: [{ id: 't', label: '行驶时间', min: 0, max: 1.8, step: 0.05, initial: 0.3, unit: '时' }],
    elements: [
      { kind: 'functiongraph', id: 'jia', expr: '40*x', domain: [0, 2], color: 'primary', hidden: true },
      { kind: 'functiongraph', id: 'yi', expr: '120 - 60*x', domain: [0, 2], color: 'green', hidden: true },
      { kind: 'point', id: 'A', x: 0, y: 0, label: '甲地', color: 'primary', hidden: true },
      { kind: 'point', id: 'B', x: 0, y: 120, label: '乙地 120', color: 'green', hidden: true },
      { kind: 'segment', id: 'gap', from: [0, 0], to: [0, 120], color: 'muted', dash: true, hidden: true },
      { kind: 'point', id: 'pj', x: 't', y: '40*t', label: '甲 ({40*t:0} km)', color: 'primary', hidden: true },
      { kind: 'point', id: 'py', x: 't', y: '120 - 60*t', label: '乙 ({120-60*t:0} km)', color: 'green', hidden: true },
      { kind: 'segment', id: 'remain', from: ['t', '40*t'], to: ['t', '120 - 60*t'], dash: true, color: 'orange', hidden: true },
      { kind: 'text', id: 'eqj', x: 1.25, y: 95, text: '甲: y = 40x', color: 'primary', hidden: true },
      { kind: 'text', id: 'eqy', x: 1.25, y: 82, text: '乙: y = 120 − 60x', color: 'green', hidden: true },
      { kind: 'point', id: 'meet', x: 1.2, y: 48, label: '(1.2, 48)', color: 'red', hidden: true },
      { kind: 'segment', id: 'vm', from: [1.2, 0], to: [1.2, 48], dash: true, color: 'red', hidden: true },
    ],
  },
  steps: [
    {
      id: 's1',
      label: '读题',
      display:
        '先把路摆上图:甲地在 $y=0$,乙地在 $y=120$,两地相距 $120$ 千米。两人**同时**出发、相向而行。',
      narration:
        '先把路摆到图上。纵轴表示离开甲地有多远。甲地在零,乙地在一百二十,两地相距一百二十千米。两辆车同时出发,面对面开。',
      sceneActions: [
        { op: 'show', target: 'A' },
        { op: 'show', target: 'B' },
        { op: 'show', target: 'gap' },
        { op: 'highlight', target: 'B' },
      ],
    },
    {
      id: 's2',
      label: '甲车',
      display:
        '甲车从甲地出发,每小时离开甲地 $40$ 千米,位置沿一条向右上的线走。这一拍只看甲,先不写乙。',
      narration:
        '先看甲车。它从甲地出发,每小时离开甲地四十千米,所以它的位置顺着一条向右上的线走。这一拍只盯甲车,乙车先别看。',
      sceneActions: [
        { op: 'show', target: 'jia' },
        { op: 'show', target: 'pj' },
        { op: 'highlight', target: 'jia' },
        { op: 'sweepParam', param: 't', from: 0, to: 1.2, seconds: 5 },
      ],
    },
    {
      id: 's3',
      label: '乙车',
      display:
        '乙车从 $120$ 往回走,每小时靠近甲地 $60$ 千米,所以是 $120$ 减去 $60x$。图上是一条向右下的线。两人之间还空着的那段,就是还没相遇的距离。',
      narration:
        '再看乙车。它从一百二十往回走,每小时靠近甲地六十千米,所以离开甲地的距离是一百二十减去六十乘时间。图上是一条往右下走的线。两条线之间空着的那段,就是两人还没碰上的距离。',
      sceneActions: [
        { op: 'show', target: 'yi' },
        { op: 'show', target: 'py' },
        { op: 'show', target: 'remain' },
        { op: 'highlight', target: 'yi' },
        { op: 'setParam', param: 't', value: 0.4 },
      ],
    },
    {
      id: 's4',
      label: '动手试',
      display:
        '拖时间,看两个点怎样对进。空着的那段越来越短——短到零,就是相遇。',
      narration:
        '滑杆交给你。拖时间,看橙色的甲点和绿色的乙点怎样对进。它们中间空着的那段会越来越短。短到零的时候,两车相遇。',
      sceneActions: [
        { op: 'show', target: 'pj' },
        { op: 'show', target: 'py' },
        { op: 'show', target: 'remain' },
        { op: 'show', target: 'jia' },
        { op: 'show', target: 'yi' },
      ],
      interaction: {
        paramId: 't',
        prompt: '拖时间,看两车何时碰上',
        targetValue: 1.2,
        feedback:
          '开了 {t:2} 时:甲离开甲地 {40*t:0} km,乙离开甲地 {120-60*t:0} km,还差 {120-100*t:1} km。差为 0 就是相遇。',
      },
      scaffolds: [
        '把滑杆慢慢往右推,盯住两个点的纵坐标是不是在靠近。',
        '相遇不是看谁先到乙地,是看两个纵坐标变成同一个数。',
        '差等于 120−40t−60t,也就是 120−100t。令它为 0。',
      ],
    },
    {
      id: 's5',
      label: '结论',
      display:
        '同一把尺(离开甲地的距离)写出两式:甲 $y=40x$,乙 $y=120-60x$。相遇时纵坐标相等:$$40x=120-60x$$ 得 $x=1.2$。甲车走了 $40\\times 1.2=48$ 千米。',
      narration:
        '用同一把尺来写:都是离开甲地的距离。甲是四十乘 x,乙是一百二十减六十乘 x。相遇就是两个纵坐标相等,四十 x 等于一百二十减六十 x,解得 x 等于一点二小时。甲车走了四十乘一点二,四十八千米。',
      sceneActions: [
        { op: 'show', target: 'eqj' },
        { op: 'show', target: 'eqy' },
        { op: 'show', target: 'meet' },
        { op: 'show', target: 'vm' },
        { op: 'setParam', param: 't', value: 1.2 },
        { op: 'highlight', target: 'meet' },
        { op: 'hide', target: 'remain' },
      ],
    },
    {
      id: 's6',
      label: '收尾',
      display:
        '再看一遍:时间从 0 走到 1.2,空距收到零,交点钉在 $(1.2,48)$。相向相遇用「速度和去除两地距离」,和刚才列方程是同一件事。',
      narration:
        '最后再看一遍全过程。时间从零走到一点二,中间空着的距离收到零,交点钉在一点二小时、四十八千米。相向相遇,也可以记成两地距离除以速度和,和刚才列方程是同一件事。',
      sceneActions: [
        { op: 'show', target: 'meet' },
        { op: 'show', target: 'pj' },
        { op: 'show', target: 'py' },
        { op: 'sweepParam', param: 't', from: 0, to: 1.2, seconds: 6 },
      ],
      quiz: {
        question: '相遇时甲车行驶了多少千米?',
        options: ['1.2 千米', '48 千米', '72 千米'],
        answerIndex: 1,
        reveal:
          '1.2 是小时不是千米。甲每小时 40 千米,走了 1.2 小时,40×1.2=48。72 是乙车走的 60×1.2。',
      },
    },
  ],
  reference: [
    { desc: '甲 x=1.2 时应为 48', expr: '40*x', params: { x: 1.2 }, expected: 48, tol: 1e-9 },
    { desc: '乙 x=1.2 时应为 48', expr: '120 - 60*x', params: { x: 1.2 }, expected: 48, tol: 1e-9 },
    { desc: '相遇时间 120/(40+60)=1.2', expr: '120 / (40 + 60)', params: {}, expected: 1.2, tol: 1e-9 },
    { desc: 'x=0.4 时还差 80 km', expr: '120 - 100*x', params: { x: 0.4 }, expected: 80, tol: 1e-9 },
  ],
};
