/**
 * 动画课堂 · 学生课表 + 整页上课。
 * 需求:qiming/docs/需求文档/02-动画课堂-学生端demo需求.md
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseLectureScript, type LectureScript, type LectureScriptInput } from './script-schema';
import { runReferenceChecks } from './expr';
import { Player } from './Player';
import { PAPER, PAPER_SHELL_CSS } from '../shared/paper-shell';
import { DEMO_LESSONS } from './samples';

function isDevScript(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('dev') === '1';
}

export function DynamicLecture() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (openIdx !== null) {
    return <Fullscreen raw={DEMO_LESSONS[openIdx]} onExit={() => setOpenIdx(null)} />;
  }

  return (
    <div style={{ maxWidth: 1200 }}>
      <p style={{ fontSize: 13, lineHeight: 1.8, color: '#5B6B86', margin: '0 0 14px' }}>
        五堂课共用一套上课页:老师讲、画面跟、指定拍才放手让你拖。点一张进入。
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 12,
        }}
      >
        {DEMO_LESSONS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOpenIdx(i)}
            style={{
              textAlign: 'left',
              padding: '16px 18px',
              borderRadius: 12,
              border: '1.5px solid #E6EAF2',
              background: '#fff',
              cursor: 'pointer',
              font: 'inherit',
              boxShadow: '0 1px 3px rgba(30,42,68,.06)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 11.5,
                  padding: '2px 9px',
                  borderRadius: 999,
                  background: s.kind === 'concept' ? '#FBE6D3' : '#D9ECE6',
                  color: s.kind === 'concept' ? '#b3541e' : '#256b60',
                }}
              >
                {s.kind === 'concept' ? '知识点' : '讲题'}
              </span>
              {s.grade && <span style={{ fontSize: 12, color: '#94A3B8' }}>{s.grade}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#94A3B8' }}>{s.steps.length} 拍</span>
            </div>
            <b style={{ display: 'block', marginTop: 8, fontSize: 14.5 }}>{s.title}</b>
            {s.kind === 'problem' && s.problem?.source && (
              <div style={{ marginTop: 3, fontSize: 12, color: '#94A3B8' }}>{s.problem.source}</div>
            )}
            {s.kind === 'concept' && s.goal && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: '#5B6B86', lineHeight: 1.6 }}>{s.goal}</div>
            )}
            <div style={{ marginTop: 8, fontSize: 12.5, color: '#5B6B86' }}>进入上课 →</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Fullscreen({ raw, onExit }: { raw: LectureScriptInput; onExit: () => void }) {
  const [tab, setTab] = useState<'class' | 'script'>('class');
  const showDev = isDevScript();

  const { parsed, schemaError, refErrors } = useMemo(() => {
    try {
      const p = parseLectureScript(raw);
      return {
        parsed: p as LectureScript | null,
        schemaError: null as string | null,
        refErrors: runReferenceChecks(p.reference, p.scene.params.map((x) => x.id)),
      };
    } catch (err) {
      return { parsed: null, schemaError: err instanceof Error ? err.message : String(err), refErrors: [] };
    }
  }, [raw]);

  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExitRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const title = parsed?.title ?? raw.title;
  const kindLabel = raw.kind === 'concept' ? '知识点' : '讲题';

  return (
    <div className="dl-stage">
      <style>{PAPER_SHELL_CSS + CSS}</style>
      <header className="dl-top">
        <button type="button" className="dl-btn ghost" onClick={onExit}>
          ← 返回课表
        </button>
        <div className="dl-title">
          <b>{title}</b>
          <span>
            {kindLabel}
            {raw.grade ? ` · ${raw.grade}` : ''}
            {raw.kind === 'problem' && raw.problem?.source ? ` · ${raw.problem.source}` : ''}
          </span>
        </div>
        {showDev && (
          <div className="dl-tabs">
            <button type="button" className={`dl-btn ${tab === 'class' ? 'on' : ''}`} onClick={() => setTab('class')}>
              课堂
            </button>
            <button type="button" className={`dl-btn ${tab === 'script' ? 'on' : ''}`} onClick={() => setTab('script')}>
              剧本
            </button>
          </div>
        )}
      </header>

      {(schemaError || refErrors.length > 0) && (
        <div className="dl-error">
          {schemaError && <div>剧本未通过质检门,已停止播放:{schemaError}</div>}
          {refErrors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}

      {parsed && (
        <div className="dl-body" style={{ display: tab === 'class' ? 'flex' : 'none' }}>
          <Player key={parsed.id} script={parsed} />
        </div>
      )}

      {showDev && tab === 'script' && (
        <div className="dl-script">
          <div className="dl-block" style={{ marginBottom: 12 }}>
            <small>质检门</small>
            <p style={{ margin: '6px 0 0' }}>
              剧本格式与引用完整性:{schemaError ? '未通过' : '通过'} · 自查算例{' '}
              {(parsed ?? raw).reference?.length ?? 0} 条
              {refErrors.length === 0 ? '全部通过' : `,${refErrors.length} 条失败`}
            </p>
            {raw.goal && (
              <p style={{ margin: '6px 0 0' }}>
                <b>一句话结论:</b>
                {raw.goal}
              </p>
            )}
            {raw.difficultIdea && (
              <p style={{ margin: '6px 0 0' }}>
                <b>这题难在哪:</b>
                {raw.difficultIdea}
              </p>
            )}
            {raw.misconceptions?.map((m) => (
              <p key={m} style={{ margin: '4px 0 0', color: PAPER.ink2 }}>
                · {m}
              </p>
            ))}
          </div>
          <pre>{JSON.stringify(parsed ?? raw, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

const CSS = `
.dl-body{flex:1;min-height:0;flex-direction:column}
.dl-grid{
  flex:1;min-height:0;display:grid;gap:14px;
  grid-template-columns:minmax(0,1.55fr) minmax(340px,.85fr);
}
.dl-scene{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0}
.dl-banner{
  flex:none;border:1px solid ${PAPER.hiA};border-radius:10px;background:${PAPER.hiASoft};
  padding:8px 14px;font-size:12.5px;color:${PAPER.hiA};
}
.dl-frame{
  position:relative;flex:1;min-height:240px;overflow:hidden;border-radius:12px;
  border:1px solid ${PAPER.rule};background:${PAPER.sheet};box-shadow:0 1px 6px rgba(60,40,20,.09);
}
.dl-caption{
  position:absolute;right:14px;top:12px;font-size:12px;letter-spacing:.14em;
  color:${PAPER.ink3};background:rgba(255,250,240,.78);padding:3px 10px;border-radius:999px;
}
.dl-sub-line{
  margin:8px 0 0;padding-top:8px;border-top:1px dashed ${PAPER.rule};
  font-size:12.5px;line-height:1.8;color:${PAPER.ink3};
}
.dl-controls{
  flex:none;min-height:88px;border:1px solid ${PAPER.rule};border-radius:12px;background:${PAPER.sheet};
  padding:10px 14px;box-shadow:0 1px 6px rgba(60,40,20,.06);
}
.dl-controls[aria-hidden="true"]{
  border-color:transparent;background:transparent;box-shadow:none;padding:0 14px;
}
.dl-row{display:flex;align-items:center;gap:12px;min-height:44px}
.dl-name{font-weight:700;font-size:13.5px;flex:none}
.dl-val{font-family:${PAPER.mono};font-style:normal;font-weight:700;min-width:4.5em;text-align:right;color:${PAPER.hiA}}
.dl-row input[type=range]{flex:1;min-width:0;height:44px;accent-color:${PAPER.hiA};background:transparent}
.dl-hint{margin:2px 0 0;font-size:12.5px;color:${PAPER.ink3}}
.dl-feedback{
  margin:6px 0 0;padding:8px 11px;border-left:3px solid ${PAPER.hiB};border-radius:7px;
  background:${PAPER.hiBSoft};font-size:13px;color:${PAPER.ink1};
}
.dl-nudge{
  margin:6px 0 0;padding:8px 11px;border-left:3px solid ${PAPER.hiA};border-radius:7px;
  background:${PAPER.hiASoft};font-size:13px;color:${PAPER.hiA};
}
.dl-actions{
  display:flex;flex-wrap:nowrap;align-items:center;gap:8px;flex:none;
  overflow-x:auto;scrollbar-width:thin;
}
.dl-actions .dl-btn{flex:none;padding:0 13px;font-size:13px;white-space:nowrap}
.dl-spacer{flex:1;min-width:8px}
.dl-talk{
  min-width:0;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;
  border:1px solid ${PAPER.rule};border-radius:12px;background:
    linear-gradient(180deg, rgba(255,252,246,.6), rgba(245,238,227,.9)),${PAPER.sheetSub};
  padding:12px 14px;box-shadow:0 1px 6px rgba(60,40,20,.06);
}
.dl-stem{font-size:13px;border-bottom:1px dashed ${PAPER.rule};padding-bottom:10px}
.dl-stem summary{cursor:pointer;color:${PAPER.ink3};letter-spacing:.08em;min-height:28px}
.dl-stem-body{margin-top:8px;line-height:1.9}
.dl-rail{list-style:none;display:flex;flex-wrap:wrap;gap:7px;padding:0;margin:0}
.dl-rail button{
  position:relative;display:inline-flex;align-items:center;gap:5px;
  font-family:inherit;font-size:12.5px;min-height:44px;padding:0 10px;border-radius:8px;
  border:1px solid ${PAPER.rule};background:transparent;color:${PAPER.ink2};cursor:pointer;
}
.dl-rail button i{font-style:normal;font-family:${PAPER.mono};color:${PAPER.ink3};font-size:11.5px}
.dl-rail .active{border-color:${PAPER.hiA};color:${PAPER.hiA};font-weight:700;background:${PAPER.hiASoft}}
.dl-rail .active i{color:${PAPER.hiA}}
.dl-rail .done{color:${PAPER.hiB};border-color:${PAPER.hiBSoft}}
.dl-dot{width:6px;height:6px;border-radius:999px;background:${PAPER.hiC};flex:none}
.dl-narr{background:rgba(28,24,20,.045);border-radius:10px;padding:12px 14px}
.dl-narr small,.dl-block small{letter-spacing:.24em;color:${PAPER.hiA};font-size:11.5px}
.dl-narr-body{margin-top:7px;font-size:13.5px;line-height:1.95}
.dl-block{border-top:1px dashed ${PAPER.rule};padding-top:12px}
.dl-q{margin:7px 0 8px;font-size:13.5px}
.dl-choice{
  display:block;width:100%;text-align:left;margin:7px 0;padding:11px 13px;min-height:44px;
  border-radius:9px;border:1px solid ${PAPER.rule};background:rgba(255,250,240,.6);
  font:inherit;font-size:13.5px;cursor:pointer;transition:border-color .2s ease,color .2s ease;
}
.dl-choice.picked{border-color:${PAPER.ink1}}
.dl-choice.yes{border-color:${PAPER.hiB};color:${PAPER.hiB};font-weight:700;background:${PAPER.hiBSoft}}
.dl-choice.no{border-color:${PAPER.red};color:${PAPER.red};background:rgba(168,50,38,.06)}
.dl-reveal{margin:8px 0 0;padding:10px 12px;border-radius:9px;background:rgba(28,24,20,.045);font-size:12.5px;line-height:1.85}
.dl-reveal b{display:block;margin-bottom:2px;color:${PAPER.hiB};letter-spacing:.1em}
.dl-note{margin-left:10px;font-size:12px;color:${PAPER.ink3}}
.dl-script{flex:1;min-height:0;overflow-y:auto}
.dl-script pre{
  margin:0;padding:16px;border:1px solid ${PAPER.rule};border-radius:12px;background:${PAPER.sheet};
  font-family:${PAPER.mono};font-size:12px;line-height:1.7;overflow:auto;
}
.dl-script .dl-block{border:1px solid ${PAPER.rule};border-radius:12px;background:${PAPER.sheet};padding:14px 16px}
@media (max-width: 980px){
  .dl-grid{grid-template-columns:1fr;grid-template-rows:minmax(0,1.25fr) minmax(0,1fr)}
}
`;
