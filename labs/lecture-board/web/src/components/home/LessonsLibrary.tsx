/**
 * 首页课程库:GET /api/lessons(已按 createdAt 倒序),学科筛选 + 关键词搜索,
 * 生成中的课每 5 秒轻量轮询刷新状态(见 lib/home.ts 的 isPending)。
 */
import { useEffect, useRef, useState } from 'react';
import { fetchLessons, type LessonListItem } from '../../lib/api';
import { filterLessons, formatRelativeTime, isPending, stageKind, stageLabel, stageProgress, subjectLabel, type SubjectFilter } from '../../lib/home';

const TABS: Array<{ key: SubjectFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'math', label: '数学' },
  { key: 'physics', label: '物理' },
  { key: 'chemistry', label: '化学' },
];

export function LessonsLibrary({ onOpen }: { onOpen(id: string): void }) {
  const [items, setItems] = useState<LessonListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState<SubjectFilter>('all');
  const [query, setQuery] = useState('');
  const itemsRef = useRef<LessonListItem[] | null>(null);
  itemsRef.current = items;

  const load = () => {
    fetchLessons()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    load();
  }, []);

  // 有课还在生成中就每 5 秒刷新一次;都定型了(ready/failed)就停。
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (itemsRef.current?.some(isPending)) load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = items ? filterLessons(items, subject, query) : null;

  return (
    <section className="section lessons-section">
      <div className="section-head">
        <h2 className="section-title">课程库</h2>
        <p className="section-sub">已经生成过的课,随时回去看讲解。</p>
      </div>

      <div className="lessons-toolbar">
        <div className="subject-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`subject-tab ${subject === t.key ? 'is-active' : ''}`}
              onClick={() => setSubject(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="lessons-search"
          type="text"
          placeholder="搜标题或摘要…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && <div className="alert">课程库读取失败:{error}</div>}

      {!items ? (
        <p className="section-sub">加载中…</p>
      ) : filtered && filtered.length === 0 ? (
        <p className="lessons-empty">{items.length === 0 ? '还没有生成过课,上传一道题或试讲一道示例题吧。' : '没有匹配的课程。'}</p>
      ) : (
        <div className="lesson-grid">
          {filtered?.map((item) => {
            const kind = stageKind(item.stage);
            return (
              <article className="lesson-card" key={item.id}>
                <div className="lesson-thumb">
                  {item.thumb ? <img src={item.thumb} alt={item.title ?? item.id} loading="lazy" /> : <div className="lesson-thumb-empty" />}
                  {item.subject && <span className={`subject-badge subject-${item.subject}`}>{subjectLabel(item.subject)}</span>}
                </div>
                <div className="lesson-body">
                  <h3 className="lesson-title">{item.title ?? item.id}</h3>
                  <div className="lesson-meta">
                    <span className={`status-dot status-${kind}`} />
                    <span className="lesson-status-label">{stageLabel(item.stage)}</span>
                    <span className="lesson-time">{formatRelativeTime(item.createdAt)}</span>
                  </div>
                  {kind === 'pending' && (
                    <div className="lesson-progress">
                      <div className="lesson-progress-bar" style={{ width: `${stageProgress(item.stage)}%` }} />
                    </div>
                  )}
                  <button className="btn-secondary" disabled={kind === 'failed'} onClick={() => onOpen(item.id)}>
                    {kind === 'failed' ? '生成失败' : kind === 'pending' ? '看进度' : '看讲解'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
