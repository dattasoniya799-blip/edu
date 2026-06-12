import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { Shell } from './pages/Shell';
import { TodayPage } from './pages/today/TodayPage';
import { CoursePage } from './pages/course/CoursePage';
import { HomeworkPage } from './pages/homework/HomeworkPage';
import { WrongBookPage } from './pages/wrong/WrongBookPage';
import { ReportPage } from './pages/report/ReportPage';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Shell />}>
          <Route index element={<TodayPage />} />
          <Route path="/courses" element={<CoursePage />} />
          <Route path="/homework/:assignmentId" element={<HomeworkPage />} />
          <Route path="/wrong-book" element={<WrongBookPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="*" element={<TodayPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
