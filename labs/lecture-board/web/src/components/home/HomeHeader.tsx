/** 首页顶栏:品牌 + 模块名「讲题白板」,右侧服务状态(GET /api/health 的 bailian/seedream 两个布尔)。 */
import { useEffect, useState } from 'react';
import { fetchHealthDetail, type HealthDetail } from '../../lib/api';
import { BrandLogo } from './BrandLogo';

export function HomeHeader() {
  const [health, setHealth] = useState<HealthDetail | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      void fetchHealthDetail().then((h) => alive && setHealth(h));
    };
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <header className="home-header">
      <div className="home-header-brand">
        <BrandLogo size={28} />
        <span className="home-header-divider" aria-hidden="true" />
        <span className="home-header-module">讲题白板</span>
      </div>
      <div className="home-status" title="讲题依赖百炼(识题/出剧本);情境图依赖生图服务,缺了只影响配图,不影响开讲">
        <span className={`home-status-dot ${health?.bailian ? 'is-up' : 'is-down'}`} />
        <span className="home-status-label">百炼</span>
        <span className={`home-status-dot ${health?.seedream ? 'is-up' : 'is-down'}`} />
        <span className="home-status-label">生图</span>
      </div>
    </header>
  );
}
