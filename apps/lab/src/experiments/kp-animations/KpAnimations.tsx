/**
 * 「知识点动画」车间页:读 public/animations/manifest.json 列目录,点一个在沙箱 iframe 里试玩。
 * manifest 由 `npm run validate:anim` 生成,这里不做任何校验,只忠实显示校验结果。
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Tag } from '@qiming/ui';

interface AnimMeta {
  grade: string;
  topic: string;
  difficulty: string;
  cognitive: string;
  desc: string;
  kpNodeId: string;
}

interface AnimItem {
  path: string;
  title: string;
  grade: string;
  meta: AnimMeta;
  sizeKB: number;
  validation: { ok: boolean; checked: number; issues: string[] };
}

interface Manifest {
  generatedAt: string;
  total: number;
  passed: number;
  rules: { id: string; label: string }[];
  items: AnimItem[];
}

const GRADES = ['全部', '初中', '高中'] as const;
type GradeFilter = (typeof GRADES)[number];

const BASE = import.meta.env.BASE_URL || '/';

export function KpAnimations() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState<GradeFilter>('全部');
  const [activePath, setActivePath] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${BASE}animations/manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Manifest) => { if (alive) setManifest(data); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  const items = useMemo(
    () => (manifest?.items ?? []).filter((i) => grade === '全部' || i.grade === grade),
    [manifest, grade],
  );
  const active = manifest?.items.find((i) => i.path === activePath) ?? null;

  if (error) {
    return (
      <EmptyState
        icon="⚠️"
        text={`读不到 manifest.json(${error})`}
        hint="先在 apps/lab 跑一次 npm run validate:anim 生成 public/animations/manifest.json。"
      />
    );
  }
  if (!manifest) return <div className="p-4 text-[13px] text-ink-2">正在读 manifest…</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <div className="flex gap-1.5">
          {GRADES.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrade(g)}
              className={`rounded-pill border px-3 py-1 text-xs transition-colors ${
                grade === g ? 'border-primary bg-primary-soft text-primary' : 'border-line text-ink-2 hover:border-ink-3'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
        <span className="ml-auto">
          校验 {manifest.passed}/{manifest.total} 通过 · {manifest.rules.length} 项检查 · 生成于 {manifest.generatedAt}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="🎬" text="这个学段还没有动画" hint="按 skills/知识点动画-skill.md 生成后放进 public/animations/{初中|高中}/。" />
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {items.map((i) => {
            const selected = i.path === activePath;
            return (
              <button
                key={i.path}
                type="button"
                onClick={() => setActivePath(selected ? null : i.path)}
                className={`rounded-lg border-[1.5px] bg-card p-3.5 text-left shadow-card transition-all ${
                  selected ? 'border-primary' : 'border-line hover:border-ink-3'
                }`}
              >
                <div className="flex items-center gap-2">
                  <b className="text-sm">{i.title}</b>
                  <Tag tone={i.validation.ok ? 'green' : 'red'} className="ml-auto">
                    {i.validation.ok ? '校验通过' : '校验失败'}
                  </Tag>
                </div>
                <div className="mt-1 text-xs leading-5 text-ink-2">{i.meta.desc}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Tag tone="primary">{i.meta.grade}</Tag>
                  <Tag tone="orange">{i.meta.cognitive}</Tag>
                  <Tag tone="violet">难度 {i.meta.difficulty}</Tag>
                </div>
                <div className="mt-1.5 text-xs text-ink-3">
                  {i.meta.topic} · {i.sizeKB}KB · 图谱节点 {i.meta.kpNodeId || '未挂载'}
                </div>
                {!i.validation.ok && (
                  <ul className="mt-1.5 list-inside list-disc text-xs text-red">
                    {i.validation.issues.map((msg) => <li key={msg}>{msg}</li>)}
                  </ul>
                )}
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <b className="text-sm">{active.title}</b>
            <span className="text-xs text-ink-3">iframe sandbox=&quot;allow-scripts&quot; 预览</span>
            <a
              className="ml-auto text-xs text-primary underline"
              href={`${BASE}${active.path}`}
              target="_blank"
              rel="noreferrer"
            >
              单独打开
            </a>
            <Button onClick={() => setActivePath(null)}>收起预览</Button>
          </div>
          <iframe
            key={active.path}
            title={active.title}
            src={`${BASE}${active.path}`}
            sandbox="allow-scripts"
            className="h-[720px] w-full rounded-lg border border-line bg-bg"
          />
          <p className="text-xs leading-5 text-ink-3">
            人审重点:数学有没有错、首屏是不是只剩最小可理解单元、反馈文案有没有真的说出不变量。
          </p>
        </div>
      )}
    </div>
  );
}
