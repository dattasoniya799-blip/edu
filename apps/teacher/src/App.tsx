import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { Shell } from './pages/Shell';
import { Dashboard } from './pages/Dashboard';
import { Bank } from './pages/Bank';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="/courses" element={<Placeholder title="我的课程" sub="讲次时间线 · 备课进度 · 课堂编排入口" hint="B3 任务接 /teacher/courses 与 /lessons/*" />} />
          <Route path="/bank" element={<Bank />} />
          <Route path="/resources" element={<Placeholder title="资源库" sub="课件上传与挂载(MVP:视频 + PDF + 图片)" hint="B3 任务接 /resources" />} />
          <Route path="/analytics" element={<Placeholder title="学情分析" sub="知识点掌握热力 + 待关注名单(MVP 口径)" hint="B4 任务接 /analytics/*" />} />
          <Route path="*" element={<Placeholder title="页面不存在" />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
