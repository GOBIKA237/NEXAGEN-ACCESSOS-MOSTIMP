import { Navigate } from 'react-router-dom';

// Reads the session written by Login.jsx (sessionStorage 'token' + 'user').
// Kept as a small helper so both ProtectedRoute and any future component
// (e.g. a logout button) read the session the same way.
function getSession() {
  const token = sessionStorage.getItem('token');
  const raw = sessionStorage.getItem('user');

  let user = null;
  try {
    user = raw ? JSON.parse(raw) : null;
  } catch {
    user = null;
  }

  return { token, user };
}

// Wrap a route's element with this to require login (and optionally a
// specific role). This is a UX guard only — real enforcement is the
// backend's requireAuth/checkPermission middleware, which every /api/admin
// route already uses. This component just stops the frontend from
// rendering a page (and firing its API calls) for someone who shouldn't
// see it, e.g. clicking straight to /admin without logging in.
//
// Usage:
//   <ProtectedRoute><Dashboard /></ProtectedRoute>
//   <ProtectedRoute requireRole="admin"><AdminDashboard /></ProtectedRoute>
export default function ProtectedRoute({ children, requireRole }) {
  const { token, user } = getSession();

  // Not logged in at all — send to login.
  if (!token || !user) {
    return <Navigate to="/" replace />;
  }

  // Logged in, but doesn't hold the role this route requires (e.g. an
  // employee trying to open /admin) — send to their own dashboard rather
  // than back to login, since they do have a valid session.
  if (requireRole && !user.roles?.includes(requireRole)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}