/** 枚举 → 中文文案与语义色(色名只指向 design-tokens 派生的 Tag tone) */
import type { ClassType, UserStatus } from '@qiming/contracts';
import type { TagTone } from '@qiming/ui';

export const STAGES = ['初中', '高中'] as const;
export const SUBJECTS = ['数学', '物理', '化学', '语文', '英语'] as const;
export const GRADES = ['初一', '初二', '初三', '高一', '高二', '高三'] as const;

/** 班型徽标(原型 .bt:b1v=主色 / b11=橙 / b13=紫) */
export const CLASS_TYPE_LABEL: Record<ClassType, string> = { group: '班课', one_on_one: '一对一', one_on_three: '一对三' };
export const CLASS_TYPE_TONE: Record<ClassType, TagTone> = { group: 'primary', one_on_one: 'orange', one_on_three: 'violet' };

/** 学科 tag 配色(对照原型教师表) */
export const SUBJECT_TONE: Record<string, TagTone> = { 数学: 'primary', 物理: 'violet', 化学: 'orange', 英语: 'green', 语文: 'red' };

/** 教师状态胶囊 */
export const TEACHER_STATUS: Record<UserStatus, { tone: TagTone; label: string }> = {
  active: { tone: 'green', label: '在职' },
  disabled: { tone: 'gray', label: '已停用' },
  pending: { tone: 'orange', label: '待激活' },
};

/** 学生状态胶囊 */
export const STUDENT_STATUS: Record<UserStatus, { tone: TagTone; label: string }> = {
  active: { tone: 'green', label: '正常' },
  disabled: { tone: 'gray', label: '停用' },
  pending: { tone: 'orange', label: '待激活' },
};

/** AI 超额策略文案(契约 enum ↔ 原型选项) */
export const OVER_POLICY_LABEL: Record<string, string> = {
  disable_qa: '关闭课后 AI 答疑,保留课堂 AI 伴学',
  pause_all: '全部暂停,人工确认后恢复',
  record_only: '不限制,仅记录超额账单',
};
