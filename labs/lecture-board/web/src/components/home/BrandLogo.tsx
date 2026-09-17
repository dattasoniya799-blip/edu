/**
 * 「鲸云AI教育平台」品牌标识:一个内联 SVG(云朵托一条鲸尾的抽象形)+ 字标。
 * 自绘,不依赖任何外部素材;顶栏(首页 + 讲题页)都用这一个组件,保证两处一致。
 */
export function BrandLogo({ size = 26, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <span className="brand-logo">
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="qm-logo-grad" x1="2" y1="4" x2="30" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#4F6BF5" />
            <stop offset="1" stopColor="#3B53D6" />
          </linearGradient>
        </defs>
        {/* 云朵身体 */}
        <path
          d="M9 20c-3.3 0-6-2.6-6-5.8 0-3 2.3-5.5 5.3-5.8C9.2 5.1 12.6 2.5 16.6 2.5c4.3 0 7.9 3 8.7 7 3 .4 5.3 2.9 5.3 6 0 3.3-2.7 6-6 6"
          stroke="url(#qm-logo-grad)"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 鲸尾:两片尾鳍从云下探出,呼应「鲸云」 */}
        <path
          d="M12.5 19.5c0 3.6-1.6 6.6-3.6 8.8 2.9-.4 5.6-1.9 7.1-4.6.4 2.6 2 4.8 4.3 5.9-.7-2.6-.6-5.7.6-8.2"
          fill="url(#qm-logo-grad)"
        />
      </svg>
      {withWordmark && (
        <span className="brand-word">
          鲸云<span className="brand-word-accent">AI</span>
        </span>
      )}
    </span>
  );
}
