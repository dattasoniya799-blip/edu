import type { ReactNode } from 'react';
import { createElement } from 'react';
import { KpAnimations } from './kp-animations/KpAnimations';

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
    id: 'kp-animations',
    title: '知识点动画',
    summary:
      '验证「单文件零依赖交互 HTML」能不能当知识点动画的标准产物:5 个试点全部过确定性校验,且在沙箱 iframe 里能正常试玩。',
    owner: '实验区',
    status: 'running',
    render: () => createElement(KpAnimations),
  },
];
