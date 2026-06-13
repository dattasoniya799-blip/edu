import { Route, Routes } from 'react-router-dom';
import { MockBadge } from '@qiming/ui';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { Shell } from './pages/Shell';
import { TodayPage } from './pages/today/TodayPage';
import { CoursePage } from './pages/course/CoursePage';
import { HomeworkPage } from './pages/homework/HomeworkPage';
import { WrongBookPage } from './pages/wrong/WrongBookPage';
import { ReportPage } from './pages/report/ReportPage';
import { ClassroomPage } from './pages/classroom/ClassroomPage';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* 课堂模式整屏接管:不挂 Shell(隐藏常规导航),B6 */}
        <Route path="/classroom/:sessionId" element={<ClassroomPage />} />
        <Route element={<Shell />}>
          <Route index element={<TodayPage />} />
          <Route path="/courses" element={<CoursePage />} />
          <Route path="/homework/:assignmentId" element={<HomeworkPage />} />
          <Route path="/wrong-book" element={<WrongBookPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="*" element={<TodayPage />} />
        </Route>
      </Routes>
      <MockBadge />
    </AuthProvider>
  );
}
