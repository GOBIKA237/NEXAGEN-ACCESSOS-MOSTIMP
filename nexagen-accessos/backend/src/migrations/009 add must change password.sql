import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { changePassword, logout } from '../api/client.js';

// Matches auth.routes.js's MIN_PASSWORD_LENGTH — kept in sync manually
// since that constant isn't exposed to the frontend. This is only a
// pre-flight check to save a round trip; the server enforces its own
// minimum regardless of what's sent here.
const MIN_PASSWORD_LENGTH = 8;

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin text-white"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// Reached either right after login when the server flags
// mustChangePassword: true (see Login.jsx), or by any signed-in user who
// navigates here directly to change their password voluntarily.
export default function ChangePassword() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [fieldErrors, setFieldErrors] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({ ...prev, [name]: value }));

    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
  }

  function validate() {
    const nextErrors = { currentPassword: '', newPassword: '', confirmPassword: '' };

    if (!form.currentPassword) {
      nextErrors.currentPassword = 'Current password is required.';
    }

    if (!form.newPassword) {
      nextErrors.newPassword = 'New password is required.';
    } else if (form.newPassword.length < MIN_PASSWORD_LENGTH) {
      nextErrors.newPassword = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    } else if (form.newPassword === form.currentPassword) {
      nextErrors.newPassword = 'New password must be different from your current password.';
    }

    if (!form.confirmPassword) {
      nextErrors.confirmPassword = 'Please confirm your new password.';
    } else if (form.confirmPassword !== form.newPassword) {
      nextErrors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(nextErrors);

    return !nextErrors.currentPassword && !nextErrors.newPassword && !nextErrors.confirmPassword;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (loading) return;

    setError('');

    if (!validate()) {
      return;
    }

    setLoading(true);

    try {
      await changePassword(form.currentPassword, form.newPassword);

      // The password change is done server-side; drop the pending flag so
      // a reload or revisit to "/" doesn't route back here.
      sessionStorage.removeItem('mustChangePassword');

      // Same role-based redirect Login.jsx uses after a normal sign-in.
      const rawUser = sessionStorage.getItem('user');
      let user = null;
      try {
        user = rawUser ? JSON.parse(rawUser) : null;
      } catch {
        user = null;
      }
      navigate(user?.roles?.includes('admin') ? '/admin' : '/dashboard');
    } catch (err) {
      console.error('Change password error:', err);

      const status = err.response?.status;
      const serverMessage =
        err.response?.data?.error || err.response?.data?.message;

      let message = serverMessage;
      if (!message) {
        if (!err.response) {
          message = 'Could not reach the server. Please try again.';
        } else if (status === 401) {
          message = 'Current password is incorrect.';
        } else {
          message = 'Could not change your password. Please try again.';
        }
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 2.5 4 5.5v6c0 5 3.4 8.7 8 9.5 4.6-.8 8-4.5 8-9.5v-6L12 2.5Z"
                fill="#0FB8A9"
                fillOpacity="0.12"
                stroke="#0D9488"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-display text-lg font-semibold tracking-tight text-ink-900">
              AccessOS
            </span>
          </div>
        </div>

        <h1 className="font-display text-2xl font-semibold text-ink-900">
          Update your password
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          For security, you need to set a new password before continuing.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
          <div>
            <label htmlFor="currentPassword" className="field-label">
              Current password
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              value={form.currentPassword}
              onChange={handleChange}
              aria-invalid={Boolean(fieldErrors.currentPassword)}
              className={`input-field ${
                fieldErrors.currentPassword ? '!border-rose-300 !ring-rose-100' : ''
              }`}
              placeholder="••••••••"
            />
            {fieldErrors.currentPassword && (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.currentPassword}</p>
            )}
          </div>

          <div>
            <label htmlFor="newPassword" className="field-label">
              New password
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              value={form.newPassword}
              onChange={handleChange}
              aria-invalid={Boolean(fieldErrors.newPassword)}
              className={`input-field ${
                fieldErrors.newPassword ? '!border-rose-300 !ring-rose-100' : ''
              }`}
              placeholder="••••••••"
            />
            {fieldErrors.newPassword && (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.newPassword}</p>
            )}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="field-label">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={handleChange}
              aria-invalid={Boolean(fieldErrors.confirmPassword)}
              className={`input-field ${
                fieldErrors.confirmPassword ? '!border-rose-300 !ring-rose-100' : ''
              }`}
              placeholder="••••••••"
            />
            {fieldErrors.confirmPassword && (
              <p className="mt-1 text-xs text-rose-600">{fieldErrors.confirmPassword}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-accent w-full py-2.5"
          >
            {loading && <Spinner />}
            {loading ? 'Please wait…' : 'Update password'}
          </button>
        </form>

        {/* Safety valve — without this, someone stuck here (e.g. unsure of
            their current password) has no way back to the login screen
            short of clearing storage manually. */}
        <p className="mt-6 text-center text-sm text-slate-500">
          <button
            type="button"
            onClick={() => {
              logout();
              navigate('/');
            }}
            className="font-medium text-signal-700 hover:underline"
          >
            Log out instead
          </button>
        </p>
      </div>
    </div>
  );
}
