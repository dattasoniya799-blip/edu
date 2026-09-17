/** 底部小字:品牌落款 + `/sample` 离线夹具入口(开发用,首页不再突出)。 */
export function HomeFooter({ onSample }: { onSample(): void }) {
  return (
    <footer className="home-footer">
      <span>鲸云AI教育平台 · 实验室 · 讲题白板</span>
      <button className="btn-link" onClick={onSample}>
        服务端没起?看离线样例
      </button>
    </footer>
  );
}
