import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, register } from '../api/client.js';

// Shown while we check sessionStorage for an existing session, instead of
// flashing the real login form for someone who's actually already signed
// in (they get redirected straight past this — see the effect below).
function LoginSkeleton() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <div className="hidden bg-ink-950 lg:block lg:w-[42%]" />
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm animate-pulse space-y-4">
          <div className="h-6 w-32 rounded bg-slate-200" />
          <div className="h-3 w-40 rounded bg-slate-200" />
          <div className="mt-4 space-y-1.5">
            <div className="h-3 w-16 rounded bg-slate-200" />
            <div className="h-10 w-full rounded-lg bg-slate-200" />
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-20 rounded bg-slate-200" />
            <div className="h-10 w-full rounded-lg bg-slate-200" />
          </div>
          <div className="h-10 w-full rounded-lg bg-slate-300" />
        </div>
      </div>
    </div>
  );
}

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

export default function Login() {
  const navigate = useNavigate();

  const [mode, setMode] = useState('login');

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
  });

  // Field-level validation errors, shown inline under each input
  const [fieldErrors, setFieldErrors] = useState({
    name: '',
    email: '',
    password: '',
  });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Whether we've finished checking for an existing session on mount. Kept
  // separate from `loading` (that's for the submit button) so the skeleton
  // below only ever covers this first check, never a form submission.
  const [checkingSession, setCheckingSession] = useState(true);

  const isLogin = mode === 'login';

  // If there's already a valid-looking session, don't flash the login form
  // — send them straight to where they'd land after signing in. Mirrors
  // the sessionStorage read Dashboard.jsx already does on its own mount.
  useEffect(() => {
    const rawUser = sessionStorage.getItem('user');
    const token = sessionStorage.getItem('token');

    if (rawUser && token) {
      try {
        const existingUser = JSON.parse(rawUser);
        navigate(existingUser?.roles?.includes('admin') ? '/admin' : '/dashboard');
        return;
      } catch (err) {
        // Malformed JSON in sessionStorage — treat same as "not logged in"
        console.error('Failed to parse user from sessionStorage:', err);
        sessionStorage.removeItem('user');
        sessionStorage.removeItem('token');
      }
    }

    setCheckingSession(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(e) {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    // Clear that field's inline error as soon as the person edits it
    if (fieldErrors[name]) {
      setFieldErrors((prev) => ({ ...prev, [name]: '' }));
    }
  }

  function switchMode() {
    setMode(isLogin ? 'register' : 'login');

    setError('');
    setSuccess('');
    setFieldErrors({ name: '', email: '', password: '' });

    setForm({
      name: '',
      email: '',
      password: '',
    });
  }

  // Client-side validation before we ever hit the API.
  // Returns true if the form is valid.
  function validate() {
    const nextErrors = { name: '', email: '', password: '' };

    if (!isLogin && !form.name.trim()) {
      nextErrors.name = 'Name is required.';
    }

    if (!form.email.trim()) {
      nextErrors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (!form.password) {
      nextErrors.password = 'Password is required.';
    } else if (form.password.length < 6) {
      nextErrors.password = 'Password must be at least 6 characters.';
    }

    setFieldErrors(nextErrors);

    return !nextErrors.name && !nextErrors.email && !nextErrors.password;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (loading) return;

    setError('');
    setSuccess('');

    if (!validate()) {
      return;
    }

    setLoading(true);

    try {
      // =========================
      // LOGIN
      // =========================

      if (isLogin) {
        const { token, user } = await login(
          form.email,
          form.password
        );

        // Store JWT
        sessionStorage.setItem('token', token);

        // Store logged-in user details
        sessionStorage.setItem(
          'user',
          JSON.stringify(user)
        );

        // Redirect based on role. Login response returns `roles` (an
        // array) per docs/api-contract.md, not a single `role` string.
        if (user?.roles?.includes('admin')) {
          navigate('/admin');
        } else {
          navigate('/dashboard');
        }
      }

      // =========================
      // REGISTER
      // =========================

      else {
        await register(
          form.name,
          form.email,
          form.password
        );

        // Switch back to login page
        setMode('login');
        setFieldErrors({ name: '', email: '', password: '' });

        setSuccess(
          'Account created successfully. You can now sign in.'
        );

        // Keep the email so the user does not
        // need to type it again
        setForm({
          name: '',
          email: form.email,
          password: '',
        });
      }
    } catch (err) {
      console.error('Authentication error:', err);

      const status = err.response?.status;
      const serverMessage =
        err.response?.data?.error || err.response?.data?.message;

      let message = serverMessage;

      if (!message) {
        if (!err.response) {
          message = 'Could not reach the server. Please try again.';
        } else if (isLogin && status === 401) {
          message = 'Invalid email or password.';
        } else if (!isLogin && status === 409) {
          message = 'That email is already registered.';
        } else if (status === 400) {
          message = 'Please fill in all required fields.';
        } else {
          message = isLogin
            ? 'Invalid credentials. Please try again.'
            : 'Registration failed. Please try again.';
        }
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return <LoginSkeleton />;
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* BRAND PANEL — the one place this page spends its "boldness":
          a scan-line sweeping over a badge glyph, standing in for the
          access-verification idea rather than a stock illustration. */}
      <div className="relative hidden overflow-hidden bg-ink-950 lg:flex lg:w-[42%] lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
          aria-hidden="true"
        />

        <div className="relative flex items-center gap-2">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2.5 4 5.5v6c0 5 3.4 8.7 8 9.5 4.6-.8 8-4.5 8-9.5v-6L12 2.5Z"
              fill="#0FB8A9"
              fillOpacity="0.18"
              stroke="#2DD4C6"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-display text-lg font-semibold tracking-tight text-white">
            AccessOS
          </span>
        </div>

        <div className="relative flex flex-1 items-center justify-center py-16">
          <div className="relative flex h-56 w-56 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-signal-500/20" />
            <div className="absolute inset-8 rounded-full border border-signal-500/25" />
            <div className="absolute inset-16 rounded-full border border-signal-500/30" />
            <svg
              width="72"
              height="72"
              viewBox="0 0 24 24"
              fill="none"
              className="relative z-10"
              aria-hidden="true"
            >
              <path
                d="M12 2.5 4 5.5v6c0 5 3.4 8.7 8 9.5 4.6-.8 8-4.5 8-9.5v-6L12 2.5Z"
                fill="#0A0F1E"
                stroke="#2DD4C6"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M8.5 12.2 11 14.7l4.7-5.4"
                stroke="#2DD4C6"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'conic-gradient(from 0deg, transparent 0%, rgba(45,212,198,0.35) 8%, transparent 16%)',
                animation: 'accessos-scan 3.5s linear infinite',
              }}
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="relative">
          <p className="font-display text-2xl font-medium leading-snug text-white">
            Access, verified.
          </p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-400">
            Every login is scored in real time — unrecognized devices,
            off-hours activity, and impossible travel are flagged before
            they become a breach.
          </p>
        </div>
      </div>

      {/* FORM PANEL */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
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
            {isLogin ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {isLogin
              ? 'Sign in to continue to your dashboard.'
              : 'Set up access for your organization.'}
          </p>

          {/* ERROR MESSAGE */}
          {error && (
            <div
              role="alert"
              className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {error}
            </div>
          )}

          {/* SUCCESS MESSAGE */}
          {success && (
            <div
              role="status"
              className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
            >
              {success}
            </div>
          )}

          {/* FORM */}
          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
            {/* NAME - REGISTER ONLY */}
            {!isLogin && (
              <div>
                <label htmlFor="name" className="field-label">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  value={form.name}
                  onChange={handleChange}
                  aria-invalid={Boolean(fieldErrors.name)}
                  className={`input-field ${
                    fieldErrors.name ? '!border-rose-300 !ring-rose-100' : ''
                  }`}
                  placeholder="Test Employee"
                />
                {fieldErrors.name && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.name}</p>
                )}
              </div>
            )}

            {/* EMAIL */}
            <div>
              <label htmlFor="email" className="field-label">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                aria-invalid={Boolean(fieldErrors.email)}
                className={`input-field ${
                  fieldErrors.email ? '!border-rose-300 !ring-rose-100' : ''
                }`}
                placeholder="you@nexagen.com"
              />
              {fieldErrors.email && (
                <p className="mt-1 text-xs text-rose-600">{fieldErrors.email}</p>
              )}
            </div>

            {/* PASSWORD */}
            <div>
              <label htmlFor="password" className="field-label">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                value={form.password}
                onChange={handleChange}
                aria-invalid={Boolean(fieldErrors.password)}
                className={`input-field ${
                  fieldErrors.password ? '!border-rose-300 !ring-rose-100' : ''
                }`}
                placeholder="••••••••"
              />
              {fieldErrors.password && (
                <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p>
              )}
            </div>

            {/* SUBMIT BUTTON */}
            <button
              type="submit"
              disabled={loading}
              className="btn-accent w-full py-2.5"
            >
              {loading && <Spinner />}
              {loading ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {/* SWITCH LOGIN / REGISTER */}
          <p className="mt-6 text-center text-sm text-slate-500">
            {isLogin ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={switchMode}
              className="font-medium text-signal-700 hover:underline"
            >
              {isLogin ? 'Register' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes accessos-scan {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}