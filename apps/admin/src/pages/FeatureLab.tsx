/**
 * 实验室管理(运维)· 功能三级流水线的登记与放行台(E1)
 *
 * 目录由服务端静态注册表下发(GET /admin/features),这里只做两件事:
 *   ① 切阶段 off / beta / ga —— PUT /admin/features/{key},改完即时对全机构生效;
 *   ② 编辑内测白名单 —— PUT /admin/features/{key}/whitelist(replace 语义)。
 * 每条功能的登记说明(已知缺陷 / 转正验收条件)在详情区展开看,转正与否照它判。
 */
import { useCallback, useEffect, useState } from 'react';
import type { AdminFeatureDto, FeatureStage, Role } from '@qiming/contracts';
import { Button, Card, EmptyState, Skeleton, Table, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { LinkButton, Select } from '../components/controls';
import { FeatureWhitelistModal } from '../components/FeatureWhitelistModal';
import { PageHead } from './Shell';

const STAGE_OPTIONS: { value: FeatureStage; label: string }[] = [
  { value: 'off', label: '未开放(仅登记)' },
  { value: 'beta', label: '内测(白名单)' },
  { value: 'ga', label: '正式(全量)' },
];

const STAGE_TAG: Record<FeatureStage, { tone: 'gray' | 'violet' | 'green'; label: string }> = {
  off: { tone: 'gray', label: '未开放' },
  beta: { tone: 'violet', label: '内测' },
  ga: { tone: 'green', label: '正式' },
};

const ROLE_LABEL: Record<Role, string> = { admin: '管理员', teacher: '教师', student: '学生' };

export function FeatureLab() {
  const [items, setItems] = useState<AdminFeatureDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  /** 正在提交阶段变更的 key(该行下拉锁住,避免连点发多次 PUT) */
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const r = await api.get('/admin/features');
      setItems(r.data);
    } catch {
      setFailed(true);
      setItems(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const changeStage = async (f: AdminFeatureDto, stage: FeatureStage) => {
    if (stage === f.stage) return;
    setSavingKey(f.key);
    try {
      await api.put('/admin/features/{key}', { params: { key: f.key }, body: { stage } });
      toast(`「${f.name}」已切到${STAGE_TAG[stage].label}${stage === 'beta' ? ',白名单内账号即刻可用' : ''}`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : '阶段切换失败,请重试');
    } finally {
      setSavingKey(null);
    }
  };

  const detail = items?.find((f) => f.key === detailKey) ?? null;
  const editing = items?.find((f) => f.key === editingKey) ?? null;

  return (
    <div>
      <PageHead
        title="实验室管理"
        sub="新功能一律先进目录:本地实验 → 系统内测(白名单)→ 正式 · 阶段与白名单的变更对全机构即时生效"
      />

      {failed ? (
        <Card>
          <EmptyState
            text="功能目录加载失败"
            hint="请检查后端或 mock 是否就绪"
            action={<Button variant="primary" onClick={() => void load()}>重试</Button>}
          />
        </Card>
      ) : items == null ? (
        <Skeleton className="h-[260px] w-full !rounded-lg" />
      ) : (
        <div className="flex flex-col gap-4">
          <Card bodyClassName="!p-0">
            <Table<AdminFeatureDto>
              rows={items}
              rowKey={(f) => f.key}
              emptyText="功能目录为空"
              columns={[
                {
                  key: 'name',
                  title: '功能',
                  render: (f) => (
                    <div>
                      <b>{f.name}</b>
                      <div className="mt-0.5 font-mono text-xs text-ink-3">{f.key}</div>
                    </div>
                  ),
                },
                { key: 'audienceRole', title: '面向角色', render: (f) => ROLE_LABEL[f.audienceRole] },
                {
                  key: 'stage',
                  title: '当前阶段',
                  render: (f) => (
                    <span className="flex items-center gap-2.5">
                      <Tag tone={STAGE_TAG[f.stage].tone}>{STAGE_TAG[f.stage].label}</Tag>
                      <Select
                        value={f.stage}
                        aria-label={`${f.name}阶段`}
                        disabled={savingKey === f.key}
                        onChange={(e) => void changeStage(f, e.target.value as FeatureStage)}
                      >
                        {STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Select>
                    </span>
                  ),
                },
                {
                  key: 'whitelist',
                  title: '白名单人数',
                  render: (f) => (
                    <span className={f.stage === 'beta' ? 'text-ink' : 'text-ink-3'}>
                      {f.whitelist.length} 人
                      {f.stage !== 'beta' && <span className="ml-1 text-xs">(非内测阶段不生效)</span>}
                    </span>
                  ),
                },
                {
                  key: 'ops',
                  title: '操作',
                  render: (f) => (
                    <span className="flex gap-3">
                      <LinkButton onClick={() => setEditingKey(f.key)}>编辑白名单</LinkButton>
                      <LinkButton onClick={() => setDetailKey(detailKey === f.key ? null : f.key)}>
                        {detailKey === f.key ? '收起详情' : '详情'}
                      </LinkButton>
                    </span>
                  ),
                },
              ]}
            />
          </Card>

          {detail && (
            <Card title={`${detail.name} · 登记详情`}>
              <div className="flex flex-col gap-4 text-[13px] leading-relaxed">
                <div>
                  <b className="text-ink">功能说明</b>
                  <p className="mt-1 text-ink-2">{detail.description}</p>
                </div>
                <div>
                  <b className="text-ink">已知缺陷(为什么还没转正)</b>
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-ink-2">
                    {detail.knownIssues.length === 0
                      ? <li>暂无登记</li>
                      : detail.knownIssues.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </div>
                <div>
                  <b className="text-ink">转正验收条件</b>
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-ink-2">
                    {detail.acceptance.length === 0
                      ? <li>暂无登记</li>
                      : detail.acceptance.map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </div>
                <div>
                  <b className="text-ink">当前白名单</b>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {detail.whitelist.length === 0
                      ? <span className="text-ink-3">名单为空</span>
                      : detail.whitelist.map((w) => (
                        <Tag key={w.userId} tone="primary">{w.name} · {ROLE_LABEL[w.role]}</Tag>
                      ))}
                  </div>
                </div>
                <div className="text-xs text-ink-3">
                  目录默认阶段:{STAGE_TAG[detail.defaultStage].label}(未做机构覆盖时按此生效)
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      <FeatureWhitelistModal
        feature={editing}
        onClose={() => setEditingKey(null)}
        onSaved={async () => { setEditingKey(null); await load(); }}
      />
    </div>
  );
}
