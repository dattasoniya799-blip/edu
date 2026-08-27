import type { ReactNode } from 'react';

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

export const EXPERIMENTS: Experiment[] = [];
