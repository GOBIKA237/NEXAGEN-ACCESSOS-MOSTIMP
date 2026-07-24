import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  requestAccess,
  getAvailableRoles,
  getMe,
  getMyAccessRequests,
  submitLeaveRequest,
  getMyLeaveRequests,
  getMyTasks,
  updateTaskStatus,
} from '../api/client.js';
import Header from '../components/Header.jsx';

// Static registry of dashboard features. Add new cards here as the product
// grows — each just needs the permission string that unlocks it.
// `path` is optional: only set it once a real page exists for the card.
// Cards without a path keep the old inert "Open →" button rather than
// linking somewhere that 404s.
//
// `role` is new: the single named role (see schema.sql's role_permissions
// seed) that currently grants this card's permission — 'finance' is the
// only role granting view_finance_dashboard, 'admin' is the only role
// granting manage_users, etc. It's used purely to look up that role's
// expiry for the countdown badge below; it's a frontend-only mapping, not
// something read from the API. If a permission ever ends up grantable by
// more than one role, this 1:1 lookup stops being accurate and the expiry
// would need to come from the backend per-permission instead of per-role.
//
// EXPIRY DATA ASSUMPTION: this reads `user.roleExpirations`, a shape that
// doesn't exist on GET /auth/me yet (today it only returns
// { id, name, email } — see the note in refreshSession() below). Assumed
// shape once it's added: `{ [roleName]: expiresAtISOString }`, present
// only for roles with a non-null user_roles.expires_at (see migration 006)
// — permanent roles simply have no entry. Everything below degrades
// gracefully if it's absent: `user.roleExpirations?.[...]` is undefined,
// useCountdown treats that as "no expiry", cards behave exactly as they
// do today. Flag to Backend Dev 1 if a different shape is planned.
const FEATURES = [
  {
    key: 'view_finance_dashboard',
    title: 'Finance Dashboard',
    description: 'View budgets, expenses, and financial reports.',
    path: '/dashboard/finance',
    role: 'finance',
  },
  {
    key: 'view_hr_dashboard',
    title: 'HR Dashboard',
    description: 'Employee records, leave requests, and payroll.',
    path: '/dashboard/hr',
    role: 'hr',
  },
  {
    key: 'manager_dashboard', // synthetic — not a real permissions.* entry,
    // see roleGate below. 'manager' is gated by role membership
    // (requireRole('manager') in checkPermission.js), not a permission in
    // role_permissions, so this card can't be unlocked the same way as the
    // others above (checking user.permissions.includes(key)). roleGate
    // tells the render loop below to check user.roles instead.
    //
    // User Management and Audit Log used to be cards here, but both are
    // admin-only (role: 'admin') and admins already land straight on
    // /admin on login (see Login.jsx) — there's no reason to surface them
    // as locked/"Restricted" cards to every other role too.
    title: 'Manager Dashboard',
    description: 'Team overview, access approvals, and leave/task management.',
    path: '/dashboard/manager',
    roleGate: 'manager',
  },
];

// Human-readable label for a permission key, for use in the "new access"
// toast. Falls back to the raw key for permissions that aren't tied to a
// dashboard card (e.g. anything admin-only).
function permissionLabel(key) {
  return FEATURES.find((f) => f.key === key)?.title ?? key;
}

// Human-readable label + pill color for each access_requests.status value.
// Falls back to the raw value for anything unrecognized so a future status
// doesn't render as a blank cell.
const STATUS_LABELS = {
  PENDING_MANAGER: { label: 'Pending manager review', tone: 'amber' },
  PENDING_ADMIN: { label: 'Pending admin review', tone: 'amber' },
  APPROVED: { label: 'Approved', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
  REVOKED: { label: 'Revoked', tone: 'slate' },
};

function statusInfo(status) {
  return STATUS_LABELS[status] ?? { label: status, tone: 'slate' };
}

// Leave requests are a simpler two-party flow than access requests — no
// admin second stage, PENDING -> APPROVED/REJECTED is terminal either way
// (see migration 007_add_leave_requests.sql).
const LEAVE_STATUS_LABELS = {
  PENDING: { label: 'Pending manager review', tone: 'amber' },
  APPROVED: { label: 'Approved', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
};

function leaveStatusInfo(status) {
  return LEAVE_STATUS_LABELS[status] ?? { label: status, tone: 'slate' };
}

// todo -> in_progress -> done, same shape as manager-side
// TASK_STATUS_LABELS on Managerdashboard.jsx.
const TASK_STATUS_LABELS = {
  todo: { label: 'To do', tone: 'slate' },
  in_progress: { label: 'In progress', tone: 'amber' },
  done: { label: 'Done', tone: 'green' },
};

function taskStatusInfo(status) {
  return TASK_STATUS_LABELS[status] ?? { label: status, tone: 'slate' };
}

// The only forward transition each status can take — done is terminal, so
// it has none. Used to render a single "move it forward" button rather
// than a full dropdown, since the task only ever moves one direction.
const NEXT_TASK_STATUS = {
  todo: { value: 'in_progress', label: 'Start' },
  in_progress: { value: 'done', label: 'Mark done' },
};

function formatDateOnly(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

const STATUS_PILL_TONES = {
  slate: 'bg-slate-100 text-slate-600',
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  red: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
};

const STATUS_PILL_DOTS = {
  slate: 'bg-slate-400',
  green: 'bg-emerald-500',
  red: 'bg-rose-500',
  amber: 'bg-amber-500',
};

// Shared status-pill look used by DecisionCell and every status column
// below (access requests, leave requests, tasks) — mirrors the StatusPill
// component defined locally in AdminDashboard.jsx / Managerdashboard.jsx /
// Financedashboard.jsx / Hrdashboard.jsx, kept as its own small component
// here rather than importing across pages (each dashboard page is
// self-contained by design in this codebase).
function Pill({ tone = 'slate', children }) {
  return (
    <span className={`pill ${STATUS_PILL_TONES[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_PILL_DOTS[tone]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Renders a manager/admin decision cell: the decision itself plus its
// comment (if any), or "Awaiting review" while that stage hasn't happened
// yet.
function DecisionCell({ decision }) {
  if (!decision) {
    return <span className="text-xs italic text-slate-400">Awaiting review</span>;
  }

  // adminDecision.decision can be APPROVED | REJECTED | REVOKED (see
  // accessRequestsMe.routes.js); managerDecision.decision is only ever
  // APPROVED | REJECTED. Handle all three explicitly rather than
  // defaulting anything non-APPROVED to "Rejected", which mislabeled a
  // revoke as a rejection.
  const DECISION_STYLES = {
    APPROVED: { tone: 'green', label: 'Approved' },
    REJECTED: { tone: 'red', label: 'Rejected' },
    REVOKED: { tone: 'slate', label: 'Revoked' },
  };
  const { tone, label } = DECISION_STYLES[decision.decision] ?? {
    tone: 'slate',
    label: decision.decision,
  };

  return (
    <div>
<Pill tone={tone}>{label}</Pill>
      {decision.comment && (
        <p className="mt-1 text-xs text-slate-500">{decision.comment}</p>
      )}
    </div>
  );
}

// Ticks every 30s (not every second — this is a badge, not a stopwatch;
// matches the "refresh every 30s" spec and avoids re-rendering every card
// every second for no visible benefit at minute-level display precision).
// `expiresAt` absent/null means a permanent grant — the interval never
// starts and every call returns the same inert "not active" result.
const COUNTDOWN_TICK_MS = 30000;
const COUNTDOWN_RED_THRESHOLD_MS = 5 * 60 * 1000; // under 5 minutes
const COUNTDOWN_AMBER_THRESHOLD_MS = 60 * 60 * 1000; // under 1 hour

function formatCountdown(msRemaining) {
  const totalMinutes = Math.floor(msRemaining / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `expires in ${hours}h ${minutes}m`;
  if (minutes > 0) return `expires in ${minutes}m`;
  return 'expires in <1m';
}

function useCountdown(expiresAt) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return undefined; // permanent — nothing to tick
    const interval = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) {
    return { active: false, expired: false, label: null, tone: 'slate' };
  }

  const msRemaining = new Date(expiresAt).getTime() - now;

  if (msRemaining <= 0) {
    return { active: true, expired: true, label: null, tone: 'red' };
  }

  const tone =
    msRemaining < COUNTDOWN_RED_THRESHOLD_MS
      ? 'red'
      : msRemaining < COUNTDOWN_AMBER_THRESHOLD_MS
      ? 'amber'
      : 'slate';

  return { active: true, expired: false, label: formatCountdown(msRemaining), tone };
}

const COUNTDOWN_BADGE_TONES = {
  slate: 'bg-slate-100 text-slate-600',
  amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
};

// One tinted icon chip per feature, keyed the same way `accent` used to be.
// Replaces a flat color bar with a small glyph that actually signals what
// the card is (a chart for Finance, people for HR, a checklist for
// Manager) — still cheap (inline SVG, no icon-library dependency) but
// gives each card a real visual anchor instead of a decorative stripe.
const FEATURE_ICONS = {
  view_finance_dashboard: { bg: 'bg-emerald-50', fg: 'text-emerald-600' },
  view_hr_dashboard: { bg: 'bg-sky-50', fg: 'text-sky-600' },
  manager_dashboard: { bg: 'bg-signal-50', fg: 'text-signal-700' },
};

function FeatureIcon({ featureKey }) {
  const tone = FEATURE_ICONS[featureKey] ?? { bg: 'bg-slate-100', fg: 'text-slate-500' };

  const paths = {
    view_finance_dashboard: (
      <path d="M4 15.5 8.5 11l3.5 3 5-6M17.5 8h2.5v2.5" strokeLinecap="round" strokeLinejoin="round" />
    ),
    view_hr_dashboard: (
      <>
        <circle cx="9" cy="8.5" r="2.5" />
        <path d="M4 18c.5-3 2.3-4.5 5-4.5s4.5 1.5 5 4.5" strokeLinecap="round" />
        <circle cx="17" cy="9" r="2" />
        <path d="M15.8 13.2c1.9.4 3 1.7 3.4 3.8" strokeLinecap="round" />
      </>
    ),
    manager_dashboard: (
      <>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 3.5h6v2H9z" />
        <path d="M8.5 11.5l2 2 4-4.2M8.5 16h5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  };

  return (
    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone.bg} ${tone.fg}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
        {paths[featureKey] ?? <circle cx="12" cy="12" r="3" />}
      </svg>
    </div>
  );
}

function FeatureCard({ featureKey, title, description, enabled, path, expiresAt }) {
  const countdown = useCountdown(expiresAt);
  // A card can be permission-enabled but locally past its computed expiry
  // for up to 30s before the next tick / the next session refresh confirms
  // it server-side — treat that window as already expired rather than
  // showing a live "Open →" on a grant that's actually timed out.
  const effectivelyEnabled = enabled && !countdown.expired;

  return (
    <div className={effectivelyEnabled ? 'card-interactive relative' : 'card relative opacity-70'}>
      {effectivelyEnabled && countdown.active && (
        <span
          className={`pill absolute right-4 top-4 ${COUNTDOWN_BADGE_TONES[countdown.tone]}`}
        >
          <span aria-hidden="true">⏱</span> {countdown.label}
        </span>
      )}

      <FeatureIcon featureKey={featureKey} />
      <h3 className="mt-4 font-display font-semibold text-ink-900">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>

      <div className="mt-4">
        {countdown.expired ? (
          <span className="text-xs font-medium text-rose-500">
            Access expired — request again
          </span>
        ) : effectivelyEnabled && path ? (
          <Link
            to={path}
            className="inline-flex items-center gap-1 text-sm font-medium text-signal-700 hover:text-signal-800"
          >
            Open <span aria-hidden="true">→</span>
          </Link>
        ) : effectivelyEnabled ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm font-medium text-signal-700 hover:text-signal-800"
          >
            Open <span aria-hidden="true">→</span>
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            Restricted
          </span>
        )}
      </div>
    </div>
  );
}

function Toast({ type, message, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const isError = type === 'error';

  return (
    <div
      role="status"
      className={`animate-toast-in fixed bottom-6 right-6 z-[60] flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-panel ${
        isError
          ? 'border-rose-200 bg-white text-rose-700'
          : 'border-emerald-200 bg-white text-emerald-700'
      }`}
    >
      <span
        className={`flex h-6 w-6 flex-none items-center justify-center rounded-full ${
          isError ? 'bg-rose-100' : 'bg-emerald-100'
        }`}
        aria-hidden="true"
      >
        {isError ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 8v5M12 16.5h.01" strokeLinecap="round" />
            <circle cx="12" cy="12" r="9" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-2 text-current opacity-50 hover:opacity-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50/60">
      <Header />
      <div className="mx-auto max-w-5xl animate-pulse p-6 md:p-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-slate-200" />
            <div className="space-y-2">
              <div className="h-4 w-40 rounded bg-slate-200" />
              <div className="h-3 w-24 rounded bg-slate-200" />
            </div>
          </div>
          <div className="h-9 w-36 rounded-lg bg-slate-200" />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card">
              <div className="mb-4 h-10 w-10 rounded-xl bg-slate-200" />
              <div className="mb-2 h-4 w-2/3 rounded bg-slate-200" />
              <div className="h-3 w-full rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// <select> values are always strings, so 'permanent' is a sentinel rather
// than using '' (which would be ambiguous with "not yet chosen") or null
// (which can't be a JSX select value). Converted to a real durationHours
// number|null right before it's sent — see handleSubmit below.
const DURATION_OPTIONS = [
  { value: '4', label: '4 hours' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: 'permanent', label: 'Permanent' },
];

function RequestAccessModal({ roles, rolesStatus, onClose, onSubmit, submitting }) {
  const [selectedRoleId, setSelectedRoleId] = useState('');
  // Defaults to 'permanent' so a request submitted without anyone touching
  // this field behaves exactly like it did before this control existed.
  const [duration, setDuration] = useState('permanent');

  // roles load asynchronously after the modal opens, so default the
  // selection once they arrive instead of only on mount.
  useEffect(() => {
    if (rolesStatus === 'ready' && roles.length > 0 && !selectedRoleId) {
      setSelectedRoleId(roles[0].id);
    }
  }, [rolesStatus, roles, selectedRoleId]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const role = roles.find((r) => String(r.id) === String(selectedRoleId));
    const durationHours = duration === 'permanent' ? null : Number(duration);
    onSubmit(role, durationHours);
  };

  const canSubmit = rolesStatus === 'ready' && roles.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-900">Request Access</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {rolesStatus === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-signal-600"
                aria-hidden="true"
              />
              Loading roles…
            </div>
          )}

          {rolesStatus === 'error' && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Could not load the list of roles. Please try again.
            </p>
          )}

          {rolesStatus === 'ready' && roles.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              No roles are available to request right now.
            </p>
          )}

          {rolesStatus === 'ready' && roles.length > 0 && (
            <div>
              <label htmlFor="role" className="field-label">
                Role
              </label>
              <select
                id="role"
                value={selectedRoleId}
                onChange={(e) => setSelectedRoleId(e.target.value)}
                className="input-field"
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} — {role.description}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="duration" className="field-label">
              Duration
            </label>
            <select
              id="duration"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="input-field"
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !canSubmit}
              className="btn-accent"
            >
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RequestLeaveModal({ onClose, onSubmit, submitting }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!startDate || !endDate) {
      setError('Start and end date are both required.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }

    setError('');
    onSubmit({ startDate, endDate, reason: reason.trim() || null });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink-900">Request Leave</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="startDate" className="field-label">
                Start date
              </label>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="endDate" className="field-label">
                End date
              </label>
              <input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input-field"
              />
            </div>
          </div>

          <div>
            <label htmlFor="reason" className="field-label">
              Reason (optional)
            </label>
            <textarea
              id="reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Family vacation"
              className="input-field"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-accent"
            >
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [checkedStorage, setCheckedStorage] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success' | 'error', message }
  const [roles, setRoles] = useState([]);
  const [rolesStatus, setRolesStatus] = useState('idle'); // idle | loading | ready | error
  const [refreshing, setRefreshing] = useState(false);
  const [myRequests, setMyRequests] = useState([]);
  const [myRequestsStatus, setMyRequestsStatus] = useState('idle'); // idle | loading | ready | error
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [myLeaveRequests, setMyLeaveRequests] = useState([]);
  const [myLeaveRequestsStatus, setMyLeaveRequestsStatus] = useState('idle'); // idle | loading | ready | error
  const [myTasks, setMyTasks] = useState([]);
  const [myTasksStatus, setMyTasksStatus] = useState('idle'); // idle | loading | ready | error
  const [taskUpdating, setTaskUpdating] = useState({}); // id -> true while a status update is in flight

  // Pulls the latest roles/permissions from the server and writes them
  // back into sessionStorage + state. Called on mount and from the manual
  // "Refresh access" button — this is what makes an admin's approval show
  // up without the user having to log out and back in.
  async function refreshSession() {
    setRefreshing(true);
    try {
      const fresh = await getMe();
      setUser((prev) => {
        const merged = { ...prev, ...fresh };
        sessionStorage.setItem('user', JSON.stringify(merged));

        // Surface anything newly granted since the last refresh (e.g. an
        // admin just approved a pending request) so it doesn't go
        // unnoticed until the user happens to reload.
        //
        // GET /auth/me now returns { id, name, email, roles, permissions },
        // same shape as POST /auth/login — this block is live, not a
        // no-op: this is what actually surfaces a newly-approved request
        // via the "Refresh access" button / the fire-and-forget call on
        // mount, without the user having to log out and back in.
        const prevPermissions = Array.isArray(prev?.permissions) ? prev.permissions : [];
        const newPermissions = Array.isArray(merged.permissions) ? merged.permissions : [];
        const newlyGranted = newPermissions.filter((p) => !prevPermissions.includes(p));

        if (newlyGranted.length > 0) {
          const label =
            newlyGranted.length === 1
              ? permissionLabel(newlyGranted[0])
              : `${newlyGranted.length} new features`;
          setToast({
            type: 'success',
            message: `You now have access to ${label}.`,
          });
        }

        return merged;
      });
    } catch (err) {
      // Non-fatal — keep showing whatever we already have from
      // sessionStorage rather than blocking the page.
      console.error('Failed to refresh session:', err);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const raw = sessionStorage.getItem('user');

    if (!raw) {
      window.location.href = '/';
      return;
    }

    try {
      const parsedUser = JSON.parse(raw);
      setUser(parsedUser);
    } catch (err) {
      // Malformed JSON in sessionStorage — treat same as "not logged in"
      console.error('Failed to parse user from sessionStorage:', err);
      sessionStorage.removeItem('user');
      window.location.href = '/';
      return;
    }

    setCheckedStorage(true);
    // Fire-and-forget refresh right after showing the cached session, so
    // the page paints immediately but corrects itself if roles changed
    // since last login.
    refreshSession();
  }, []);

  // Loads the current user's own access requests for the "My requests"
  // section. Separate effect (rather than folded into the session-check
  // effect above) so a failure here never blocks the rest of the page
  // from rendering.
  useEffect(() => {
    if (!checkedStorage) return;

    let cancelled = false;
    setMyRequestsStatus('loading');

    getMyAccessRequests()
      .then((data) => {
        if (cancelled) return;
        setMyRequests(data);
        setMyRequestsStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load my access requests:', err);
        setMyRequestsStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [checkedStorage]);

  // Loads the current user's own leave requests for the "My Leave Requests"
  // list. Separate effect from access requests above, same reasoning: a
  // failure here shouldn't block the rest of the page.
  useEffect(() => {
    if (!checkedStorage) return;

    let cancelled = false;
    setMyLeaveRequestsStatus('loading');

    getMyLeaveRequests()
      .then((data) => {
        if (cancelled) return;
        setMyLeaveRequests(data);
        setMyLeaveRequestsStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load my leave requests:', err);
        setMyLeaveRequestsStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [checkedStorage]);

  // Loads the current user's own assigned tasks for the "My Tasks"
  // section. Separate effect, same reasoning as the leave/access requests
  // effects above: a failure here shouldn't block the rest of the page.
  useEffect(() => {
    if (!checkedStorage) return;

    let cancelled = false;
    setMyTasksStatus('loading');

    getMyTasks()
      .then((data) => {
        if (cancelled) return;
        setMyTasks(data);
        setMyTasksStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load my tasks:', err);
        setMyTasksStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [checkedStorage]);

  const openRequestModal = async () => {
    setModalOpen(true);
    setRolesStatus('loading');
    try {
      const data = await getAvailableRoles();
      setRoles(data);
      setRolesStatus('ready');
    } catch (err) {
      console.error('Failed to load roles:', err);
      setRolesStatus('error');
    }
  };

  const handleRequestSubmit = async (role, durationHours) => {
    if (!role) return;

    setSubmitting(true);

    try {
      await requestAccess(role.id, durationHours);
      setModalOpen(false);
      setToast({
        type: 'success',
        message: `Access request for "${role.name}" submitted — an admin will review it.`,
      });
    } catch (err) {
      console.error('Failed to submit access request:', err);
      const message =
        err.response?.data?.error ||
        'Could not submit your request. Please try again.';
      setToast({ type: 'error', message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLeaveSubmit = async ({ startDate, endDate, reason }) => {
    setLeaveSubmitting(true);

    try {
      await submitLeaveRequest({ startDate, endDate, reason });
      setLeaveModalOpen(false);
      setToast({
        type: 'success',
        message: 'Leave request submitted — your manager will review it.',
      });
      // Refresh the list so the new request shows up immediately.
      setMyLeaveRequestsStatus('loading');
      getMyLeaveRequests()
        .then((data) => {
          setMyLeaveRequests(data);
          setMyLeaveRequestsStatus('ready');
        })
        .catch((err) => {
          console.error('Failed to reload my leave requests:', err);
          setMyLeaveRequestsStatus('error');
        });
    } catch (err) {
      console.error('Failed to submit leave request:', err);
      const message =
        err.response?.data?.error ||
        'Could not submit your leave request. Please try again.';
      setToast({ type: 'error', message });
    } finally {
      setLeaveSubmitting(false);
    }
  };

  const handleTaskStatusUpdate = async (taskId, nextStatus) => {
    setTaskUpdating((prev) => ({ ...prev, [taskId]: true }));

    try {
      const updated = await updateTaskStatus(taskId, nextStatus);
      setMyTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, ...updated, status: nextStatus } : t))
      );
    } catch (err) {
      console.error('Failed to update task status:', err);
      setToast({
        type: 'error',
        message: "Couldn't update this task. Please try again.",
      });
    } finally {
      setTaskUpdating((prev) => ({ ...prev, [taskId]: false }));
    }
  };

  // Avoid a flash of empty content until we've checked sessionStorage —
  // show a skeleton instead of nothing while that resolves.
  if (!checkedStorage || !user) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="min-h-screen bg-slate-50/60">
      <Header />
      <div className="mx-auto max-w-5xl p-6 md:p-10">
        {/* Page toolbar — identity + logout now live in the shared
            <Header /> above; this keeps only what's specific to this page
            (a greeting, plus the two action buttons Header doesn't have).
            Roles are still shown in full below in "My roles & permissions",
            so dropping the duplicate role pills that used to be up here
            isn't a loss of information. */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink-900">
              Welcome, {user.name}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Here's what you have access to right now.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={refreshSession}
              disabled={refreshing}
              title="Pull the latest roles/permissions if an admin just approved a request"
              className="btn-secondary"
            >
              {refreshing ? 'Refreshing…' : 'Refresh access'}
            </button>
            <button
              type="button"
              onClick={openRequestModal}
              className="btn-accent"
            >
              Request Access
            </button>
            <button
              type="button"
              onClick={() => setLeaveModalOpen(true)}
              className="btn-secondary"
            >
              Request Leave
            </button>
          </div>
        </div>

        {/* Feature grid */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <FeatureCard
              key={feature.key}
              featureKey={feature.key}
              title={feature.title}
              description={feature.description}
              enabled={
                feature.roleGate
                  ? user.roles.includes(feature.roleGate)
                  : user.permissions.includes(feature.key)
              }
              path={feature.path}
              expiresAt={user.roleExpirations?.[feature.roleGate ?? feature.role]}
            />
          ))}
        </div>

        {/* Roles & permissions — read straight from sessionStorage, no API call */}
        <div className="card mt-8">
          <h2 className="font-display font-semibold text-ink-900">My roles &amp; permissions</h2>

          <div className="mt-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Roles
            </h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {user.roles.length > 0 ? (
                user.roles.map((role) => (
                  <span
                    key={role}
                    className="rounded-full bg-ink-900 px-2.5 py-1 text-xs font-medium capitalize text-white"
                  >
                    {role}
                  </span>
                ))
              ) : (
                <span className="text-xs font-medium italic text-slate-400">
                  No roles assigned yet
                </span>
              )}
            </div>
          </div>

          <div className="mt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Permissions
            </h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {user.permissions.length > 0 ? (
                user.permissions.map((permission) => (
                  <span
                    key={permission}
                    className="rounded-full bg-signal-50 px-2.5 py-1 text-xs font-medium text-signal-700 ring-1 ring-inset ring-signal-100"
                  >
                    {permission}
                  </span>
                ))
              ) : (
                <span className="text-xs font-medium italic text-slate-400">
                  No permissions granted yet
                </span>
              )}
            </div>
          </div>
        </div>

        {/* My Tasks — wired up against GET /tasks/me and PUT /tasks/:id/status. */}
        <div className="card mt-8 overflow-hidden p-0">
          <div className="flex items-center justify-between p-5 pb-0">
            <h2 className="font-display font-semibold text-ink-900">My Tasks</h2>
          </div>

          <div className="mt-4 overflow-x-auto">
            {myTasksStatus === 'loading' && (
              <p className="px-5 pb-5 text-sm text-slate-400">Loading your tasks…</p>
            )}

            {myTasksStatus === 'error' && (
              <p className="px-5 pb-5 text-sm text-rose-500">
                Couldn't load your tasks. Please try again later.
              </p>
            )}

            {myTasksStatus === 'ready' && myTasks.length === 0 && (
              <p className="px-5 pb-5 text-sm text-slate-400">
                No tasks assigned to you yet.
              </p>
            )}

            {myTasksStatus === 'ready' && myTasks.length > 0 && (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Title</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Description</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Due date</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {myTasks.map((task) => {
                    const { label, tone } = taskStatusInfo(task.status);
                    const next = NEXT_TASK_STATUS[task.status];
                    const isBusy = !!taskUpdating[task.id];
                    return (
                      <tr key={task.id}>
                        <td className="px-5 py-3 font-medium text-slate-800">{task.title}</td>
                        <td className="px-5 py-3 text-slate-600">{task.description || '—'}</td>
                        <td className="px-5 py-3 text-slate-500">{formatDateOnly(task.dueDate)}</td>
                        <td className="px-5 py-3">
                          <Pill tone={tone}>{label}</Pill>
                        </td>
                        <td className="px-5 py-3 text-right">
                          {next ? (
                            <button
                              type="button"
                              onClick={() => handleTaskStatusUpdate(task.id, next.value)}
                              disabled={isBusy}
                              className="btn-primary btn-sm"
                            >
                              {isBusy ? 'Updating…' : next.label}
                            </button>
                          ) : (
                            <span className="text-xs italic text-slate-400">Complete</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* My Leave Requests — wired up against GET /leave-requests/me. */}
        <div className="card mt-8 overflow-hidden p-0">
          <div className="flex items-center justify-between p-5 pb-0">
            <h2 className="font-display font-semibold text-ink-900">My Leave Requests</h2>
          </div>

          <div className="mt-4 overflow-x-auto">
            {myLeaveRequestsStatus === 'loading' && (
              <p className="px-5 pb-5 text-sm text-slate-400">Loading your leave requests…</p>
            )}

            {myLeaveRequestsStatus === 'error' && (
              <p className="px-5 pb-5 text-sm text-rose-500">
                Couldn't load your leave requests. Please try again later.
              </p>
            )}

            {myLeaveRequestsStatus === 'ready' && myLeaveRequests.length === 0 && (
              <p className="px-5 pb-5 text-sm text-slate-400">
                You haven't requested any leave yet.
              </p>
            )}

            {myLeaveRequestsStatus === 'ready' && myLeaveRequests.length > 0 && (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Dates</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requested</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Manager comment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {myLeaveRequests.map((req) => {
                    const { label, tone } = leaveStatusInfo(req.status);
                    return (
                      <tr key={req.id}>
                        <td className="px-5 py-3 font-medium text-slate-800">
                          {formatDateOnly(req.startDate)} – {formatDateOnly(req.endDate)}
                        </td>
                        <td className="px-5 py-3 text-slate-600">{req.reason || '—'}</td>
                        <td className="px-5 py-3 text-slate-500">{formatDate(req.requestedAt)}</td>
                        <td className="px-5 py-3">
                          <Pill tone={tone}>{label}</Pill>
                        </td>
                        <td className="px-5 py-3 text-slate-500">{req.managerComment || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* My requests — wired up against GET /access-requests/me. Backend
            Dev 1 hasn't shipped that endpoint yet (see client.js), so this
            currently renders the documented-shape mock data; the table
            itself doesn't need to change once the real endpoint lands. */}
        <div className="card mt-8 overflow-hidden p-0">
          <div className="flex items-center justify-between p-5 pb-0">
            <h2 className="font-display font-semibold text-ink-900">My requests</h2>
          </div>

          <div className="mt-4 overflow-x-auto">
            {myRequestsStatus === 'loading' && (
              <p className="px-5 pb-5 text-sm text-slate-400">Loading your requests…</p>
            )}

            {myRequestsStatus === 'error' && (
              <p className="px-5 pb-5 text-sm text-rose-500">
                Couldn't load your access requests. Please try again later.
              </p>
            )}

            {myRequestsStatus === 'ready' && myRequests.length === 0 && (
              <p className="px-5 pb-5 text-sm text-slate-400">
                You haven't requested any access yet.
              </p>
            )}

            {myRequestsStatus === 'ready' && myRequests.length > 0 && (
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Resource</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requested access</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requested</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Manager decision</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Admin decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {myRequests.map((req) => {
                    const { label, tone } = statusInfo(req.status);
                    return (
                      <tr key={req.id}>
                        <td className="px-5 py-3 font-medium text-slate-800">{req.resource}</td>
                        <td className="px-5 py-3 capitalize text-slate-600">{req.requestedAccess}</td>
                        <td className="px-5 py-3 text-slate-500">{formatDate(req.requestedAt)}</td>
                        <td className="px-5 py-3">
                          <Pill tone={tone}>{label}</Pill>
                        </td>
                        <td className="px-5 py-3">
                          <DecisionCell decision={req.managerDecision} />
                        </td>
                        <td className="px-5 py-3">
                          <DecisionCell decision={req.adminDecision} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {modalOpen && (
        <RequestAccessModal
          roles={roles}
          rolesStatus={rolesStatus}
          onClose={() => setModalOpen(false)}
          onSubmit={handleRequestSubmit}
          submitting={submitting}
        />
      )}

      {leaveModalOpen && (
        <RequestLeaveModal
          onClose={() => setLeaveModalOpen(false)}
          onSubmit={handleLeaveSubmit}
          submitting={leaveSubmitting}
        />
      )}

      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}