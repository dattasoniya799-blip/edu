import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { Shell } from './pages/Shell';
import { Dashboard } from './pages/Dashboard';
import { Teachers } from './pages/Teachers';
import { Students } from './pages/Students';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="/teachers" element={<Teachers />} />
          <Route path="/students" element={<Students />} />
          <Route path="/courses" element={<Placeholder title="课程与班级" sub="三种班型 · 手动逐讲设时间(MVP 口径)" hint="A3/B2 任务交付课程 CRUD 与讲次时间线" />} />
          <Route path="/ai-usage" element={<Placeholder title="AI 用量与开销" sub="本月总额 · 按功能拆分 · 80% 告警(MVP 口径)" hint="B2 任务接 /admin/ai-usage/*" />} />
          <Route path="/settings" element={<Placeholder title="平台设置" sub="引导模式开关 · 学生端使用时段" hint="B2 任务接 /admin/settings" />} />
          <Route path="*" element={<Placeholder title="页面不存在" />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
