/** 首页:品牌顶栏 + Hero + 上传区 + 示例题一键试讲 + 课程库 + 底部落款。 */
import '../home.css';
import { HomeFooter } from '../components/home/HomeFooter';
import { HomeHeader } from '../components/home/HomeHeader';
import { Hero } from '../components/home/Hero';
import { LessonsLibrary } from '../components/home/LessonsLibrary';
import { SamplesSection } from '../components/home/SamplesSection';
import { UploadPanel } from '../components/home/UploadPanel';

export function HomePage({ onCreated, onSample }: { onCreated(id: string): void; onSample(): void }) {
  return (
    <div className="home">
      <HomeHeader />
      <main className="home-main">
        <Hero />
        <UploadPanel onCreated={onCreated} />
        <SamplesSection onCreated={onCreated} />
        <LessonsLibrary onOpen={onCreated} />
      </main>
      <HomeFooter onSample={onSample} />
    </div>
  );
}
