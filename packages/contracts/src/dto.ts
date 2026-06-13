/**
 * @qiming/contracts · 枚举与核心 DTO
 * 与 apps/server/prisma/schema.prisma 一一对应 —— 改这里必须同步改 schema(走契约变更单)
 */

// ---------- 枚举(镜像 Prisma) ----------
export type Role = 'admin' | 'teacher' | 'student';
export type OrgStatus = 'active' | 'suspended';
export type UserStatus = 'active' | 'disabled' | 'pending';
export type ClassType = 'group' | 'one_on_one' | 'one_on_three';
export type CourseStatus = 'draft' | 'ongoing' | 'finished' | 'archived';
export type LessonStatus = 'draft' | 'ready' | 'in_progress' | 'finished';
export type SegmentType = 'warmup' | 'lecture' | 'practice' | 'summary' | 'homework' | 'break_time';
export type ResourceType = 'ppt' | 'pdf' | 'video' | 'interactive' | 'image';
export type QuestionType = 'single' | 'multi' | 'blank' | 'solution';
export type QuestionStatus = 'draft' | 'published' | 'retired';
export type PaperType = 'homework' | 'exam' | 'practice';
export type AssignmentKind = 'homework' | 'in_class' | 'correction' | 'wrong_redo' | 'consolidation';
export type AttemptStatus = 'in_progress' | 'submitted' | 'graded';
export type WrongStatus = 'open' | 'cleared';
export type SessionStatus = 'scheduled' | 'live' | 'paused' | 'ended';
export type ParticipantState = 'normal' | 'stuck' | 'hand_up' | 'offline';
export type AiFeature = 'class_companion' | 'qa' | 'pre_grading' | 'diagnosis';
export type GraphType = 'curriculum_knowledge' | 'problem_solving_ability' | 'problem_solving_strategy';
export type EdgeRelation = 'parent_child' | 'prerequisite' | 'related';

// ---------- 通用响应包 ----------
/** 所有 REST 接口统一响应:code=0 成功,非 0 为业务错误码 */
export interface ApiResp<T> { code: number; message: string; data: T }
export interface PageResp<T> { items: T[]; total: number }
export interface PageQuery { page?: number; size?: number; keyword?: string }

// ---------- 实体 DTO(API 视图,字段驼峰) ----------
export interface MeDto {
  id: number; orgId: number; role: Role; name: string;
  orgName: string; orgSettings: OrgSettings;
}
export interface OrgSettings {
  ai: { qaGuideOnly: boolean; preGrading: boolean };
  studentHours: { start: string; end: string };
  deviceBinding: boolean;
}
export interface TeacherDto {
  id: number; name: string; teacherNo: string; phone: string;
  stage: string; subject: string; status: UserStatus;
  courseCount: number; questionCount: number; resourceCount: number;
}
export interface StudentDto {
  id: number; name: string; studentNo: string; parentPhone: string;
  grade: string; status: UserStatus;
  courses: { id: number; name: string; classType: ClassType }[];
  device: { name: string; boundAt: string } | null;
  weekStudySec: number;
}
export interface CourseDto {
  id: number; name: string; classType: ClassType; subject: string; stage: string;
  teacherId: number; teacherName: string; totalLessons: number; currentLesson: number;
  studentCount: number; status: CourseStatus;
  nextLessonAt: string | null; attendanceRate: number | null; homeworkRate: number | null;
}
export interface LessonDto {
  id: number; courseId: number; seq: number; title: string;
  scheduledStart: string | null; scheduledEnd: string | null;
  status: LessonStatus; prepChecklist: Record<string, boolean>;
}
export interface LessonSegmentDto {
  id?: number; seq: number; type: SegmentType; durationMin: number;
  config: Record<string, unknown>; resourceId: number | null; paperId: number | null;
}
export interface ResourceDto {
  id: number; type: ResourceType; name: string; ossKey: string; size: number;
  meta: Record<string, unknown>; usedByLessons: { lessonId: number; lessonTitle: string }[];
  createdAt: string;
}
export interface KpGraphDto { id: number; code: string; graphType: GraphType; subject: string; nodeCount: number }
export interface KpNodeDto {
  id: number; graphId: number; code: string; name: string;
  parentCode: string | null; level: number | null; category: string | null;
  grade: string | null; chapter: string | null; section: string | null;
  difficulty: number | null; examWeight: number | null; summary: string | null;
}
export interface QuestionOptionDto { label: string; contentLatex: string; isCorrect?: boolean }
export interface RubricStep { step: number; desc: string; score: number }
/**
 * 题目插图(方案 A,2026-06-13 批准):一张图通过 anchor 标明归属位置。
 * anchor 缺省 = 题干(向后兼容旧数据);option/rubric 用 ref 指明第几项(选项 label / rubric step)。
 * figures 仍是题目级 Json 数组,无需数据库迁移。
 */
export interface QuestionFigure {
  ossKey: string;
  position: number;
  anchor?: { target: 'stem' | 'option' | 'analysis' | 'reference' | 'rubric'; ref?: string };
}
export interface QuestionDto {
  id: number; type: QuestionType; stage: string; subject: string;
  textbookVersion: string | null; chapter: string | null;
  stemLatex: string; figures: QuestionFigure[];
  options: QuestionOptionDto[]; // 学生视图不含 isCorrect
  answer: QuestionAnswer | null; // 学生作答中不下发
  rubric: RubricStep[]; analysisLatex: string | null;
  difficulty: number; status: QuestionStatus;
  tags: { nodeId: number; graphType: GraphType; code: string; name: string }[];
  stats: { correctRate: number | null; usedInPapers: number };
  ownerName: string; createdAt: string;
}
export type QuestionAnswer =
  | { choice: string } | { choices: string[] }
  | { texts: string[] } | { referenceLatex: string };
export interface PaperDto {
  id: number; name: string; type: PaperType; totalScore: number; status: string;
  questions: { seq: number; questionId: number; score: number; type: QuestionType; stemLatex: string }[];
}
export interface AssignmentDto {
  id: number; paperId: number; paperName: string; lessonId: number | null;
  kind: AssignmentKind; target: { courseId?: number; studentIds?: number[] };
  publishAt: string; dueAt: string | null; scoreCounted: boolean;
  questionCount: number; totalScore: number;
}
export interface AttemptDto {
  id: number; assignmentId: number; status: AttemptStatus; attemptNo: number;
  startedAt: string; submittedAt: string | null;
  score: number | null; objectiveScore: number | null; subjectiveScore: number | null;
  answers: AnswerDto[];
}
export interface AnswerDto {
  questionId: number; response: AnswerResponse | null;
  isCorrect: boolean | null; score: number | null; flagged: boolean;
}
export type AnswerResponse =
  | { choice: string } | { choices: string[] }
  | { texts: string[] } | { photoOssKey: string } | { text: string };
export interface GradingItemDto {
  answerId: number; studentId: number; studentName: string;
  questionId: number; stemLatex: string; rubric: RubricStep[];
  photoUrl: string | null; textResponse: string | null;
  aiScore: number | null; aiSteps: { step: number; ok: boolean; comment?: string }[];
  aiErrorTags: string[]; finalScore: number | null; comment: string | null;
}
export interface WrongBookItemDto {
  id: number; questionId: number; type: QuestionType; stemLatex: string;
  analysisLatex: string | null; wrongCount: number; correctRedoCount: number;
  errorTags: string[]; status: WrongStatus; sourceName: string; createdAt: string;
  subject: string; // [2026-06-13 批准] 错题本按学科分组;源自题目 subject
}
export interface MasteryItemDto { nodeId: number; nodeName: string; graphType: GraphType; mastery: number; sampleCount: number }
export interface AiUsageSummaryDto {
  period: string; totalTokens: number; totalCost: number;
  monthlyLimit: number; usedPercent: number; avgCostPerLesson: number | null;
}
export interface AiUsageBreakdownDto { key: string; label: string; tokens: number; cost: number; percent: number }
