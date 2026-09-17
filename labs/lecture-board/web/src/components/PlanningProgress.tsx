import type { LessonStage } from '../types';

export interface StageRow {
  status: 'idle' | 'running' | 'done' | 'error';
  ms?: number;
  message?: string;
}

const LABELS: Partial<Record<LessonStage, string>> = {
  recognizing: '识题(读截图,抄题干,定已知/求)',
  planning: '规划白板(分列、排卡、定配图与动画)',
  scripting: '出剧本(逐步旁白 + 板书 + 公式双轨)',
  assets: '素材并行(配图 / 动画 / 语音)',
};

const ORDER: LessonStage[] = ['recognizing', 'planning', 'scripting', 'assets'];

/** 剧本到达前的规划进度:每阶段 start/done + 耗时(protocol.md 的 stage 事件)。 */
export function PlanningProgress({
  stages,
  error,
  connection,
}: {
  stages: Partial<Record<LessonStage, StageRow>>;
  error?: string | null;
  connection?: 'open' | 'reconnecting';
}) {
  return (
    <div className="centerbox">
      <div className="panel">
        <h1>正在备课…</h1>
        <p className="sub">
          剧本一就绪就开讲,配图和语音后台继续跑。
          {connection === 'reconnecting' && ' · 连接断了,正在重连'}
        </p>
        {error && <div className="alert">{error}</div>}
        <ul className="stage-list">
          {ORDER.map((s) => {
            const row = stages[s] ?? { status: 'idle' as const };
            return (
              <li className={`stage-row is-${row.status}`} key={s}>
                <span className="dot" />
                <span>{LABELS[s]}</span>
                <span className="ms">
                  {row.status === 'done' && row.ms != null
                    ? `${(row.ms / 1000).toFixed(1)}s`
                    : row.status === 'running'
                      ? '进行中'
                      : row.status === 'error'
                        ? (row.message ?? '失败')
                        : '等待'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
