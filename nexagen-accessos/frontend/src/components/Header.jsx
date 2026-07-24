import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../api/client.js';

function initials(name) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function HeaderSkeleton() {
  return (
    <div className="flex items-center gap-3 animate-pulse">
      <div className="h-9 w-9 rounded-full bg-slate-200" />
      <div className="space-y-1.5">
        <div className="h-3 w-28 rounded bg-slate-200" />
        <div className="h-2.5 w-20 rounded bg-slate-200" />
      </div>
    </div>
  );
}

// Minimal glyph standing in for a wordmark icon — a shield outline with a
// checkmark, evoking "verified access" rather than a generic geometric
// logo placeholder. Plain inline SVG, no icon-library dependency.
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 4 5.5v6c0 5 3.4 8.7 8 9.5 4.6-.8 8-4.5 8-9.5v-6L12 2.5Z"
        fill="#0FB8A9"
        fillOpacity="0.12"
        stroke="#0D9488"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 12.2 11 14.7l4.7-5.4"
        stroke="#0D9488"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Shared top bar for any authenticated page: wordmark + logged-in user +
// logout. Reads the session straight from sessionStorage instead of taking
// a `user` prop, so Dashboard.jsx and AdminDashboard.jsx can each drop in
// <Header /> as-is without threading state down or duplicating the logout
// handler that used to only exist (per-page) in Dashboard.
//
// Session state here is read independently of whatever each page's own
// auth check is doing (e.g. Dashboard's redirect-if-logged-out effect) —
// if sessionStorage is empty this just renders nothing, so it never fights
// with a page's own "kick back to /" logic.
export default function Header() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('user');

    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch (err) {
        console.error('Failed to parse user from sessionStorage:', err);
      }
    }

    setChecked(true);
  }, []);

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 px-6 py-3 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <div className="flex items-center gap-2">
          <Mark />
          <span className="font-display text-base font-semibold tracking-tight text-ink-900">
            AccessOS
          </span>
        </div>

        {!checked ? (
          <HeaderSkeleton />
        ) : user ? (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white ring-2 ring-white shadow-card">
              {initials(user.name)}
            </div>
            <div className="hidden min-w-0 text-left sm:block">
              <p className="truncate text-sm font-medium text-slate-800">
                {user.name}
              </p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="btn-secondary btn-sm ml-1"
            >
              Log out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}