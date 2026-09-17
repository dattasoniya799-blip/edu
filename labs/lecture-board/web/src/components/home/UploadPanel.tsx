/**
 * 上传区(原 pages/UploadPage.tsx 原样搬进来,校验/提交逻辑不变):
 * 1–3 张题目截图(缩略图预览,可删)+ 答案(必填)+ 题干文字(可选)→ POST /api/lessons → 跳讲题页。
 */
import { useState } from 'react';
import { createLesson } from '../../lib/api';

export function UploadPanel({ onCreated }: { onCreated(id: string): void }) {
  const [images, setImages] = useState<File[]>([]);
  const [answer, setAnswer] = useState('');
  const [problemText, setProblemText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previews = images.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    setError(null);
    if (!images.length) return setError('至少传 1 张题目截图。');
    if (images.length > 3) return setError('最多 3 张截图。');
    if (images.some((f) => f.size > 8 * 1024 * 1024)) return setError('单张截图不能超过 8 MB。');
    if (!answer.trim()) return setError('答案是必填的 —— 它是讲解的 ground truth。');
    setBusy(true);
    try {
      const { id } = await createLesson({ images, answer: answer.trim(), problemText: problemText.trim() || undefined });
      onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel upload-panel" id="upload">
      <h2 className="panel-title">上传题目,开始讲题</h2>
      <p className="sub">传一道题的截图和答案,AI 自己规划、自己讲完 —— 中途不用你点任何确认。</p>

      {error && <div className="alert">{error}</div>}

      <div className="field">
        <label>题目截图(1–3 张,png / jpg,单张 ≤ 8 MB)</label>
        <input
          type="file"
          accept="image/png,image/jpeg"
          multiple
          onChange={(e) => setImages(Array.from(e.target.files ?? []).slice(0, 3))}
        />
        {previews.length > 0 && (
          <div className="thumbs">
            {previews.map((p, i) => (
              <div className="thumb-item" key={p.url}>
                <img src={p.url} alt={p.name} />
                <button type="button" className="thumb-remove" aria-label={`删除 ${p.name}`} onClick={() => removeImage(i)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label>答案(必填)</label>
        <textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="(1)600 Pa;(2)6 N;(3)1.2 J" />
      </div>

      <div className="field">
        <label>题干文字(可选,截图不清时补)</label>
        <textarea rows={3} value={problemText} onChange={(e) => setProblemText(e.target.value)} />
      </div>

      <button className="btn-primary" onClick={() => void submit()} disabled={busy}>
        {busy ? '上传中…' : '开始讲题'}
      </button>
    </section>
  );
}
