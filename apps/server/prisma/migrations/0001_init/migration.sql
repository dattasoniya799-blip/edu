-- 启明智学 0001_init · 与 prisma/schema.prisma 等价的 DDL
-- 枚举
CREATE TYPE "Role" AS ENUM ('admin','teacher','student');
CREATE TYPE "OrgStatus" AS ENUM ('active','suspended');
CREATE TYPE "UserStatus" AS ENUM ('active','disabled','pending');
CREATE TYPE "ClassType" AS ENUM ('group','one_on_one','one_on_three');
CREATE TYPE "CourseStatus" AS ENUM ('draft','ongoing','finished','archived');
CREATE TYPE "LessonStatus" AS ENUM ('draft','ready','in_progress','finished');
CREATE TYPE "SegmentType" AS ENUM ('warmup','lecture','practice','summary','homework','break_time');
CREATE TYPE "ResourceType" AS ENUM ('ppt','pdf','video','interactive','image');
CREATE TYPE "QuestionType" AS ENUM ('single','multi','blank','solution');
CREATE TYPE "QuestionScope" AS ENUM ('private','shared');
CREATE TYPE "QuestionStatus" AS ENUM ('draft','published','retired');
CREATE TYPE "PaperType" AS ENUM ('homework','exam','practice');
CREATE TYPE "AssignmentKind" AS ENUM ('homework','in_class','correction','wrong_redo','consolidation');
CREATE TYPE "AttemptStatus" AS ENUM ('in_progress','submitted','graded');
CREATE TYPE "WrongStatus" AS ENUM ('open','cleared');
CREATE TYPE "SessionStatus" AS ENUM ('scheduled','live','paused','ended');
CREATE TYPE "ParticipantState" AS ENUM ('normal','stuck','hand_up','offline');
CREATE TYPE "AiFeature" AS ENUM ('class_companion','qa','pre_grading','diagnosis');
CREATE TYPE "GraphType" AS ENUM ('curriculum_knowledge','problem_solving_ability','problem_solving_strategy');
CREATE TYPE "EdgeRelation" AS ENUM ('parent_child','prerequisite','related');

CREATE TABLE orgs (
  id BIGSERIAL PRIMARY KEY, name VARCHAR(64) NOT NULL,
  status "OrgStatus" NOT NULL DEFAULT 'active', settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES orgs(id),
  role "Role" NOT NULL, name VARCHAR(32) NOT NULL, phone VARCHAR(64),
  password_hash TEXT, status "UserStatus" NOT NULL DEFAULT 'active',
  teacher_no VARCHAR(20), student_no VARCHAR(20), profile JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (org_id, teacher_no), UNIQUE (org_id, student_no));
CREATE INDEX idx_users_org_role ON users(org_id, role);

CREATE TABLE devices (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  student_id BIGINT NOT NULL UNIQUE REFERENCES users(id),
  device_fingerprint TEXT NOT NULL, device_name TEXT,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ);
CREATE INDEX idx_devices_org ON devices(org_id);

CREATE TABLE login_tickets (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  student_id BIGINT NOT NULL, token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_tickets_org_stu ON login_tickets(org_id, student_id);

CREATE TABLE courses (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES orgs(id),
  name VARCHAR(64) NOT NULL, class_type "ClassType" NOT NULL,
  subject VARCHAR(16) NOT NULL, stage VARCHAR(16) NOT NULL,
  teacher_id BIGINT NOT NULL, total_lessons INT NOT NULL,
  schedule_rule JSONB NOT NULL DEFAULT '{}', status "CourseStatus" NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ);
CREATE INDEX idx_courses_org_teacher ON courses(org_id, teacher_id);

CREATE TABLE course_students (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  course_id BIGINT NOT NULL REFERENCES courses(id),
  student_id BIGINT NOT NULL REFERENCES users(id),
  status VARCHAR(12) NOT NULL DEFAULT 'active',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, course_id, student_id));

CREATE TABLE lessons (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  course_id BIGINT NOT NULL REFERENCES courses(id), seq INT NOT NULL,
  title VARCHAR(128) NOT NULL, scheduled_start TIMESTAMPTZ, scheduled_end TIMESTAMPTZ,
  status "LessonStatus" NOT NULL DEFAULT 'draft', prep_checklist JSONB NOT NULL DEFAULT '{}',
  opening_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, seq));
CREATE INDEX idx_lessons_org ON lessons(org_id);

CREATE TABLE resources (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL, owner_id BIGINT NOT NULL,
  kp_node_id BIGINT, -- FK 见下方 kp_nodes 建表后的 ALTER(resources 早于 kp_nodes 建表)
  type "ResourceType" NOT NULL, name VARCHAR(128) NOT NULL, oss_key TEXT NOT NULL,
  size BIGINT NOT NULL DEFAULT 0, meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ);
CREATE INDEX idx_resources_org_owner ON resources(org_id, owner_id);

CREATE TABLE kp_graphs (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL, code VARCHAR(64) NOT NULL,
  graph_type "GraphType" NOT NULL, subject VARCHAR(16) NOT NULL,
  grade_range JSONB NOT NULL DEFAULT '[]', metadata JSONB NOT NULL DEFAULT '{}',
  version INT NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code));

CREATE TABLE kp_nodes (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  graph_id BIGINT NOT NULL REFERENCES kp_graphs(id),
  code VARCHAR(64) NOT NULL, name VARCHAR(128) NOT NULL,
  parent_code VARCHAR(64), level INT, category VARCHAR(32),
  grade VARCHAR(16), chapter VARCHAR(64), section VARCHAR(16),
  difficulty SMALLINT, exam_weight NUMERIC(4,2),
  ability_tags JSONB NOT NULL DEFAULT '[]', summary TEXT, content TEXT,
  source_refs JSONB NOT NULL DEFAULT '[]', version INT NOT NULL DEFAULT 1,
  UNIQUE (graph_id, code));
CREATE INDEX idx_kpnodes_org_grade_ch ON kp_nodes(org_id, grade, chapter);
-- resources.kp_node_id FK(resources 建表早于 kp_nodes,故此处补外键)
ALTER TABLE resources ADD CONSTRAINT resources_kp_node_id_fkey FOREIGN KEY (kp_node_id) REFERENCES kp_nodes(id);

CREATE TABLE kp_edges (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  graph_id BIGINT NOT NULL REFERENCES kp_graphs(id),
  from_node_id BIGINT NOT NULL REFERENCES kp_nodes(id),
  to_node_id BIGINT NOT NULL REFERENCES kp_nodes(id),
  relation "EdgeRelation" NOT NULL, confidence NUMERIC(4,2), rationale TEXT,
  UNIQUE (graph_id, from_node_id, to_node_id, relation));
CREATE INDEX idx_kpedges_org ON kp_edges(org_id);

CREATE TABLE questions (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL, owner_id BIGINT NOT NULL,
  scope "QuestionScope" NOT NULL DEFAULT 'shared', type "QuestionType" NOT NULL,
  stage VARCHAR(16) NOT NULL, subject VARCHAR(16) NOT NULL,
  textbook_version VARCHAR(32), chapter VARCHAR(64),
  stem_latex TEXT NOT NULL, figures JSONB NOT NULL DEFAULT '[]',
  answer JSONB NOT NULL, rubric JSONB NOT NULL DEFAULT '[]', analysis_latex TEXT,
  analysis_brief_latex TEXT, analysis_detail_latex TEXT,
  difficulty SMALLINT NOT NULL DEFAULT 2, status "QuestionStatus" NOT NULL DEFAULT 'draft',
  stats JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ);
CREATE INDEX idx_questions_org_sub_status ON questions(org_id, subject, status);

CREATE TABLE question_options (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  question_id BIGINT NOT NULL REFERENCES questions(id),
  label VARCHAR(4) NOT NULL, content_latex TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (question_id, label));

CREATE TABLE question_tags (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  question_id BIGINT NOT NULL REFERENCES questions(id),
  node_id BIGINT NOT NULL REFERENCES kp_nodes(id),
  UNIQUE (question_id, node_id));
CREATE INDEX idx_qtags_org_node ON question_tags(org_id, node_id);

CREATE TABLE papers (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL, creator_id BIGINT NOT NULL,
  name VARCHAR(128) NOT NULL, type "PaperType" NOT NULL,
  total_score NUMERIC(6,1) NOT NULL DEFAULT 0, status VARCHAR(12) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_papers_org_creator ON papers(org_id, creator_id);

CREATE TABLE paper_questions (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  paper_id BIGINT NOT NULL REFERENCES papers(id),
  question_id BIGINT NOT NULL REFERENCES questions(id),
  seq INT NOT NULL, score NUMERIC(5,1) NOT NULL,
  UNIQUE (paper_id, seq), UNIQUE (paper_id, question_id));

-- 知识点内容库:讲解课件/随堂练卷/小结模板(每机构每知识点一份);建表在 kp_nodes/resources/papers 之后
CREATE TABLE kp_content_packs (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  kp_node_id BIGINT NOT NULL REFERENCES kp_nodes(id),
  lecture_resource_id BIGINT REFERENCES resources(id),
  practice_paper_id BIGINT REFERENCES papers(id),
  summary_config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, kp_node_id));
CREATE INDEX idx_kp_content_packs_org ON kp_content_packs(org_id);

CREATE TABLE lesson_segments (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  lesson_id BIGINT NOT NULL REFERENCES lessons(id), seq INT NOT NULL,
  type "SegmentType" NOT NULL, duration_min INT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  resource_id BIGINT REFERENCES resources(id), paper_id BIGINT REFERENCES papers(id),
  kp_node_id BIGINT REFERENCES kp_nodes(id),
  unit_seq INT,
  UNIQUE (lesson_id, seq));
CREATE INDEX idx_segments_org ON lesson_segments(org_id);

CREATE TABLE assignments (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  paper_id BIGINT NOT NULL REFERENCES papers(id),
  lesson_id BIGINT REFERENCES lessons(id),
  kind "AssignmentKind" NOT NULL, target JSONB NOT NULL,
  publish_at TIMESTAMPTZ NOT NULL DEFAULT now(), due_at TIMESTAMPTZ,
  grading_policy JSONB NOT NULL DEFAULT '{}', score_counted BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_assignments_org_lesson ON assignments(org_id, lesson_id);

CREATE TABLE attempts (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  assignment_id BIGINT NOT NULL REFERENCES assignments(id),
  student_id BIGINT NOT NULL REFERENCES users(id),
  attempt_no INT NOT NULL DEFAULT 1, status "AttemptStatus" NOT NULL DEFAULT 'in_progress',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(), submitted_at TIMESTAMPTZ,
  score NUMERIC(6,1), objective_score NUMERIC(6,1), subjective_score NUMERIC(6,1),
  duration_sec INT,
  UNIQUE (assignment_id, student_id, attempt_no));
CREATE INDEX idx_attempts_org_stu ON attempts(org_id, student_id);

CREATE TABLE answers (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  attempt_id BIGINT NOT NULL REFERENCES attempts(id),
  question_id BIGINT NOT NULL REFERENCES questions(id),
  response JSONB NOT NULL, is_correct BOOLEAN, score NUMERIC(5,1),
  flagged BOOLEAN NOT NULL DEFAULT false, time_spent_sec INT,
  ai_help_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id));
CREATE INDEX idx_answers_org_q ON answers(org_id, question_id);

CREATE TABLE grading_records (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  answer_id BIGINT NOT NULL UNIQUE REFERENCES answers(id),
  ai_score NUMERIC(5,1), ai_steps JSONB NOT NULL DEFAULT '[]',
  ai_error_tags JSONB NOT NULL DEFAULT '[]',
  final_score NUMERIC(5,1), reviewer_id BIGINT, comment TEXT, reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_grading_org ON grading_records(org_id);

CREATE TABLE wrong_book_entries (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  student_id BIGINT NOT NULL REFERENCES users(id),
  question_id BIGINT NOT NULL,
  source_answer_id BIGINT NOT NULL REFERENCES answers(id),
  wrong_count INT NOT NULL DEFAULT 1, correct_redo_count INT NOT NULL DEFAULT 0,
  error_tags JSONB NOT NULL DEFAULT '[]', status "WrongStatus" NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, question_id));
CREATE INDEX idx_wrong_org_stu_status ON wrong_book_entries(org_id, student_id, status);

CREATE TABLE mastery_snapshots (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  student_id BIGINT NOT NULL REFERENCES users(id),
  node_id BIGINT NOT NULL REFERENCES kp_nodes(id),
  mastery INT NOT NULL DEFAULT 0, sample_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, node_id));
CREATE INDEX idx_mastery_org_stu ON mastery_snapshots(org_id, student_id);

CREATE TABLE class_sessions (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  lesson_id BIGINT NOT NULL REFERENCES lessons(id),
  status "SessionStatus" NOT NULL DEFAULT 'scheduled',
  actual_start TIMESTAMPTZ, actual_end TIMESTAMPTZ, mode JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_sessions_org_lesson ON class_sessions(org_id, lesson_id);

CREATE TABLE session_participants (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  session_id BIGINT NOT NULL REFERENCES class_sessions(id),
  student_id BIGINT NOT NULL, join_at TIMESTAMPTZ, leave_at TIMESTAMPTZ,
  current_segment INT, progress JSONB NOT NULL DEFAULT '{}',
  state "ParticipantState" NOT NULL DEFAULT 'normal',
  UNIQUE (session_id, student_id));
CREATE INDEX idx_participants_org ON session_participants(org_id);

CREATE TABLE session_events (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  session_id BIGINT NOT NULL REFERENCES class_sessions(id),
  student_id BIGINT, type VARCHAR(32) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}', ts TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_events_session_ts ON session_events(session_id, ts);
CREATE INDEX idx_events_org ON session_events(org_id);

CREATE TABLE ai_calls (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  feature "AiFeature" NOT NULL, user_id BIGINT, session_id BIGINT,
  course_id BIGINT, lesson_id BIGINT,
  provider VARCHAR(32) NOT NULL, model VARCHAR(64) NOT NULL,
  tokens_in INT NOT NULL, tokens_out INT NOT NULL, cost NUMERIC(10,4) NOT NULL,
  latency_ms INT, status VARCHAR(16) NOT NULL DEFAULT 'ok',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_aicalls_org_time ON ai_calls(org_id, created_at);
CREATE INDEX idx_aicalls_org_feature ON ai_calls(org_id, feature);

CREATE TABLE ai_quotas (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  period VARCHAR(7) NOT NULL, monthly_limit NUMERIC(10,2) NOT NULL,
  alert_threshold INT NOT NULL DEFAULT 80,
  over_policy VARCHAR(24) NOT NULL DEFAULT 'disable_qa',
  used_cost NUMERIC(10,4) NOT NULL DEFAULT 0,
  UNIQUE (org_id, period));

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL,
  actor_id BIGINT NOT NULL, action VARCHAR(48) NOT NULL,
  target_type VARCHAR(32), target_id BIGINT,
  detail JSONB NOT NULL DEFAULT '{}', ip VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX idx_audit_org_time ON audit_logs(org_id, created_at);
