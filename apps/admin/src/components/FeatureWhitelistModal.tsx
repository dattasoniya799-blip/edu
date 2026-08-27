/**
 * 内测白名单编辑弹窗(E1):按功能的面向角色复用现有用户列表接口选人。
 *   teacher 向 → GET /admin/teachers;student 向 → GET /admin/students(单页上限 50,同 RosterModal)
 * 保存 = PUT /admin/features/{key}/whitelist,replace 语义(整表覆写,清空 = 传空数组)。
 * 选中集跨页保留:名单里的人可能不在当前页,勾选状态与列表分页解耦。
 */
import { useCallback, useEffect, useState } from 'react';
import type { AdminFeatureDto } from '@qiming/contracts';
import { Button, EmptyState, Modal, Skeleton, Tag, useToast } from '@qiming/ui';
import { api } from '../api';
import { TextInput } from './controls';
import { Pager } from './Pager';

/** 后端 GET /admin/students 单页上限 50(超限 400),教师列表沿用同一口径 */
const PAGE_SIZE = 50;

interface Candidate {
  id: number;
  name: string;
  /** 副标题:教师用工号 + 学科,学生用学号 + 年级 */
  sub: string;
}

export interface FeatureWhitelistModalProps {
  /** 为 null 时关闭 */
  feature: AdminFeatureDto | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function FeatureWhitelistModal({ feature, onClose, onSaved }: FeatureWhitelistModalProps) {
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Map<number, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const audienceRole = feature?.audienceRole;

  const load = useCallback(async (p: number, kw: string) => {
    if (!audienceRole) return;
    setItems(null);
    setError(false);
    const query = { page: p, size: PAGE_SIZE, ...(kw.trim() ? { keyword: kw.trim() } : {}) };
    try {
      if (audienceRole === 'student') {
        const r = await api.get('/admin/students', { query });
        setItems(r.data.items.map((s) => ({ id: s.id, name: s.name, sub: `${s.studentNo} · ${s.grade}` })));
        setTotal(r.data.total);
      } else {
        const r = await api.get('/admin/teachers', { query });
        setItems(r.data.items.map((t) => ({ id: t.id, name: t.name, sub: `${t.teacherNo} · ${t.subject}` })));
        setTotal(r.data.total);
      }
    } catch {
      setError(true);
      setItems(null);
    }
  }, [audienceRole]);

  // 打开时:用当前名单回填选中集,拉第一页候选
  useEffect(() => {
    if (!feature) return;
    setSelected(new Map(feature.whitelist.map((w) => [w.userId, w.name])));
    setKeyword('');
    setPage(1);
    void load(1, '');
  }, [feature, load]);

  // 关键字防抖服务端搜索(>50 人也能搜到)
  useEffect(() => {
    if (!feature) return;
    const t = setTimeout(() => { setPage(1); void load(1, keyword); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const toggle = (c: Candidate) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id); else next.set(c.id, c.name);
      return next;
    });

  const save = async () => {
    if (!feature) return;
    setBusy(true);
    try {
      await api.put('/admin/features/{key}/whitelist', {
        params: { key: feature.key },
        body: { userIds: [...selected.keys()] },
      });
      toast(selected.size === 0
        ? `「${feature.name}」白名单已清空`
        : `「${feature.name}」白名单已保存(${selected.size} 人)`);
      await onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败,请重试');
    } finally {
      setBusy(false);
    }
  };

  const goPage = (p: number) => { setPage(p); void load(p, keyword); };

  return (
    <Modal
      open={feature != null}
      title={feature ? `编辑白名单 · ${feature.name}` : ''}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? '保存中…' : `保存名单 (${selected.size})`}
          </Button>
        </>
      }
    >
      {feature && (
        <>
          <div className="mb-3 rounded-[10px] bg-bg px-3.5 py-2.5 text-xs leading-relaxed text-ink-2">
            白名单只在「内测」阶段生效:名单内的{feature.audienceRole === 'student' ? '学生' : '教师'}可见可用,名单外一律拦截。
            保存为整表覆写,取消全部勾选即清空名单。
          </div>
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {[...selected].map(([id, name]) => <Tag key={id} tone="primary">{name}</Tag>)}
            </div>
          )}
          <div className="mb-3">
            <TextInput
              className="w-full"
              placeholder={feature.audienceRole === 'student' ? '搜索姓名 / 学号' : '搜索姓名 / 手机号 / 工号'}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          {error ? (
            <EmptyState
              icon="!"
              text="用户列表加载失败"
              hint="请检查网络后重试"
              action={<Button variant="primary" onClick={() => void load(page, keyword)}>重新加载</Button>}
            />
          ) : items == null ? (
            <Skeleton className="h-40 w-full" lines={5} />
          ) : items.length === 0 ? (
            <EmptyState icon="✓" text={keyword.trim() ? '没有匹配的用户' : '机构内暂无该角色用户'} />
          ) : (
            <>
              <div className="flex max-h-[46vh] flex-col gap-1.5 overflow-auto">
                {items.map((c) => {
                  const checked = selected.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggle(c)}
                      className={`flex items-center justify-between rounded-md border-[1.5px] px-3.5 py-2.5 text-left text-[13.5px] ${
                        checked ? 'border-primary bg-primary-soft font-bold text-primary' : 'border-line hover:border-ink-3'
                      }`}
                    >
                      <span>{c.name} <span className="text-xs font-normal text-ink-3">· {c.sub}</span></span>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-[6px] border ${checked ? 'border-primary bg-primary text-card' : 'border-line'}`}>
                        {checked ? '✓' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
              {total > PAGE_SIZE && <Pager page={page} size={PAGE_SIZE} total={total} onChange={goPage} />}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
