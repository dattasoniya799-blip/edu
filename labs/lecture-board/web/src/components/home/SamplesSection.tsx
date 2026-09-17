/** 首页「示例题目 · 一键试讲」:GET /api/samples 的 7 道题,卡片网格,点「试讲这道」直接建课并跳转。 */
import { useEffect, useState } from 'react';
import { createLessonFromSample, fetchSamples, type SampleSummary } from '../../lib/api';
import { subjectLabel } from '../../lib/home';

export function SamplesSection({ onCreated }: { onCreated(id: string): void }) {
  const [samples, setSamples] = useState<SampleSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [tryError, setTryError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSamples()
      .then((list) => alive && setSamples(list))
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const tryLecture = async (dir: string) => {
    setTryError(null);
    setPending(dir);
    try {
      const { id } = await createLessonFromSample(dir);
      onCreated(id);
    } catch (e) {
      setTryError(e instanceof Error ? e.message : String(e));
      setPending(null);
    }
  };

  return (
    <section className="section samples-section">
      <div className="section-head">
        <h2 className="section-title">示例题目 · 一键试讲</h2>
        <p className="section-sub">不想找题?挑一道验收过的真题,直接看鲸云AI怎么把它讲完。</p>
      </div>
      {loadError && <div className="alert">示例题读取失败:{loadError}</div>}
      {tryError && <div className="alert">{tryError}</div>}
      <div className="sample-grid">
        {(samples ?? Array.from({ length: 4 })).map((s, i) =>
          s ? (
            <article className="sample-card" key={s.dir}>
              <div className="sample-thumb">
                <img src={s.imageUrl} alt={s.title} loading="lazy" />
                <span className={`subject-badge subject-${s.subject}`}>{subjectLabel(s.subject)}</span>
              </div>
              <div className="sample-body">
                <h3 className="sample-title">{s.title}</h3>
                <p className="sample-answer">{s.answerPreview}</p>
                <button className="btn-secondary" disabled={pending === s.dir} onClick={() => void tryLecture(s.dir)}>
                  {pending === s.dir ? '正在建课…' : '试讲这道'}
                </button>
              </div>
            </article>
          ) : (
            <article className="sample-card is-skeleton" key={`skeleton-${i}`} aria-hidden="true" />
          ),
        )}
      </div>
    </section>
  );
}
