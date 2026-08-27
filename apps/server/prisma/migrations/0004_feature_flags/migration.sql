-- 0004_feature_flags(E1 内测区与功能分级,经用户批准 2026-08-27):
-- 功能三级流水线 off/beta/ga 的运行时管控落库。目录(key/名称/默认阶段/已知缺陷/验收条件)
-- 是代码内静态注册表(apps/server/src/features/feature-catalog.ts),库里只存两类覆盖值:
-- - feature_flags:机构对某 key 的阶段覆盖;无行 = 用目录 defaultStage。
--   stage 用 VARCHAR + 应用层校验(off/beta/ga),刻意不建 PG enum,避免后续加值的迁移负担。
-- - feature_access:beta 白名单(org 域,replace 语义整表覆写该 key 名单)。
CREATE TABLE feature_flags (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES orgs(id),
  key VARCHAR(64) NOT NULL, stage VARCHAR(16) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, key));

CREATE TABLE feature_access (
  id BIGSERIAL PRIMARY KEY, org_id BIGINT NOT NULL REFERENCES orgs(id),
  feature_key VARCHAR(64) NOT NULL,
  user_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, feature_key, user_id));
