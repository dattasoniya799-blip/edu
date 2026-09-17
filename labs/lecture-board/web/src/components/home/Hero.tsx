/** 首页 Hero:一句话价值主张 + 三个小特性。 */
const FEATURES = [
  { icon: '🔎', title: '审题逐条圈重点', text: '已知 / 隐含 / 求解自动拆解,红圈标出关键数据与限制条件' },
  { icon: '∑', title: '公式与动画同步', text: 'KaTeX 公式与板书动画同拍推进,讲到哪、板书亮到哪' },
  { icon: '🎙', title: '真人感语音', text: '句级预渲染配音,公式自动转自然口语,不读 LaTeX 记号' },
];

export function Hero() {
  return (
    <section className="hero">
      <h1 className="hero-title">拍一题,AI 老师在白板上从审题讲到总结</h1>
      <p className="hero-sub">上传题目截图和答案,鲸云AI自动规划、自动开讲 —— 中途不用你点任何确认。</p>
      <div className="hero-features">
        {FEATURES.map((f) => (
          <div className="hero-feature" key={f.title}>
            <span className="hero-feature-icon" aria-hidden="true">
              {f.icon}
            </span>
            <div>
              <div className="hero-feature-title">{f.title}</div>
              <div className="hero-feature-text">{f.text}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
