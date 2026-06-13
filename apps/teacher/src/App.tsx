import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { Shell } from './pages/Shell';
import { Dashboard } from './pages/Dashboard';
import { BankList } from './pages/bank/BankList';
import { EditorPage } from './pages/bank/EditorPage';
import { CourseLessonsPage } from './pages/course/CourseLessonsPage';
import { LessonArrangePage } from './pages/lesson/LessonArrangePage';
import { PaperBuilderPage } from './pages/paper/PaperBuilderPage';
import { GradingHomePage } from './pages/grading/GradingHomePage';
import { GradingReviewPage } from './pages/grading/GradingReviewPage';
import { MonitorPage } from './pages/monitor/MonitorPage';
import { ResourcesPage } from './pages/resources/ResourcesPage';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="/courses" element={<CourseLessonsPage />} />
          <Route path="/lessons/:id/arrange" element={<LessonArrangePage />} />
          <Route path="/lessons/:id/paper" element={<PaperBuilderPage />} />
          <Route path="/lessons/:id/monitor" element={<MonitorPage />} />
          <Route path="/grading" element={<GradingHomePage />} />
          <Route path="/grading/:assignmentId" element={<GradingReviewPage />} />
          <Route path="/bank" element={<BankList />} />
          <Route path="/bank/new" element={<EditorPage />} />
          <Route path="/bank/:id/edit" element={<EditorPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/analytics" element={<Placeholder title="学情分析" sub="知识点掌握热力 + 待关注名单(MVP 口径)" hint="B4 任务接 /analytics/*" />} />
          <Route path="*" element={<Placeholder title="页面不存在" />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
