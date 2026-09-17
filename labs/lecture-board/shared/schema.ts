/**
 * 讲题白板 · 剧本契约 v2(BoardScript)。
 * 由协调会话冻结(2026-09-17);server 与 web 两侧只读,要改字段先改本文件并通知另一侧。
 *
 * 心智模型:
 *  - 白板 = 若干「列」(column),每列一个阶段/一问;列里自上而下堆「卡片」(card)。
 *  - 讲解 = 有序的「步」(step),每步是 say/do/fx 交错的 flow;播放器顺序执行 flow,
 *    say 推旁白流并播音频,do 让卡片/板书行浮现或驱动动画,fx 画红圈/下划线。
 *  - 素材(图 / 动画 / 音频)与剧本分离,先占位后到达(见 protocol.md 的 SSE 事件)。
 */

export type Subject = 'math' | 'physics' | 'chemistry';
export type Phase = 'analysis' | 'solve' | 'summary' | 'explore';

export interface BoardScript {
  version: 2;
  /** 顶栏标题药丸,如「圆与圆周角:半径与弦的夹角」,≤ 16 字 */
  title: string;
  subject: Subject;
  /** 一句话讲什么,给列表/日志用 */
  summary: string;
  problem: {
    /** 题干逐字抄录,按 (1)(2)①② 分行(\n) */
    text: string;
    /** 用户上传的题目截图 URL(/assets/...),原样展示在审题列 */
    images: string[];
    /** 用户给的答案文本(ground truth) */
    answer: string;
  };
  /** 审题四块 + 三色高亮(沿用讲解件 analysis 纪律) */
  analysis: {
    given: string[];
    hidden: string[];
    find: string[];
    ideas: string[];
    /** 必须是 problem.text 的子串;kind: key=限制/关键行为词(红) data=数据(蓝) hidden=隐含线索(绿) */
    marks: { text: string; kind: 'key' | 'data' | 'hidden' }[];
  };
  columns: Column[];
  cards: Card[];
  figures: Figure[];
  animations: Animation[];
  steps: Step[];
  /** 总结四色块(蓝知识点 / 红易错 / 橙技巧 / 绿举一反三),每条用【】圈 1 个关键词 */
  takeaways: { knowledge: string[]; pitfalls: string[]; methods: string[]; variants: string[] };
  /** 动手环节:哪张动画卡开放哪些参数 + 2–3 条探索任务 */
  explore?: { animationId: string; unlock: string[]; tasks: string[] };
  /** 音频(server 预渲染后填入;key 见 protocol.md「音频 key」) */
  audio?: {
    voice: { provider: string; voiceId: string; name: string };
    clips: Record<string, AudioClip>;
  };
}

export interface Column {
  id: string;
  /** 列标题,如「审题」「第(1)问」「总结」「动手」 */
  title: string;
  phase: Phase;
  /** 第几问(phase=solve 时) */
  subq?: number;
}

/**
 * 卡片:所有卡初始不可见,由 flow 的 do:reveal 逐个浮现。
 * 审题列特殊(2026-09-17 11:40 改):开讲前只有 problem 卡可见且**题干高亮全部隐藏**、analysis 卡可见但四块全部隐藏;
 * 由 phase=analysis 的 steps 逐条 reveal `mark:<text>` 与 `analysis:<block>`——「审题」是讲出来的,不是摆出来的。
 * 兼容:若剧本没有 phase=analysis 的 step,播放器退回旧行为(审题列整列可见)。
 */
export type Card =
  | { id: string; col: string; kind: 'heading'; text: string }
  | { id: string; col: string; kind: 'points'; title?: string; lines: string[] }
  | { id: string; col: string; kind: 'board'; title?: string; lines: BoardLine[] }
  | { id: string; col: string; kind: 'table'; title?: string; markdown: string; speech: string }
  | { id: string; col: string; kind: 'figure'; figureId: string }
  | { id: string; col: string; kind: 'animation'; animationId: string }
  | { id: string; col: string; kind: 'problem' } // 审题列:题干(带 marks 高亮)+ 题图
  | { id: string; col: string; kind: 'analysis' } // 审题列:已知/隐含/求/思路 四块
  | { id: string; col: string; kind: 'takeaways' }; // 总结列:四色块

/**
 * 板书行。formula 行必须同时有 tex 与 speech:
 *  - tex 给 KaTeX 排版(不含 $ 定界符);
 *  - speech 是老师口头念法,不得含任何 LaTeX 记号(TTS 只念 speech)。
 * text 行只有 text(可含 Unicode 符号);conclusion 行带框强调。
 */
export interface BoardLine {
  id: string;
  kind: 'text' | 'formula' | 'conclusion';
  text?: string;
  tex?: string;
  speech?: string;
}

/**
 * 配图计划。kind:
 *  - scene   情境图 → Seedream 生成(每题 ≤ 2 张;几何/函数图禁止用 scene);prompt 不含风格前缀,由 server 拼;
 *  - diagram 关系/流程图 → Mermaid 源码,web 端即时渲染,无需生成。
 * src 由 server 生成后填入(/assets/...),生成前为 undefined;web 显示骨架占位。
 */
export interface Figure {
  id: string;
  kind: 'scene' | 'diagram';
  prompt?: string;
  mermaid?: string;
  caption?: string;
  src?: string;
  status: 'pending' | 'ready' | 'failed';
  error?: string;
}

/**
 * 动画计划。kind:
 *  - template 现有 lecture-scene 六模板之一(quadratic-line / linear-shift / cart-collision / buoyancy / circle-angle / parallelogram-angle),
 *             params 按各模板 manifest;web 端用 LectureScene 运行时直接挂载(同源,不走 iframe);
 *  - html     LLM 生成的自包含 HTML(≤ 30 KB,禁网络),web 端放 sandbox iframe,经 postMessage 桥接(见 protocol.md);
 *  - static   降级:一张 SVG 源码(html 校验两次不过时),不可交互。
 */
export interface Animation {
  id: string;
  kind: 'template' | 'html' | 'static';
  /** 一句话说明这张动画演示什么(旁白可引用) */
  purpose: string;
  template?: string;
  params?: Record<string, number | string | unknown>;
  html?: string;
  svg?: string;
  status: 'pending' | 'ready' | 'failed';
  error?: string;
}

export interface Step {
  id: string;
  title: string;
  /** 本步所属列 */
  col: string;
  flow: FlowItem[];
}

/**
 * 目标字符串(target / ref 共用一套写法,2026-09-17 11:40 扩展):
 *  - `<cardId>`                      整张卡
 *  - `<lineId>`                      某板书行
 *  - `mark:<text>`                   审题卡里题干的某个高亮片段(text 必须等于 analysis.marks[].text)
 *  - `analysis:<given|hidden|find|ideas>[:<i>]`  审题卡的某一块(或块里第 i 条,0 起)
 *  - `takeaways:<knowledge|pitfalls|methods|variants>:<i>`  总结卡某一条
 *
 * flow 项(顺序执行):
 *  - say    旁白一句(≤ 120 字,口语,不含 LaTeX);音频 key = steps.<stepId>.flow.<index>
 *           `ref`:这句话在讲板上的哪个东西(一个或多个目标)。播放器在念这句时给目标加「正在讲」高亮
 *           (黄色马克笔底 + 卡片左侧色条),念完淡出;`emph:'mark'` 念完后保留黄底,`emph:'circle'` 念完后留红圈。
 *           没写 ref 时播放器自动指向最近一次 reveal 的目标,所以旁白永远有视觉锚点;
 *           出剧本纪律:审题阶段每句必有 ref;解题阶段 ≥ 60% 的 say 有 ref;结论行配 emph:'circle'。
 *  - reveal 让卡片(cardId)/板书行(lineId)浮现;也可 reveal `mark:<text>`(题干上亮出这处高亮)与
 *           `analysis:<block>`(审题卡亮出一块);卡片未浮现时 reveal 其行会先浮现卡片
 *  - anim   向动画卡发一个动作,action 形状沿用 lecture-scene 模板 manifest 的 actions(如 {type:'show',target:'tank'} / {type:'run',phase:'rise'} / {type:'move',param:'mw',to:0.1,durationMs:1500});
 *           html 动画只接受 {type:'do', name, params}
 *  - fx     视觉强调:circle 红圈 / underline 下划线 / pulse 脉冲;target 为 cardId 或 lineId;snippet 为该卡文字里要圈的子串(可省=整卡)
 *  - focus  把视口滚到某卡/某列
 *  - pause  停顿 ms(默认 600)
 */
export type FlowItem =
  | { say: string; ref?: string | string[]; emph?: 'mark' | 'circle' }
  | { do: 'reveal'; target: string }
  | { do: 'anim'; target: string; action: Record<string, unknown> }
  | { fx: 'circle' | 'underline' | 'pulse'; target: string; snippet?: string; color?: string }
  | { do: 'focus'; target: string }
  | { do: 'pause'; ms?: number };

export interface AudioClip {
  /** 合成时所用的口播文本(播放器比对一致才用该 clip,否则回退 Web Speech) */
  text: string;
  /** /assets/<lessonId>/audio/<key>.mp3 */
  src: string;
  durationMs?: number;
}

/* ------------------------------------------------------------------ */
/* 服务端任务状态(GET /api/lessons/:id 返回体)                          */
/* ------------------------------------------------------------------ */

export type LessonStage = 'uploaded' | 'recognizing' | 'planning' | 'scripting' | 'assets' | 'ready' | 'failed';

export interface LessonState {
  id: string;
  createdAt: string;
  stage: LessonStage;
  /** 各阶段起止与耗时(毫秒),给进度条与验收统计 */
  timings: Partial<Record<Exclude<LessonStage, 'uploaded' | 'failed'>, { startedAt: string; endedAt?: string; ms?: number }>>;
  input: { images: string[]; answer: string; problemText?: string };
  /** 识题产物(要点卡,沿用讲解件 LectureKeypoints 形状,供调试面板看) */
  keypoints?: unknown;
  /** 剧本;stage ≥ 'assets' 时存在。figures/animations/audio 随素材到达逐步补全 */
  script?: BoardScript;
  /** 校验器输出(错误即 failed;警告只记录) */
  validation?: { errors: string[]; warnings: string[] };
  error?: string;
}
