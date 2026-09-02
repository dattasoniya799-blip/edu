import type { ReactNode } from 'react';
import { createElement } from 'react';
import { KpAnimations } from './kp-animations/KpAnimations';
import { DynamicLecture } from './dynamic-lecture/DynamicLecture';

/**
 * 实验登记表:首页按这份表列清单。
 * 新增实验 = 在 src/experiments/ 下建目录 + 往下面数组里加一条;做完就把条目和目录一起删掉。
 */
export interface Experiment {
  id: string;
  title: string;
  /** 一句话说明:在验证什么、成功标准是什么 */
  summary: string;
  owner: string;
  status: 'running' | 'parked' | 'done';
  render: () => ReactNode;
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'dynamic-lecture',
    title: '动画课堂',
    summary:
      '学生端上课页:知识点两堂 + 中考讲题三堂,共用一套播放器。能听、能看、指定拍能动手。教师制作与分发不在本实验。',
    owner: '实验区',
    status: 'running',
    render: () => createElement(DynamicLecture),
  },
  {
    id: 'kp-animations',
    title: '知识点动画(素材/校验)',
    summary:
      '非上课入口。单文件 HTML 的确定性校验与试玩,给人审用。上课请走「动画课堂」。',
    owner: '实验区',
    status: 'parked',
    render: () => createElement(KpAnimations),
  },
];
