-- 0003_ai_feature_courseware(经用户批准的 schema 变更):
-- "AI 生成课件"作为第 5 个 AI 功能进枚举,供 ai_usage_logs.feature 记账与运行态真假路由使用。
-- 无表结构变化:仅给已有枚举类型 "AiFeature" 追加值(追加在末尾,不影响既有值的顺序与序数)。
-- 事务限制:PG 的 ALTER TYPE ... ADD VALUE 新增的值不能在同一事务里被引用,
-- 故本迁移刻意只放这一条语句、且不自带 BEGIN/COMMIT —— 按 0001/0002 的口径由
-- psql -v ON_ERROR_STOP=1 -f 逐条自动提交执行(prisma migrate 单文件事务下同样安全)。
-- IF NOT EXISTS 使重复执行(如已用 prisma migrate dev 重新生成过枚举)幂等不报错。
ALTER TYPE "AiFeature" ADD VALUE IF NOT EXISTS 'courseware';
