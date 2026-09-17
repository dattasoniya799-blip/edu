/** 极简路由(不引 react-router):/ 上传页,/lesson/:id 讲题页,/sample 离线样例。 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { prepareSample } from './mock/sample';
import { HomePage } from './pages/HomePage';
import { LessonPage } from './pages/LessonPage';

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((to: string) => {
    window.history.pushState({}, '', to);
    setPath(to);
  }, []);

  // ?anim=html / ?anim=static:换成动画桥另外两条路的夹具(见 mock/sample.ts)
  const sample = useMemo(
    () => (path === '/sample' ? prepareSample(new URLSearchParams(window.location.search).get('anim')) : undefined),
    [path],
  );

  if (path === '/sample') {
    return <LessonPage lessonId={null} mockScript={sample} onBack={() => go('/')} />;
  }
  const m = /^\/lesson\/([^/]+)$/.exec(path);
  if (m) {
    return <LessonPage lessonId={decodeURIComponent(m[1])} onBack={() => go('/')} />;
  }
  return <HomePage onCreated={(id) => go(`/lesson/${encodeURIComponent(id)}`)} onSample={() => go('/sample')} />;
}
