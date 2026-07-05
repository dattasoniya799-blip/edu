import { Route, Routes, useNavigate } from 'react-router-dom';
import { Button, Card, EmptyState, MockBadge } from '@qiming/ui';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { Shell, PageHead } from './pages/Shell';
import { Dashboard } from './pages/Dashboard';
import { Teachers } from './pages/Teachers';
import { Students } from './pages/Students';
import { Courses } from './pages/Courses';
import { AiUsage } from './pages/AiUsage';
import { AiConfig } from './pages/AiConfig';
import { Settings } from './pages/Settings';

/** 真实 404 空态:未匹配任何路由时的兜底页(返回首页可回到概览) */
function NotFound() {
  const navigate = useNavigate();
  return (
    <div>
      <PageHead title="页面不存在" />
      <Card>
        <EmptyState
          icon="⊘"
          text="页面不存在或已被移动"
          hint="请检查链接是否正确,或返回首页继续操作"
          action={<Button variant="primary" onClick={() => navigate('/')}>返回首页</Button>}
        />
      </Card>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="/teachers" element={<Teachers />} />
          <Route path="/students" element={<Students />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/ai-usage" element={<AiUsage />} />
          <Route path="/ai/config" element={<AiConfig />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <MockBadge />
    </AuthProvider>
  );
}
