/**
 * 纸感课堂 · 共享外壳(动态讲义与知识点动画共用,保证两个体验同款)。
 * 配色与已验收动画同源(--paper/--ink/--hi 系);类名约定 dl-*。
 * 包含:整页舞台、顶栏(返回/标题/页签)、按钮族、胶囊标签、满幅内容卡、错误条。
 */

export const PAPER = {
  paper: '#fdf8f0',
  sheet: '#ffffff',
  sheetSub: '#f5eee3',
  rule: '#e8dcc9',
  grid: '#efe5d5',
  axis: '#8c7f6e',
  ink1: '#2a2118',
  ink2: '#6b5d4c',
  ink3: '#a49684',
  hiA: '#b3541e',
  hiASoft: '#fbe6d3',
  hiB: '#256b60',
  hiBSoft: '#d9ece6',
  hiC: '#6d4b9c',
  hiCSoft: '#e9e0f5',
  red: '#a83226',
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  font: '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
} as const;

export const PAPER_SHELL_CSS = `
.dl-stage{
  position:fixed;inset:0;z-index:70;display:flex;flex-direction:column;gap:10px;
  height:100dvh;overflow:hidden;overscroll-behavior:none;
  padding:10px 14px 12px;background:
    radial-gradient(900px 420px at 8% -8%, rgba(179,84,30,.05), transparent 55%),
    radial-gradient(700px 380px at 105% 6%, rgba(37,107,96,.05), transparent 50%),
    ${PAPER.paper};
  color:${PAPER.ink1};
  font-family:${PAPER.font};
  font-size:14px;line-height:1.65;
}
.dl-top{display:flex;flex-wrap:wrap;align-items:center;gap:12px;flex:none}
.dl-title{flex:1;min-width:0}
.dl-title b{font-size:17px;letter-spacing:.02em}
.dl-title span{display:block;font-size:12px;color:${PAPER.ink3}}
.dl-tabs{display:flex;gap:6px}
.dl-btn{
  font-family:inherit;font-size:13.5px;min-height:44px;padding:0 16px;border-radius:8px;
  border:1px solid ${PAPER.rule};background:${PAPER.sheetSub};color:${PAPER.ink1};
  cursor:pointer;letter-spacing:.06em;transition:background-color .2s ease,color .2s ease,border-color .2s ease;
}
.dl-btn.on{background:${PAPER.hiASoft};border-color:${PAPER.hiA};color:${PAPER.hiA};font-weight:600}
.dl-btn.go{background:${PAPER.hiCSoft};border-color:${PAPER.hiC};color:${PAPER.hiC};font-weight:600}
.dl-btn.ghost{background:transparent}
.dl-btn:disabled{opacity:.4;cursor:default}
.dl-pill{
  display:inline-flex;align-items:center;font-size:11.5px;padding:3px 11px;border-radius:999px;
  border:1px solid ${PAPER.rule};color:${PAPER.ink2};background:rgba(255,250,240,.6);
}
.dl-pill.ok{color:${PAPER.hiB};border-color:${PAPER.hiB};background:${PAPER.hiBSoft}}
.dl-pill.bad{color:${PAPER.red};border-color:${PAPER.red};background:rgba(168,50,38,.07)}
.dl-link{font-size:12.5px;color:${PAPER.hiA};text-decoration:underline;letter-spacing:.04em}
.dl-fill{
  flex:1;min-height:0;overflow:hidden;border-radius:12px;
  border:1px solid ${PAPER.rule};background:${PAPER.sheet};box-shadow:0 1px 6px rgba(60,40,20,.09);
}
.dl-error{
  flex:none;border:1px solid ${PAPER.red};border-radius:10px;background:rgba(168,50,38,.07);
  padding:10px 14px;font-size:12.5px;color:${PAPER.red};
}
`;
