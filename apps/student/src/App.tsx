import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { LoginPage } from './pages/LoginPage';
import { Shell } from './pages/Shell';
import { Today } from './pages/Today';
import { Courses } from './pages/Courses';
import { WrongBook } from './pages/WrongBook';
import { Report } from './pages/Report';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Shell />}>
          <Route index element={<Today />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/wrong-book" element={<WrongBook />} />
          <Route path="/report" element={<Report />} />
          <Route path="*" element={<Today />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
