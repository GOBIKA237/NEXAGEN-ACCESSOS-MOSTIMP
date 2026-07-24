import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import FinanceDashboard from './pages/Financedashboard.jsx';
import HRDashboard from './pages/Hrdashboard.jsx';
import ManagerDashboard from './pages/Managerdashboard.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

// Frontend Dev 1 owns Login.jsx + Dashboard.jsx
// Frontend Dev 2 owns AdminDashboard.jsx
// Routes are wired here so neither of you has to touch this file day-to-day.
//
// Every route except "/" is wrapped in ProtectedRoute: plain ProtectedRoute
// just requires a logged-in session, requireRole="admin" additionally
// bounces non-admins back to /dashboard. This is what actually keeps an
// employee (or a logged-out visitor) out of /admin — Login.jsx already
// redirects correctly on login, but nothing was stopping someone from
// typing /admin into the URL bar directly until this was wired up.
//
// The old always-visible "Login / Dashboard / Admin" nav bar is gone too —
// it let anyone jump straight to /admin regardless of role. Each
// authenticated page renders its own <Header /> (logo + logged-in user +
// logout) instead.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/finance"
          element={
            <ProtectedRoute>
              <FinanceDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/hr"
          element={
            <ProtectedRoute>
              <HRDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requireRole="admin">
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/manager"
          element={
            <ProtectedRoute requireRole="manager">
              <ManagerDashboard />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}