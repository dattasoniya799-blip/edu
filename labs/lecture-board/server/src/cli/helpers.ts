import { relative } from 'node:path'
import { LAB_ROOT } from '../config'
import { lessonDir } from '../store'

export { LAB_ROOT }

/** 产物目录,相对 labs/lecture-board/ 打印,终端里短一点 */
export function lessonDirLabel(id: string): string {
  return relative(LAB_ROOT, lessonDir(id)) || lessonDir(id)
}
