-- 0002_assignment_teacher(经用户批准的 schema 变更):
-- assignments 加可空 teacher 锚点,修复「无 course 锚点作业任何教师可读」越权红线。
-- 类型与 users.id / courses.teacher_id 一致用 BIGINT;不加外键,对齐 courses.teacher_id 既有做法。
ALTER TABLE assignments ADD COLUMN teacher_id BIGINT;

CREATE INDEX idx_assignments_org_teacher ON assignments(org_id, teacher_id);

-- 存量回填:有 lesson_id 的作业经 lessons→courses 回填授课教师;
-- 其余(仅 target.courseId 锚点,或学生自发无锚点)留 NULL——
-- 读侧兼容规则:teacher_id IS NULL 且有课程锚点 → 按课程归属判定(回填前口径)。
UPDATE assignments a
SET teacher_id = c.teacher_id
FROM lessons l
JOIN courses c ON c.id = l.course_id
WHERE a.lesson_id = l.id
  AND a.teacher_id IS NULL;
