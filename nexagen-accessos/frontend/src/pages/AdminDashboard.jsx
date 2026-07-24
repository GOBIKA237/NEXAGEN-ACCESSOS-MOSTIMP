// Owned by Frontend Dev 2 (UI built for Frontend Dev 3's request). Admin tabs:
// Users, Roles, Access Requests, Audit Log. Alerts render as a persistent
// banner above the tabs rather than as their own tab.
import { Component, useEffect, useState } from 'react';
import Header from '../components/Header.jsx';
import {
  api,
  getUsers,
  getRoles,
  getAccessRequests,
  getAuditLogs,
  getAlerts,
  approveRequest,
  denyRequest,
  revokeRequest,
  invalidateSession,
} from '../api/client.js';

// --- Roles / permissions / user-role-assignment API calls ----------------
// Not yet in api/client.js (out of scope for this file's owner to add
// there), so they're defined locally using the shared `api` axios
// instance. Shapes per docs/api-contract.md.
async function getPermissions() {
  const { data } = await api.get('/admin/permissions');
  return data;
}

async function createRole(payload) {
  const { data } = await api.post('/admin/roles', payload);
  return data;
}

async function updateRole(id, payload) {
  const { data } = await api.put(`/admin/roles/${id}`, payload);
  return data;
}

async function deleteRole(id) {
  await api.delete(`/admin/roles/${id}`);
}

// --- CSV export (Frontend Dev 3) ------------------------------------------
// Both export endpoints sit behind the same requireAuth as every other
// /admin route, and requireAuth only reads the token from the Authorization
// header (see backend/src/middleware/auth.js — no query-param fallback), so
// a plain `window.location.href` download would hit these unauthenticated
// and 401. Fetching as a blob through the shared `api` instance (its
// request interceptor already attaches the Bearer token) and triggering the
// save via a throwaway <a download> avoids that.
function triggerCsvDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

async function exportUsersCsv() {
  const { data } = await api.get('/admin/users/export.csv', { responseType: 'blob' });
  triggerCsvDownload(data, 'users.csv');
}

// NOTE: depends on Backend Dev 3's GET /admin/audit-logs/export.csv, which
// was not yet merged as of this file's last update — the "Export audit
// log" button below will surface exportError until that endpoint lands.
// Not a bug in this file; a known ordering dependency between the two
// teammates' work.
async function exportAuditLogCsv() {
  const { data } = await api.get('/admin/audit-logs/export.csv', { responseType: 'blob' });
  triggerCsvDownload(data, 'audit-log.csv');
}

// `confirm: true` on a retry after a 409 conflict skips the overlap check
// server-side (see PUT /users/:id/roles in rbac.routes.js) and applies the
// roles anyway. Verified working end-to-end as of Backend Dev 2's latest
// changes — a confirmed retry now returns 200 instead of 409 again.
async function updateUserRoles(id, roleIds, { confirm } = {}) {
  const { data } = await api.put(`/admin/users/${id}/roles`, {
    roleIds,
    ...(confirm ? { confirm: true } : {}),
  });
  return data;
}

// POST /admin/users/bulk-import — creates NEW user accounts from CSV rows
// ({ name, email, role }), unlike updateUserRoles above which only
// reassigns roles on users that already exist. Returns 207 with a
// per-row result array (see rbac.routes.js) even when some rows failed,
// so callers should read `results`/`createdCount`/`errorCount` rather
// than relying on the HTTP status alone.
async function bulkCreateUsers(rows) {
  const { data } = await api.post('/admin/users/bulk-import', { rows });
  return data;
}

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'roles', label: 'Roles' },
  { key: 'requests', label: 'Access Requests' },
  { key: 'audit', label: 'Audit Log' },
  { key: 'alerts', label: 'Alerts' },
];

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// Matches the "impossible travel: CityA → CityB at Xkm/h" reason string
// documented for GET /admin/alerts. Tolerant of "->" as a fallback in case
// the arrow character doesn't round-trip through some client somewhere.
const IMPOSSIBLE_TRAVEL_RE =
  /impossible travel:\s*(.+?)\s*(?:→|->)\s*(.+?)\s+at\s+([\d.,]+)\s*km\/h/i;

function parseImpossibleTravel(reason) {
  if (!reason) return null;
  const match = reason.match(IMPOSSIBLE_TRAVEL_RE);
  if (!match) return null;
  return { from: match[1].trim(), to: match[2].trim(), speedKmh: match[3].trim() };
}

function PlaneIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 16v-2l-8-5V4.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2.5 1.5V22l4-1 4 1v-1.5L13 19v-5.5l8 2.5z" />
    </svg>
  );
}

// durationHours is the requester's *ask* (set at submission, see
// Request.routes.js POST /access-requests) — distinct from expiresAt, which
// only gets stamped once an admin actually approves. A pending request can
// have durationHours set and still have expiresAt = null; this formats that
// still-pending ask so the table doesn't show "Permanent" for a request
// that's actually temporary, just not decided yet.
function formatRequestedDuration(durationHours) {
  if (!durationHours) return null;
  if (durationHours % 24 === 0) {
    const days = durationHours / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${durationHours} hour${durationHours === 1 ? '' : 's'}`;
}

// expiresAt comes back per-row on GET /admin/access-requests / granted
// roles; null/undefined means the grant doesn't expire.
function formatExpiry(expiresAt) {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days >= 1) return `in ${days}d`;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours >= 1) return `in ${hours}h`;
  const mins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
  return `in ${mins}m`;
}

function StatusPill({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
    red: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
    amber: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  };
  const dots = {
    slate: 'bg-slate-400',
    green: 'bg-emerald-500',
    red: 'bg-rose-500',
    amber: 'bg-amber-500',
  };
  return (
    <span className={`pill ${tones[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function LoadingRow({ colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8">
        <div className="mx-auto flex max-w-xs animate-pulse flex-col gap-2">
          <div className="h-2.5 rounded-full bg-slate-200" />
          <div className="h-2.5 w-2/3 rounded-full bg-slate-100" />
        </div>
      </td>
    </tr>
  );
}

function ErrorRow({ colSpan, message }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm font-medium text-rose-500">
        ⚠ {message}
      </td>
    </tr>
  );
}

function EmptyRow({ colSpan, message }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-400">
        {message}
      </td>
    </tr>
  );
}

// --- Tab error boundary ----------------------------------------------------
// Isolates a crash (e.g. an unexpected API shape) to the tab that caused it,
// instead of taking down the whole Admin page. `resetKey` should be the
// active tab key so switching tabs clears a previous error.
class TabErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Admin tab crashed:', error, info);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="px-4 py-10 text-center text-sm text-rose-500">
          Something went wrong loading this tab.
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Alert banner --------------------------------------------------------

function AlertBanner() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    getAlerts()
      .then((data) => {
        if (!cancelled) setAlerts(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = alerts.filter((a) => !dismissed.has(a.id));

  if (loading || visible.length === 0) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <ul className="divide-y divide-amber-100">
        {visible.map((alert) => {
          const high = alert.riskScore > 50;
          const route = parseImpossibleTravel(alert.reason);
          const isImpossibleTravel = !!route;
          return (
            <li
              key={alert.id}
              className={`flex items-center justify-between gap-4 px-6 py-2.5 text-sm ${
                isImpossibleTravel
                  ? 'border-l-4 border-rose-500 bg-rose-50 pl-5'
                  : high
                  ? 'bg-rose-50'
                  : 'bg-amber-50'
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-semibold ${
                    high ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                  }`}
                  aria-hidden="true"
                >
                  !
                </span>
                <div className="min-w-0">
                  <span className={`truncate ${high ? 'text-rose-800' : 'text-amber-800'}`}>
                    {alert.reason}
                  </span>
                  {isImpossibleTravel && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-rose-700">
                      <PlaneIcon className="h-3 w-3" />
                      <span>
                        {route.from} → {route.to}
                      </span>
                    </div>
                  )}
                </div>
                <StatusPill tone={high ? 'red' : 'amber'}>
                  Risk {alert.riskScore}
                </StatusPill>
                <span className="hidden text-xs text-slate-400 sm:inline">
                  {formatDate(alert.createdAt)}
                </span>
              </div>
              <button
                onClick={() =>
                  setDismissed((prev) => new Set(prev).add(alert.id))
                }
                className="flex-none text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Dismiss
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// --- Data hook ------------------------------------------------------------

function useTabData(fetcher, deps = []) {
  const [data, setData] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetcher()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  const refetch = () => setReloadToken((t) => t + 1);

  return [data, status, refetch];
}

// --- Alerts tab -------------------------------------------------------
// Alerts already surface as a dismissible banner (above); this is the
// same GET /admin/alerts data as a browsable list, for anyone who dismissed
// the banner or wants the full history rather than just what's currently
// undismissed. Response shape confirmed against backend/src/routes/
// alerts.routes.js: [{ id, userId, riskScore, reason, createdAt }] —
// matches docs/api-contract.md exactly. The routing bug that made this
// 404 (doubled '/admin' prefix) is fixed.
function AlertsTab() {
  const [alerts, status] = useTabData(getAlerts);
  const [pending, setPending] = useState({}); // id -> true while request is in flight
  const [rowError, setRowError] = useState({}); // id -> error message
  const [invalidated, setInvalidated] = useState({}); // id -> true once done
  const colSpan = 5;

  // Backend: POST /admin/alerts/:id/invalidate-session — :id is the
  // login_events row (this alert), not a user id. Forces every token that
  // user currently holds to stop working on their next request; there's no
  // separate state to re-fetch afterward, so success just flips this row
  // to a confirmed state rather than triggering a refetch of the list.
  async function handleInvalidate(alertId) {
    setPending((prev) => ({ ...prev, [alertId]: true }));
    setRowError((prev) => ({ ...prev, [alertId]: null }));

    try {
      await invalidateSession(alertId);
      setInvalidated((prev) => ({ ...prev, [alertId]: true }));
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [alertId]: "Couldn't invalidate this session. Try again.",
      }));
    } finally {
      setPending((prev) => ({ ...prev, [alertId]: false }));
    }
  }

  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50/70">
        <tr>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Risk</th>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</th>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">User</th>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">When</th>
          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {status === 'loading' && <LoadingRow colSpan={colSpan} />}
        {status === 'error' && (
          <ErrorRow colSpan={colSpan} message="Couldn't load alerts." />
        )}
        {status === 'ready' && alerts.length === 0 && (
          <EmptyRow colSpan={colSpan} message="No alerts." />
        )}
        {status === 'ready' &&
          alerts.map((alert) => {
            const high = alert.riskScore > 50;
            const route = parseImpossibleTravel(alert.reason);
            const isImpossibleTravel = !!route;
            const isPending = !!pending[alert.id];
            const error = rowError[alert.id];
            return (
              <tr
                key={alert.id}
                className={`hover:bg-slate-50 ${isImpossibleTravel ? 'bg-rose-50/40' : ''}`}
              >
                <td
                  className={`px-4 py-3 ${
                    isImpossibleTravel ? 'border-l-4 border-rose-500' : ''
                  }`}
                >
                  <StatusPill tone={high ? 'red' : 'amber'}>
                    {alert.riskScore}
                  </StatusPill>
                </td>
                <td className="px-4 py-3 text-slate-700">
                  {alert.reason}
                  {isImpossibleTravel && (
                    <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-rose-700">
                      <PlaneIcon className="h-3 w-3" />
                      <span>
                        {route.from} → {route.to}
                      </span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  User #{alert.userId}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {formatDate(alert.createdAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-1">
                    {invalidated[alert.id] ? (
                      <StatusPill tone="slate">Session invalidated</StatusPill>
                    ) : (
                      <button
                        onClick={() => handleInvalidate(alert.id)}
                        disabled={isPending}
                        className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPending ? 'Invalidating…' : 'Invalidate session'}
                      </button>
                    )}
                    {error && (
                      <span className="text-xs text-rose-500">{error}</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

// --- Tabs -------------------------------------------------------------

// Roles come back from GET /admin/users as either an array of name strings
// (per docs/api-contract.md) or, if that field is ever missing, undefined —
// normalize both so a render never throws on `.map`.
function userRoleNames(user) {
  return Array.isArray(user.roles) ? user.roles : [];
}

function UsersTab() {
  const [users, status, refetchUsers] = useTabData(getUsers);
  const [allRoles, rolesStatus] = useTabData(getRoles);
  const [editingUser, setEditingUser] = useState(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const colSpan = 4;

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      await exportUsersCsv();
    } catch (err) {
      setExportError("Couldn't export users.");
    } finally {
      setExporting(false);
    }
  }

  const q = query.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    const matchesQuery =
      !q ||
      user.name?.toLowerCase().includes(q) ||
      user.email?.toLowerCase().includes(q);
    const matchesRole =
      roleFilter === 'all' || userRoleNames(user).includes(roleFilter);
    return matchesQuery && matchesRole;
  });
  const isFiltered = q.length > 0 || roleFilter !== 'all';

  const roleCounts = allRoles.map((role) => ({
    name: role.name,
    count: users.filter((u) => userRoleNames(u).includes(role.name)).length,
  }));

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email…"
          className="w-56 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          disabled={rolesStatus !== 'ready'}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm disabled:opacity-50"
        >
          <option value="all">All roles</option>
          {allRoles.map((role) => (
            <option key={role.id} value={role.name}>
              {role.name}
            </option>
          ))}
        </select>

        {/* Two independent features, deliberately side by side: "Bulk
            import" (Frontend Dev 1) reassigns roles on existing users from
            a CSV; "Export users" (Frontend Dev 3) downloads the current
            list. They don't depend on each other. */}
        <button
          type="button"
          onClick={() => setShowBulkCreate(true)}
          disabled={rolesStatus !== 'ready'}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Create users (Bulk)
        </button>
        <button
          type="button"
          onClick={() => setShowBulkImport(true)}
          disabled={status !== 'ready' || rolesStatus !== 'ready'}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Bulk import roles
        </button>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-secondary btn-sm"
        >
          {exporting ? 'Exporting…' : 'Export users'}
        </button>
        {exportError && <span className="text-xs text-rose-500">{exportError}</span>}
      </div>

      {status === 'ready' && rolesStatus === 'ready' && roleCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          {roleCounts.map((r) => (
            <StatusPill key={r.name} tone="slate">
              {r.name}: {r.count}
            </StatusPill>
          ))}
        </div>
      )}

      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/70">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Email</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Roles</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {status === 'loading' && <LoadingRow colSpan={colSpan} />}
          {status === 'error' && (
            <ErrorRow colSpan={colSpan} message="Couldn't load users." />
          )}
          {status === 'ready' && users.length === 0 && (
            <EmptyRow colSpan={colSpan} message="No users found." />
          )}
          {status === 'ready' && users.length > 0 && filteredUsers.length === 0 && (
            <EmptyRow
              colSpan={colSpan}
              message={
                isFiltered
                  ? 'No users match your search.'
                  : 'No users found.'
              }
            />
          )}
          {status === 'ready' &&
            filteredUsers.map((user) => (
              <tr key={user.id} className="transition-colors hover:bg-signal-50/60">
                <td className="px-4 py-3 font-medium text-slate-800">{user.name}</td>
                <td className="px-4 py-3 text-slate-500">{user.email}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {userRoleNames(user).length === 0 && (
                      <span className="text-slate-400">—</span>
                    )}
                    {userRoleNames(user).map((role) => (
                      <StatusPill key={role} tone="slate">
                        {role}
                      </StatusPill>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setEditingUser(user)}
                    disabled={rolesStatus !== 'ready'}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Manage roles
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      {editingUser && (
        <AssignRolesModal
          user={editingUser}
          allRoles={allRoles}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null);
            refetchUsers();
          }}
        />
      )}

      {showBulkImport && (
        <BulkImportModal
          users={users}
          allRoles={allRoles}
          onClose={() => setShowBulkImport(false)}
          onSaved={() => {
            setShowBulkImport(false);
            refetchUsers();
          }}
        />
      )}

      {showBulkCreate && (
        <BulkCreateUsersModal
          allRoles={allRoles}
          onClose={() => setShowBulkCreate(false)}
          onSaved={() => {
            // Deliberately NOT auto-closing the modal here (unlike
            // BulkImportModal's onSaved) — the admin still needs to click
            // "Download credentials" for the generated passwords before the
            // modal goes away, since those are only ever shown once.
            refetchUsers();
          }}
        />
      )}
    </>
  );
}

// --- Bulk import modal ------------------------------------------------------
// Frontend-only: reuses the existing PUT /admin/users/:id/roles endpoint
// (updateUserRoles, defined above) per-row instead of a dedicated bulk
// endpoint — there isn't one in docs/api-contract.md. CSV format is
// `email,roles` with a header row, roles semicolon-separated, e.g.:
//   email,roles
//   alice@nexagen.com,Manager;Auditor
//   bob@nexagen.com,Employee
//
// NOTE: this reassigns roles on EXISTING users matched by email — it's a
// different feature from rbac.routes.js's POST /admin/users/bulk-import
// (which CREATES new user accounts from a CSV). The names sound similar
// but they don't overlap: this modal never creates a user, and the backend
// bulk-import endpoint isn't wired to any UI yet. Worth clarifying with
// the team so "bulk import" doesn't mean two different things in standups.

// Very small CSV split — good enough for the email,roles shape above.
// Doesn't handle quoted commas; fine for this two-column format.
function parseBulkImportCsv(csvText, allRoles) {
  const roleByName = new Map(allRoles.map((r) => [r.name.toLowerCase(), r]));
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstCols = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const dataLines = firstCols[0] === 'email' ? lines.slice(1) : lines;

  return dataLines.map((line, i) => {
    const [rawEmail = '', rawRoles = ''] = line.split(',');
    const email = rawEmail.trim();
    const roleNames = rawRoles
      .split(';')
      .map((r) => r.trim())
      .filter(Boolean);

    const roleIds = [];
    const unknownRoles = [];
    for (const name of roleNames) {
      const role = roleByName.get(name.toLowerCase());
      if (role) roleIds.push(role.id);
      else unknownRoles.push(name);
    }

    return { line: i + 1, email, roleNames, roleIds, unknownRoles };
  });
}

function BulkImportModal({ users, allRoles, onClose, onSaved }) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [submitError, setSubmitError] = useState(null);

  const userByEmail = new Map(users.map((u) => [u.email?.toLowerCase(), u]));

  const parsedRows = parseBulkImportCsv(csvText, allRoles);
  const preview = parsedRows.map((row) => {
    // severity distinguishes rows that are structurally broken (no email
    // to match on, or no matching user at all — nothing to fix without a
    // different CSV) from rows that just have a role problem (fixable by
    // editing the roles column or creating the role first). Used below to
    // pick red vs amber row highlighting.
    if (!row.email) {
      return { ...row, valid: false, severity: 'error', message: 'Missing email.' };
    }
    const user = userByEmail.get(row.email.toLowerCase());
    if (!user) {
      return { ...row, valid: false, severity: 'error', message: 'No matching user.' };
    }
    if (row.roleNames.length === 0) {
      return { ...row, valid: false, severity: 'warning', message: 'No roles listed.' };
    }
    if (row.unknownRoles.length > 0) {
      return {
        ...row,
        valid: false,
        severity: 'warning',
        message: `Unknown role(s): ${row.unknownRoles.join(', ')}`,
      };
    }
    return { ...row, valid: true, user };
  });

  const validRows = preview.filter((r) => r.valid);

  function loadFile(file) {
    setFileError(null);
    setResults(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('Please upload a .csv file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''));
      setFileName(file.name);
    };
    reader.onerror = () => {
      setFileError("Couldn't read that file. Try again.");
    };
    reader.readAsText(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    loadFile(e.dataTransfer.files?.[0]);
  }

  async function handleSubmit() {
    if (validRows.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    const outcomes = [];
    for (const row of validRows) {
      try {
        await updateUserRoles(row.user.id, row.roleIds);
        outcomes.push({ ...row, submitStatus: 'ok' });
      } catch (err) {
        outcomes.push({
          ...row,
          submitStatus: 'error',
          submitMessage:
            err.response?.status === 409
              ? 'Skipped — overlapping sensitive permissions.'
              : "Couldn't update roles.",
        });
      }
    }
    setSubmitting(false);
    setResults(outcomes);
    if (outcomes.every((o) => o.submitStatus === 'ok')) {
      onSaved();
    }
  }

  const invalidCount = preview.length - validRows.length;

  // Sample matches this modal's actual CSV shape — header `email,roles`,
  // multiple roles per user semicolon-separated (see parseBulkImportCsv
  // above) — not a generic name/email/role layout, since that's not what
  // this importer reads.
  function downloadSampleCsv() {
    const sample = [
      'email,roles',
      'jane.doe@nexagen.com,Manager',
      'alex.kim@nexagen.com,Finance;Auditor',
      'sam.osei@nexagen.com,Employee',
    ].join('\n');
    const blob = new Blob([sample], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bulk-import-sample.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Bulk import roles</h2>
          <button
            type="button"
            onClick={downloadSampleCsv}
            className="whitespace-nowrap text-xs font-medium text-signal-600 hover:text-signal-700 hover:underline"
          >
            Download sample CSV
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Assign roles to multiple existing users from a CSV. Format:{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5">email,roles</code>{' '}
          with roles separated by <code className="rounded bg-slate-100 px-1 py-0.5">;</code>
        </p>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`mt-4 block cursor-pointer rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
            dragActive
              ? 'border-signal-400 bg-signal-50/60 text-signal-700'
              : 'border-slate-300 text-slate-500 hover:bg-slate-50'
          }`}
        >
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => loadFile(e.target.files?.[0])}
          />
          {fileName ? (
            <span className="font-medium text-slate-700">Loaded: {fileName}</span>
          ) : (
            <span>Drop a .csv file here, or click to browse</span>
          )}
        </label>
        {fileError && <p className="mt-1.5 text-xs text-rose-500">{fileError}</p>}

        <label className="mt-3 block text-xs font-medium text-slate-600">
          Or paste CSV
          <textarea
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setFileName(null);
              setResults(null);
            }}
            rows={5}
            placeholder={'email,roles\nalice@nexagen.com,Manager;Auditor'}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
          />
        </label>

        {preview.length > 0 && (
          <div className="mt-3 max-h-48 overflow-y-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <tbody className="divide-y divide-slate-100">
                {preview.map((row) => {
                  const outcome = results?.find((r) => r.line === row.line);
                  // Row tint mirrors the badge tone so a skipped row is
                  // visible at a glance while scanning, not just readable
                  // one badge at a time: red for rows with nothing to
                  // match on (missing email / no user), amber for rows
                  // that parsed fine but have a role problem.
                  const rowTint =
                    row.severity === 'error'
                      ? 'bg-rose-50/60'
                      : row.severity === 'warning'
                      ? 'bg-amber-50/50'
                      : '';
                  return (
                    <tr key={row.line} className={rowTint}>
                      <td className="px-2.5 py-1.5 text-slate-500">{row.line}</td>
                      <td className="px-2.5 py-1.5 text-slate-700">{row.email || '—'}</td>
                      <td className="px-2.5 py-1.5">
                        {outcome ? (
                          <StatusPill tone={outcome.submitStatus === 'ok' ? 'green' : 'red'}>
                            {outcome.submitStatus === 'ok' ? 'Updated' : outcome.submitMessage}
                          </StatusPill>
                        ) : row.valid ? (
                          <StatusPill tone="slate">{row.roleNames.join(', ')}</StatusPill>
                        ) : (
                          <StatusPill tone={row.severity === 'error' ? 'red' : 'amber'}>
                            {row.message}
                          </StatusPill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {preview.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {validRows.length} of {preview.length} row{preview.length === 1 ? '' : 's'} ready
            {invalidCount > 0 && `, ${invalidCount} skipped`}.
          </p>
        )}

        {submitError && <p className="mt-2 text-xs text-rose-500">{submitError}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {results ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || validRows.length === 0}
            className="btn-primary btn-sm"
          >
            {submitting
              ? 'Importing…'
              : `Import ${validRows.length || ''} row${validRows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Bulk CREATE users modal -------------------------------------------------
// Separate from BulkImportModal above: that one reassigns roles on users
// that already exist (email,roles CSV). This one creates brand-new
// accounts from a name,email,role CSV, backed by
// POST /admin/users/bulk-import (see rbac.routes.js).
//
// Very small CSV split, same caveat as parseBulkImportCsv above: doesn't
// handle quoted commas, fine for this three-column shape.
const EMAIL_RE_CLIENT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseBulkCreateCsv(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstCols = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const dataLines = firstCols[0] === 'name' ? lines.slice(1) : lines;

  return dataLines.map((line, i) => {
    const [rawName = '', rawEmail = '', rawRole = ''] = line.split(',');
    return {
      line: i + 1,
      name: rawName.trim(),
      email: rawEmail.trim(),
      role: rawRole.trim(),
    };
  });
}

function BulkCreateUsersModal({ allRoles, onClose, onSaved }) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null); // API response.results, keyed by line
  const [submitError, setSubmitError] = useState(null);

  const roleNamesLower = new Set(allRoles.map((r) => r.name.toLowerCase()));

  const parsedRows = parseBulkCreateCsv(csvText);
  const preview = parsedRows.map((row) => {
    if (!row.name || !row.email) {
      return { ...row, valid: false, severity: 'error', message: 'Missing name or email.' };
    }
    if (!EMAIL_RE_CLIENT.test(row.email)) {
      return { ...row, valid: false, severity: 'error', message: 'Invalid email address.' };
    }
    if (row.role && !roleNamesLower.has(row.role.toLowerCase())) {
      return { ...row, valid: false, severity: 'error', message: `Unknown role "${row.role}".` };
    }
    return { ...row, valid: true };
  });

  const validRows = preview.filter((r) => r.valid);
  const invalidCount = preview.length - validRows.length;

  function loadFile(file) {
    setFileError(null);
    setResults(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setFileError('Please upload a .csv file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''));
      setFileName(file.name);
    };
    reader.onerror = () => {
      setFileError("Couldn't read that file. Try again.");
    };
    reader.readAsText(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    loadFile(e.dataTransfer.files?.[0]);
  }

  async function handleSubmit() {
    if (validRows.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = validRows.map((r) => ({ name: r.name, email: r.email, role: r.role || undefined }));
      const data = await bulkCreateUsers(payload);
      // Server results are keyed by the line number of the *submitted*
      // payload (validRows), not the original preview's line numbers, since
      // invalid rows were never sent. Re-map back onto validRows' original
      // `line` so the preview table (indexed by original CSV line) can find
      // each outcome.
      const byPayloadIndex = new Map(data.results.map((r, idx) => [idx, r]));
      const remapped = validRows.map((row, idx) => ({
        originalLine: row.line,
        ...byPayloadIndex.get(idx),
      }));
      setResults(remapped);
      if (remapped.every((r) => r.status === 'created')) {
        onSaved();
      }
    } catch (err) {
      setSubmitError("Couldn't reach the server. Nothing was imported.");
    } finally {
      setSubmitting(false);
    }
  }

  function downloadSampleCsv() {
    const sample = [
      'name,email,role',
      'Aditi Sharma,aditi.sharma@nexagen.com,employee',
      'Rohan Verma,rohan.verma@nexagen.com,employee',
    ].join('\n');
    const blob = new Blob([sample], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bulk-create-users-sample.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // Once created, temp passwords only ever appear once (see rbac.routes.js) —
  // offer a CSV of them since scrolling 25+ rows to copy each by hand isn't
  // realistic.
  function downloadCredentials() {
    if (!results) return;
    const created = results.filter((r) => r.status === 'created');
    if (created.length === 0) return;
    const csv = [
      'name,email,temporary_password',
      ...created.map((r) => {
        const row = preview.find((p) => p.line === r.originalLine);
        return `${row?.name ?? ''},${r.email},${r.tempPassword}`;
      }),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'new-user-credentials.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const createdCount = results?.filter((r) => r.status === 'created').length ?? 0;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Create users from CSV</h2>
          <button
            type="button"
            onClick={downloadSampleCsv}
            className="whitespace-nowrap text-xs font-medium text-signal-600 hover:text-signal-700 hover:underline"
          >
            Download sample CSV
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Creates brand-new accounts. Format:{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5">name,email,role</code>{' '}
          — <code className="rounded bg-slate-100 px-1 py-0.5">role</code> is optional
          and defaults to <code className="rounded bg-slate-100 px-1 py-0.5">employee</code>.
          Each new user gets a random one-time password you'll be able to download after import.
        </p>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`mt-4 block cursor-pointer rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
            dragActive
              ? 'border-signal-400 bg-signal-50/60 text-signal-700'
              : 'border-slate-300 text-slate-500 hover:bg-slate-50'
          }`}
        >
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => loadFile(e.target.files?.[0])}
          />
          {fileName ? (
            <span className="font-medium text-slate-700">Loaded: {fileName}</span>
          ) : (
            <span>Drop a .csv file here, or click to browse</span>
          )}
        </label>
        {fileError && <p className="mt-1.5 text-xs text-rose-500">{fileError}</p>}

        <label className="mt-3 block text-xs font-medium text-slate-600">
          Or paste CSV
          <textarea
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setFileName(null);
              setResults(null);
            }}
            rows={5}
            placeholder={'name,email,role\naditi.sharma@nexagen.com,employee'}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
          />
        </label>

        {preview.length > 0 && (
          <div className="mt-3 max-h-48 overflow-y-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <tbody className="divide-y divide-slate-100">
                {preview.map((row) => {
                  const outcome = results?.find((r) => r.originalLine === row.line);
                  const rowTint =
                    row.severity === 'error' ? 'bg-rose-50/60' : '';
                  return (
                    <tr key={row.line} className={rowTint}>
                      <td className="px-2.5 py-1.5 text-slate-500">{row.line}</td>
                      <td className="px-2.5 py-1.5 text-slate-700">{row.name || '—'}</td>
                      <td className="px-2.5 py-1.5 text-slate-700">{row.email || '—'}</td>
                      <td className="px-2.5 py-1.5">
                        {outcome ? (
                          <StatusPill tone={outcome.status === 'created' ? 'green' : 'red'}>
                            {outcome.status === 'created' ? `Created (${outcome.role})` : outcome.message}
                          </StatusPill>
                        ) : row.valid ? (
                          <StatusPill tone="slate">{row.role || 'employee (default)'}</StatusPill>
                        ) : (
                          <StatusPill tone="red">{row.message}</StatusPill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {preview.length > 0 && !results && (
          <p className="mt-2 text-xs text-slate-500">
            {validRows.length} of {preview.length} row{preview.length === 1 ? '' : 's'} ready
            {invalidCount > 0 && `, ${invalidCount} skipped`}.
          </p>
        )}

        {/* Post-submission outcome — deliberately NOT the readiness line
            above (that only describes CSV validity, before the API call
            ever ran, and would otherwise sit on screen unchanged after
            submit — easy to misread as a success count). This reflects what
            the server actually did with each row. */}
        {results && (
          <p className="mt-2 text-xs font-medium">
            <span className={createdCount > 0 ? 'text-emerald-600' : 'text-slate-500'}>
              {createdCount} of {results.length} user{results.length === 1 ? '' : 's'} created
            </span>
            {results.length - createdCount > 0 && (
              <span className="text-rose-500">
                {' '}
                — {results.length - createdCount} failed (see table above for why each one did).
              </span>
            )}
          </p>
        )}

        {submitError && <p className="mt-2 text-xs text-rose-500">{submitError}</p>}

        {results && createdCount > 0 && (
          <button
            type="button"
            onClick={downloadCredentials}
            className="mt-2 text-xs font-medium text-signal-600 hover:text-signal-700 hover:underline"
          >
            Download credentials for {createdCount} new user{createdCount === 1 ? '' : 's'} (.csv)
          </button>
        )}

        {results && createdCount > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            New users must change this password on first login.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {results ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || validRows.length === 0}
            className="btn-primary btn-sm"
          >
            {submitting
              ? 'Creating…'
              : `Create ${validRows.length || ''} user${validRows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Assign roles modal ----------------------------------------------------

function AssignRolesModal({ user, allRoles, onClose, onSaved }) {
  // GET /admin/users currently doesn't return each user's role ids (see
  // docs/api-contract.md, which says it should) — only name/email come
  // back today, so there's nothing reliable to pre-check here yet. Falling
  // back to matching by name against userRoleNames() in case that lands
  // before the id-based fix does.
  const initialChecked = new Set(
    allRoles
      .filter((role) => userRoleNames(user).includes(role.name))
      .map((role) => role.id)
  );

  const [checkedIds, setCheckedIds] = useState(initialChecked);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(null); // { overlappingPermissions } | null

  function toggle(roleId) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }

  async function submit({ confirm = false } = {}) {
    setSaving(true);
    setError(null);
    try {
      await updateUserRoles(user.id, [...checkedIds], { confirm });
      onSaved();
    } catch (err) {
      if (err.response?.status === 409 && err.response.data?.conflict) {
        setConflict(err.response.data);
      } else {
        setError("Couldn't update roles. Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
        {!conflict ? (
          <>
            <h2 className="text-sm font-semibold text-slate-900">
              Roles for {user.name}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{user.email}</p>

            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {allRoles.map((role) => (
                <label
                  key={role.id}
                  className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={checkedIds.has(role.id)}
                    onChange={() => toggle(role.id)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium text-slate-800">{role.name}</span>
                    {role.description && (
                      <span className="block text-xs text-slate-500">
                        {role.description}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>

            {error && <p className="mt-3 text-xs text-rose-500">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={saving}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => submit()}
                disabled={saving}
                className="btn-primary btn-sm"
              >
                {saving ? 'Saving…' : 'Save roles'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-slate-900">
              Overlapping sensitive permissions
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              These roles together grant {user.name} overlapping sensitive
              permissions:
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {(conflict.overlappingPermissions || []).map((perm) => (
                <StatusPill key={perm} tone="amber">
                  {perm}
                </StatusPill>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              Confirm to assign these roles anyway.
            </p>

            {error && <p className="mt-3 text-xs text-rose-500">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConflict(null)}
                disabled={saving}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={() => submit({ confirm: true })}
                disabled={saving}
                className="btn-warning"
              >
                {saving ? 'Applying…' : 'Confirm and apply'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RolesTab() {
  const [roles, status, refetchRoles] = useTabData(getRoles);
  const [permissions, permStatus] = useTabData(getPermissions);
  const [editingRole, setEditingRole] = useState(undefined); // undefined = closed, null = "new", object = editing
  const [deletingId, setDeletingId] = useState(null);
  const [rowError, setRowError] = useState({});
  const colSpan = 3;
  const formReady = permStatus === 'ready';

  async function handleDelete(role) {
    if (!window.confirm(`Delete the "${role.name}" role? This can't be undone.`)) {
      return;
    }
    setDeletingId(role.id);
    setRowError((prev) => ({ ...prev, [role.id]: null }));
    try {
      await deleteRole(role.id);
      refetchRoles();
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [role.id]: "Couldn't delete this role. Try again.",
      }));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">Roles</h2>
        <button
          onClick={() => setEditingRole(null)}
          disabled={!formReady}
          className="btn-primary btn-sm"
        >
          New role
        </button>
      </div>

      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/70">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Role</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Description</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {status === 'loading' && <LoadingRow colSpan={colSpan} />}
          {status === 'error' && (
            <ErrorRow colSpan={colSpan} message="Couldn't load roles." />
          )}
          {status === 'ready' && roles.length === 0 && (
            <EmptyRow colSpan={colSpan} message="No roles found." />
          )}
          {status === 'ready' &&
            roles.map((role) => (
              <tr key={role.id} className="transition-colors hover:bg-signal-50/60">
                <td className="px-4 py-3 font-medium text-slate-800">{role.name}</td>
                <td className="px-4 py-3 text-slate-500">{role.description}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingRole(role)}
                        disabled={!formReady}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(role)}
                        disabled={deletingId === role.id}
                        className="btn-danger"
                      >
                        {deletingId === role.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                    {rowError[role.id] && (
                      <span className="text-xs text-rose-500">{rowError[role.id]}</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      {editingRole !== undefined && (
        <RoleFormModal
          role={editingRole}
          permissions={permissions}
          onClose={() => setEditingRole(undefined)}
          onSaved={() => {
            setEditingRole(undefined);
            refetchRoles();
          }}
        />
      )}
    </>
  );
}

// --- Role create/edit modal -------------------------------------------

function RoleFormModal({ role, permissions, onClose, onSaved }) {
  const isEdit = !!role;
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  // GET /admin/roles (and the PUT response) don't currently include which
  // permissions a role already has, so there's nothing to pre-check when
  // editing — see chat writeup. Track whether the admin actually touches a
  // checkbox this session so an untouched save doesn't send permissionIds
  // and silently wipe the role's real permissions.
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [permissionsTouched, setPermissionsTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function toggle(permId) {
    setPermissionsTouched(true);
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(permId)) next.delete(permId);
      else next.add(permId);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim(), description };
      if (permissionsTouched) payload.permissionIds = [...checkedIds];

      if (isEdit) {
        await updateRole(role.id, payload);
      } else {
        await createRole(payload);
      }
      onSaved();
    } catch (err) {
      setError(
        err.response?.data?.error ?? "Couldn't save this role. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg"
      >
        <h2 className="text-sm font-semibold text-slate-900">
          {isEdit ? `Edit ${role.name}` : 'New role'}
        </h2>

        <label className="mt-4 block text-xs font-medium text-slate-600">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </label>

        <label className="mt-3 block text-xs font-medium text-slate-600">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </label>

        <div className="mt-3">
          <p className="text-xs font-medium text-slate-600">Permissions</p>
          {isEdit && !permissionsTouched && (
            <p className="mt-1 text-xs text-slate-400">
              Current permissions aren't shown here yet — check a box only if
              you want to replace this role's permission set.
            </p>
          )}
          <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
            {permissions.map((perm) => (
              <label
                key={perm.id}
                className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={checkedIds.has(perm.id)}
                  onChange={() => toggle(perm.id)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-slate-800">{perm.name}</span>
                  {perm.description && (
                    <span className="block text-xs text-slate-500">
                      {perm.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-rose-500">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn-primary btn-sm"
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create role'}
          </button>
        </div>
      </form>
    </div>
  );
}

function AccessRequestsTab() {
  const [requests, status, refetch] = useTabData(getAccessRequests);
  const [pending, setPending] = useState({}); // id -> true while request is in flight
  const [rowError, setRowError] = useState({}); // id -> error message
  const colSpan = 6;

  // Backend: POST /admin/access-requests/:id/revoke — only acts on a
  // currently-APPROVED request (409 otherwise), so the button below is
  // gated on req.status === 'APPROVED' too rather than relying on the
  // server's 409 alone to communicate that.
  async function handleRevoke(requestId) {
    setPending((prev) => ({ ...prev, [requestId]: true }));
    setRowError((prev) => ({ ...prev, [requestId]: null }));

    try {
      await revokeRequest(requestId);
      refetch();
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [requestId]: "Couldn't revoke this request. Try again.",
      }));
    } finally {
      setPending((prev) => ({ ...prev, [requestId]: false }));
    }
  }

  async function handleDecision(requestId, decision) {
    setPending((prev) => ({ ...prev, [requestId]: true }));
    setRowError((prev) => ({ ...prev, [requestId]: null }));

    try {
      if (decision === 'approved') {
        await approveRequest(requestId);
      } else {
        await denyRequest(requestId);
      }
      // Row disappears once the list re-fetches (backend only returns
      // pending requests), so there's no separate "handled" state to track.
      refetch();
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [requestId]: `Couldn't ${decision === 'approved' ? 'approve' : 'deny'} this request. Try again.`,
      }));
    } finally {
      setPending((prev) => ({ ...prev, [requestId]: false }));
    }
  }

  return (
    <table className="min-w-full divide-y divide-slate-200 text-sm">
      <thead className="bg-slate-50/70">
        <tr>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requester</th>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requested role</th>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requested at</th>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Stage</th>
          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Expires</th>
          <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {status === 'loading' && <LoadingRow colSpan={colSpan} />}
        {status === 'error' && (
          <ErrorRow colSpan={colSpan} message="Couldn't load access requests." />
        )}
        {status === 'ready' && requests.length === 0 && (
          <EmptyRow colSpan={colSpan} message="No pending access requests." />
        )}
        {status === 'ready' &&
          requests.map((req) => {
            const isPending = !!pending[req.id];
            const error = rowError[req.id];
            return (
              <tr key={req.id} className="transition-colors hover:bg-signal-50/60">
                <td className="px-4 py-3 font-medium text-slate-800">
                  {req.user.name}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {req.requestedRole.name}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {formatDate(req.requestedAt)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`pill ${
                      req.status === 'PENDING_MANAGER'
                        ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200'
                        : 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        req.status === 'PENDING_MANAGER' ? 'bg-amber-500' : 'bg-sky-500'
                      }`}
                      aria-hidden="true"
                    />
                    {req.status === 'PENDING_MANAGER' ? 'Awaiting manager' : 'Awaiting admin'}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {req.expiresAt ? (
                    <span title={formatDate(req.expiresAt)}>
                      {formatExpiry(req.expiresAt)}
                    </span>
                  ) : req.durationHours ? (
                    <span title="Requested duration — starts counting down once approved">
                      Requested: {formatRequestedDuration(req.durationHours)}
                    </span>
                  ) : (
                    <StatusPill tone="slate">Permanent</StatusPill>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex justify-end gap-2">
                      {req.status === 'APPROVED' ? (
                        <button
                          onClick={() => handleRevoke(req.id)}
                          disabled={isPending}
                          className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isPending ? 'Revoking…' : 'Revoke early'}
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => handleDecision(req.id, 'approved')}
                            disabled={isPending}
                            className="btn-success"
                          >
                            {isPending ? 'Approving…' : 'Approve'}
                          </button>
                          <button
                            onClick={() => handleDecision(req.id, 'denied')}
                            disabled={isPending}
                            className="btn-danger"
                          >
                            {isPending ? 'Denying…' : 'Deny'}
                          </button>
                        </>
                      )}
                    </div>
                    {error && (
                      <span className="text-xs text-rose-500">{error}</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
      </tbody>
    </table>
  );
}

// The backend currently returns audit rows as raw snake_case columns with
// no joined `user` object (user_id only) — that mismatches what the API
// contract promises (`{ user, ipAddress, createdAt }`) and was the actual
// reason this tab looked empty: `log.user.name` threw on every row since
// `log.user` was undefined, so nothing rendered. These helpers accept
// either shape so the tab degrades gracefully instead of blanking out
// while that backend fix lands — see bug report.
function auditUserName(log) {
  return (
    log.user?.name ??
    log.userName ??
    (log.user_id != null ? `User #${log.user_id}` : 'Unknown user')
  );
}

function auditIp(log) {
  return log.ipAddress ?? log.ip_address ?? '—';
}

function auditCreatedAt(log) {
  return log.createdAt ?? log.created_at ?? null;
}

function AuditLogTab() {
  const [logs, status] = useTabData(getAuditLogs);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const colSpan = 4;

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      await exportAuditLogCsv();
    } catch (err) {
      setExportError("Couldn't export audit log.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-secondary btn-sm ml-auto"
        >
          {exporting ? 'Exporting…' : 'Export audit log'}
        </button>
        {exportError && <span className="text-xs text-rose-500">{exportError}</span>}
      </div>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/70">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">User</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Resource</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">IP address</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {status === 'loading' && <LoadingRow colSpan={colSpan} />}
          {status === 'error' && (
            <ErrorRow colSpan={colSpan} message="Couldn't load audit logs." />
          )}
          {status === 'ready' && logs.length === 0 && (
            <EmptyRow colSpan={colSpan} message="No audit log entries yet." />
          )}
          {status === 'ready' &&
            logs.map((log) => {
              const action = log.action.toLowerCase();
              const isNegative = action.includes('denied') || action.includes('rejected');
              return (
                <tr key={log.id} className="transition-colors hover:bg-signal-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {auditUserName(log)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={isNegative ? 'red' : 'green'}>
                      {log.action}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{log.resource}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {auditIp(log)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(auditCreatedAt(log))}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </>
  );
}

// --- Page shell -----------------------------------------------------------

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('users');

  return (
    <div className="min-h-screen bg-slate-50/60">
      <Header />
      <AlertBanner />

      <header className="border-b border-slate-200 bg-white px-6 pt-6">
        <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage users, roles, and access across AccessOS.
        </p>

        <nav className="mt-5 flex gap-6 border-b border-transparent">
          {TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative pb-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-slate-900'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-slate-900" />
                )}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="px-6 py-6">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <TabErrorBoundary resetKey={activeTab}>
              {activeTab === 'users' && <UsersTab />}
              {activeTab === 'roles' && <RolesTab />}
              {activeTab === 'requests' && <AccessRequestsTab />}
              {activeTab === 'audit' && <AuditLogTab />}
              {activeTab === 'alerts' && <AlertsTab />}
            </TabErrorBoundary>
          </div>
        </div>
      </main>
    </div>
  );
}
