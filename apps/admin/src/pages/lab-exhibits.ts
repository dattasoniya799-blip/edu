export interface LabExhibit {
  id: string;
  file: string;
  title: string;
  subject: '数学' | '物理';
  summary: string;
}

export const LAB_EXHIBITS: LabExhibit[] = [
  {
    id: 'circle-angle',
    file: 'circle-angle.html',
    title: '圆内接三角形求角与垂直判定',
    subject: '数学',
    summary: '圆周角与圆心角、等腰加外角求角,再判定 OB 与 BE 垂直。',
  },
  {
    id: 'buoyancy',
    file: 'buoyancy.html',
    title: '潜艇模型的浮沉与做功',
    subject: '物理',
    summary: '桌面压强、浸没浮力与排水上浮做功,讲完可拖注水滑杆验证浮沉。',
  },
  {
    id: 'parallelogram-angle',
    file: 'parallelogram-angle.html',
    title: '平行四边形作高求边与垂直证明',
    subject: '数学',
    summary: '作高拆直角三角形求 BC,再看 AF 与 BD、DE 与 BF 的关系。',
  },
];

export function exhibitHref(file: string, baseUrl = import.meta.env.BASE_URL): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}lab/${file}`;
}

/**
 * [2026-09-17 task/lab-kg-lecture] 实验服务:不是单文件 HTML,而是要单独起的本地/内网服务
 * (代码在仓库 `labs/<dir>/`,不进主线门禁、不部署)。管理端只放入口卡片,地址可用 VITE_LAB_* 覆盖。
 */
export interface LabService {
  id: string;
  title: string;
  subject: '数学' | '物理' | '化学' | '数理化';
  summary: string;
  /** 仓库内代码位置与起法(卡片上直接展示,免翻文档) */
  howToRun: string;
  url: string;
}

const env = import.meta.env as Record<string, string | undefined>;

export const LAB_SERVICES: LabService[] = [
  {
    id: 'knowledge-graph',
    title: '初中数理化知识图谱(动态)',
    subject: '数理化',
    summary: '995 个知识点、1956 条前置关系焊成一张图;点任一节点追到真正卡住的那一步。读 data/knowledge-graphs/v2 实时构图,改数据即见。',
    howToRun: 'labs/knowledge-graph · node server.mjs(:8787)',
    url: env.VITE_LAB_KG_URL ?? 'http://127.0.0.1:8787',
  },
  {
    id: 'lecture-board',
    title: '讲题白板(AI 自动讲题)',
    subject: '数理化',
    summary: '上传题目截图 + 答案,Qwen 自动审题、规划、出剧本,在 HyperKnow 式白板上边讲边写:公式、配图、动画、语音。',
    howToRun: 'labs/lecture-board · npm run dev(server :4310 + web :4311)',
    url: env.VITE_LAB_LECTURE_URL ?? 'http://localhost:4311',
  },
];
