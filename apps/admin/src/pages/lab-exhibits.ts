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
