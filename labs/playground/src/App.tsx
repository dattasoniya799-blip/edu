/**
 * 本地实验区首页(永不部署):实验清单 + 空态说明。
 * 清单来自 src/experiments/registry.ts;选中一条就在右侧渲染它自己的界面。
 */
import { useState } from 'react';
import { Button, Card, EmptyState, Tag } from '@qiming/ui';
import { EXPERIMENTS, type Experiment } from './experiments/registry';

const STATUS_TAG: Record<Experiment['status'], { tone: 'primary' | 'orange' | 'green'; label: string }> = {
  running: { tone: 'primary', label: '进行中' },
  parked: { tone: 'orange', label: '搁置' },
  done: { tone: 'green', label: '已结论' },
};

export function App() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = EXPERIMENTS.find((e) => e.id === activeId) ?? null;

  // 逐级进入、整页切换:选中实验后列表退场,实验占满整页;返回键回列表。
  // (三级页面——如动态讲义的上课页——由实验自己再做整页接管。)
  if (active) {
    const status = STATUS_TAG[active.status];
    return (
      <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-4 px-6 py-5">
        <header className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setActiveId(null)}>← 返回实验区</Button>
          <h1 className="text-[17px] font-extrabold">{active.title}</h1>
          <Tag tone={status.tone}>{status.label}</Tag>
          <Tag tone="red">永不部署</Tag>
        </header>
        <div className="min-h-0 flex-1">{active.render()}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1080px] flex-col gap-5 p-8">
      <header>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[21px] font-extrabold">本地实验区</h1>
          <Tag tone="red">永不部署</Tag>
        </div>
        <p className="mt-1.5 text-[13px] leading-6 text-ink-2">
          功能三级流水线的第一级:本地实验 → 系统内测(白名单)→ 正式。
          在这里试想法、搭一次性原型;跑通了再进服务端功能目录,以 off / beta 起步,由管理端「实验室管理」放行。
        </p>
      </header>

      {EXPERIMENTS.length === 0 ? (
        <Card>
          <EmptyState
            icon="🧪"
            text="还没有登记中的实验"
            hint="在 src/experiments/ 下建一个目录,再往 registry.ts 的 EXPERIMENTS 里加一条,这里就会列出来。做完记得连目录一起删。"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {EXPERIMENTS.map((e) => {
            const status = STATUS_TAG[e.status];
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setActiveId(e.id)}
                className="rounded-lg border-[1.5px] border-line bg-card p-4 text-left shadow-card transition-all hover:border-ink-3"
              >
                <div className="flex items-center gap-2">
                  <b className="text-sm">{e.title}</b>
                  <Tag tone={status.tone} className="ml-auto">{status.label}</Tag>
                </div>
                <div className="mt-1 text-xs leading-5 text-ink-2">{e.summary}</div>
                <div className="mt-1.5 text-xs text-ink-3">负责人 {e.owner} · 点击进入 →</div>
              </button>
            );
          })}
        </div>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-3 border-t border-line pt-4 text-xs text-ink-3">
        <span>仓库外的脚本 / 模型实验(OCR 精度测试、FSRS 模拟等)放工作区根目录的 _lab/。</span>
      </footer>
    </div>
  );
}
