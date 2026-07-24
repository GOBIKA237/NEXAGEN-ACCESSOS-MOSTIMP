// Owned by Frontend Dev 2. Gated on the 'manager' role — ProtectedRoute
// already keeps non-managers out at the router level (see App.jsx,
// requireRole="manager"), but this component does its own secondary check
// too, same defense-in-depth pattern FinanceDashboard.jsx and
// HRDashboard.jsx already use for their permission gates.
//
// Structure (useAsync hook, StatusPill, table loading/empty/error rows,
// SectionCard) mirrors FinanceDashboard.jsx / HRDashboard.jsx so all three
// look consistent rather than a one-off design.
//
// Backend: manager.routes.js (GET /api/manager/team, GET
// /api/manager/access-requests, PUT /api/manager/access-requests/:id) is
// still being built by Backend Dev 2. Everything here is written against
// the shape described in the task and will work unchanged once those
// routes exist — see api/client.js for the exact request/response shapes
// assumed, and how USE_MOCK falls back to mock data until then.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header.jsx';
import {
  getMyTeam,
  getManagerAccessRequests,
  reviewManagerRequest,
  getManagerOverview,
  getManagerLeaveRequests,
  decideLeaveRequest,
  getManagerTasks,
  assignTask,
} from '../api/client.js';

const REQUIRED_ROLE = 'manager';

// --- Small shared helpers (same look as Finance/HR/Admin dashboards) ------

function formatDateOnly(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// todo -> in_progress -> done, same style as LEAVE_STATUS_LABELS on
// Dashboard.jsx.
const TASK_STATUS_LABELS = {
  todo: { label: 'To do', tone: 'slate' },
  in_progress: { label: 'In progress', tone: 'amber' },
  done: { label: 'Done', tone: 'green' },
};

function taskStatusInfo(status) {
  return TASK_STATUS_LABELS[status] ?? { label: status, tone: 'slate' };
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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

function useAsync(fetcher, deps = []) {
  const [data, setData] = useState(null);
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

function SectionCard({ title, subtitle, children, action }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-display text-sm font-semibold text-ink-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// GET /manager/overview reports a stat as null (rather than 0) when its
// backing table isn't merged yet (see manager.routes.js) — show that as
// "—" the same way the loading/error states already do, instead of a
// misleading 0.
function formatStat(value) {
  return value === null || value === undefined ? '—' : value;
}

function StatBlock({ label, value }) {
  return (
    <div className="card-interactive p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-semibold text-ink-900">{value}</p>
    </div>
  );
}

// --- My Team ----------------------------------------------------------

function MyTeam({ team, status }) {
  const colSpan = 4;
  return (
    <SectionCard title="My Team" subtitle="Employees who report to you.">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/70">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Name</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Email</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Department</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {status === 'loading' && <LoadingRow colSpan={colSpan} />}
          {status === 'error' && <ErrorRow colSpan={colSpan} message="Couldn't load your team." />}
          {status === 'ready' && (team ?? []).length === 0 && (
            <EmptyRow colSpan={colSpan} message="No one reports to you yet." />
          )}
          {status === 'ready' &&
            (team ?? []).map((member) => (
              <tr key={member.id} className="transition-colors hover:bg-signal-50/60">
                <td className="px-4 py-3 font-medium text-slate-800">{member.name}</td>
                <td className="px-4 py-3 text-slate-500">{member.email}</td>
                <td className="px-4 py-3 text-slate-500">{member.department ?? '—'}</td>
                <td className="px-4 py-3">
                  <StatusPill tone={member.status === 'inactive' ? 'red' : 'green'}>
                    {member.status ?? 'active'}
                  </StatusPill>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </SectionCard>
  );
}

// --- Access Requests (pending manager decision) ----------------------

function AccessRequestsReview({ requests, status, onDecided }) {
  const [pendingId, setPendingId] = useState(null);
  const [comment, setComment] = useState({}); // id -> comment text
  const [rowError, setRowError] = useState({});
  const colSpan = 5;

  const pending = (requests ?? []).filter((r) => r.status === 'PENDING_MANAGER');

  async function decide(req, decision) {
    setPendingId(req.id);
    setRowError((prev) => ({ ...prev, [req.id]: null }));
    try {
      await reviewManagerRequest(req.id, decision, comment[req.id] ?? '');
      onDecided();
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [req.id]: `Couldn't ${decision === 'approved' ? 'approve' : 'reject'} this request.`,
      }));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <SectionCard
      title="Access Requests"
      subtitle="Requests from your team waiting on your decision. Approving sends it on to Admin for final sign-off."
    >
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/70">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requester</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requested role</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requested at</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Comment</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Decision</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {status === 'loading' && <LoadingRow colSpan={colSpan} />}
          {status === 'error' && (
            <ErrorRow colSpan={colSpan} message="Couldn't load access requests." />
          )}
          {status === 'ready' && pending.length === 0 && (
            <EmptyRow colSpan={colSpan} message="Nothing waiting on you right now." />
          )}
          {status === 'ready' &&
            pending.map((req) => {
              const isBusy = pendingId === req.id;
              return (
                <tr key={req.id} className="transition-colors hover:bg-signal-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{req.user?.name}</td>
                  <td className="px-4 py-3 text-slate-500">{req.requestedRole?.name}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(req.requestedAt)}</td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      placeholder="Optional comment"
                      value={comment[req.id] ?? ''}
                      onChange={(e) =>
                        setComment((prev) => ({ ...prev, [req.id]: e.target.value }))
                      }
                      className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => decide(req, 'approved')}
                          disabled={isBusy}
                          className="btn-success"
                        >
                          {isBusy ? 'Working…' : 'Approve'}
                        </button>
                        <button
                          onClick={() => decide(req, 'rejected')}
                          disabled={isBusy}
                          className="btn-danger"
                        >
                          {isBusy ? 'Working…' : 'Reject'}
                        </button>
                      </div>
                      {rowError[req.id] && (
                        <span className="text-xs text-rose-500">{rowError[req.id]}</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </SectionCard>
  );
}

// --- Approval History (already decided by this manager) --------------

function ApprovalHistory({ requests, status }) {
  const colSpan = 4;
  const decided = (requests ?? []).filter((r) => r.status !== 'PENDING_MANAGER');

  return (
    <SectionCard title="Approval History" subtitle="Requests you've already decided on.">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/70">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requester</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requested role</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Your decision</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Comment</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {status === 'loading' && <LoadingRow colSpan={colSpan} />}
          {status === 'error' && (
            <ErrorRow colSpan={colSpan} message="Couldn't load approval history." />
          )}
          {status === 'ready' && decided.length === 0 && (
            <EmptyRow colSpan={colSpan} message="No decisions yet." />
          )}
          {status === 'ready' &&
            decided.map((req) => {
              const rejected = req.status === 'REJECTED';
              return (
                <tr key={req.id} className="transition-colors hover:bg-signal-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{req.user?.name}</td>
                  <td className="px-4 py-3 text-slate-500">{req.requestedRole?.name}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={rejected ? 'red' : 'green'}>
                      {rejected ? 'Rejected' : 'Approved — sent to Admin'}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{req.managerComment || '—'}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </SectionCard>
  );
}

// --- Leave Requests (pending manager decision) ------------------------

function LeaveRequestsReview({ requests, status, onDecided }) {
  const [pendingId, setPendingId] = useState(null);
  const [comment, setComment] = useState({}); // id -> comment text
  const [rowError, setRowError] = useState({});
  const colSpan = 5;

  const pending = (requests ?? []).filter((r) => r.status === 'PENDING');

  async function decide(req, decision) {
    setPendingId(req.id);
    setRowError((prev) => ({ ...prev, [req.id]: null }));
    try {
      await decideLeaveRequest(req.id, decision, comment[req.id] ?? '');
      onDecided();
    } catch (err) {
      setRowError((prev) => ({
        ...prev,
        [req.id]: `Couldn't ${decision === 'approved' ? 'approve' : 'reject'} this request.`,
      }));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <SectionCard
      title="Leave Requests"
      subtitle="Leave requests from your team waiting on your decision."
    >
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/70">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requester</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Dates</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Comment</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Decision</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {status === 'loading' && <LoadingRow colSpan={colSpan} />}
          {status === 'error' && (
            <ErrorRow colSpan={colSpan} message="Couldn't load leave requests." />
          )}
          {status === 'ready' && pending.length === 0 && (
            <EmptyRow colSpan={colSpan} message="Nothing waiting on you right now." />
          )}
          {status === 'ready' &&
            pending.map((req) => {
              const isBusy = pendingId === req.id;
              return (
                <tr key={req.id} className="transition-colors hover:bg-signal-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{req.user?.name}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDateOnly(req.startDate)} – {formatDateOnly(req.endDate)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{req.reason || '—'}</td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      placeholder="Optional comment"
                      value={comment[req.id] ?? ''}
                      onChange={(e) =>
                        setComment((prev) => ({ ...prev, [req.id]: e.target.value }))
                      }
                      className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => decide(req, 'approved')}
                          disabled={isBusy}
                          className="btn-success"
                        >
                          {isBusy ? 'Working…' : 'Approve'}
                        </button>
                        <button
                          onClick={() => decide(req, 'rejected')}
                          disabled={isBusy}
                          className="btn-danger"
                        >
                          {isBusy ? 'Working…' : 'Reject'}
                        </button>
                      </div>
                      {rowError[req.id] && (
                        <span className="text-xs text-rose-500">{rowError[req.id]}</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </SectionCard>
  );
}

// --- Leave History (already decided by this manager) -------------------

function LeaveHistory({ requests, status }) {
  const colSpan = 4;
  const decided = (requests ?? []).filter((r) => r.status !== 'PENDING');

  return (
    <SectionCard title="Leave History" subtitle="Leave requests you've already decided on.">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/70">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Requester</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Dates</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Your decision</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Comment</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {status === 'loading' && <LoadingRow colSpan={colSpan} />}
          {status === 'error' && (
            <ErrorRow colSpan={colSpan} message="Couldn't load leave history." />
          )}
          {status === 'ready' && decided.length === 0 && (
            <EmptyRow colSpan={colSpan} message="No decisions yet." />
          )}
          {status === 'ready' &&
            decided.map((req) => {
              const rejected = req.status === 'REJECTED';
              return (
                <tr key={req.id} className="transition-colors hover:bg-signal-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{req.user?.name}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDateOnly(req.startDate)} – {formatDateOnly(req.endDate)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={rejected ? 'red' : 'green'}>
                      {rejected ? 'Rejected' : 'Approved'}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{req.managerComment || '—'}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </SectionCard>
  );
}

// --- Assign Task modal ---------------------------------------------------

function TaskAssignModal({ team, teamStatus, onClose, onSubmit, submitting }) {
  const [assignedTo, setAssignedTo] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  // team loads asynchronously (same "My Team" data as the section above),
  // so default the selection once it arrives instead of only on mount —
  // same pattern Dashboard.jsx's RequestAccessModal uses for roles.
  useEffect(() => {
    if (teamStatus === 'ready' && team?.length > 0 && !assignedTo) {
      setAssignedTo(team[0].id);
    }
  }, [teamStatus, team, assignedTo]);

  const canSubmit = teamStatus === 'ready' && (team ?? []).length > 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!assignedTo || !title.trim()) {
      setError('Assignee and title are both required.');
      return;
    }
    setError('');
    onSubmit({
      assignedTo,
      title: title.trim(),
      description: description.trim() || null,
      dueDate: dueDate || null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Assign Task</h2>
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
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          {teamStatus === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
                aria-hidden="true"
              />
              Loading your team…
            </div>
          )}

          {teamStatus === 'error' && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Could not load your team. Please try again.
            </p>
          )}

          {teamStatus === 'ready' && (team ?? []).length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              No one reports to you yet, so there's no one to assign a task to.
            </p>
          )}

          {teamStatus === 'ready' && (team ?? []).length > 0 && (
            <div>
              <label htmlFor="assignedTo" className="block text-sm font-medium text-slate-700">
                Assign to
              </label>
              <select
                id="assignedTo"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              >
                {team.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} — {member.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-slate-700">
              Title
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Finish Q3 report"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-slate-700">
              Description (optional)
            </label>
            <textarea
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>

          <div>
            <label htmlFor="dueDate" className="block text-sm font-medium text-slate-700">
              Due date (optional)
            </label>
            <input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
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
              disabled={submitting || !canSubmit}
              className="btn-accent"
            >
              {submitting ? 'Assigning…' : 'Assign Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Task list (assigned by this manager) -------------------------------

function ManagerTasksList({ tasks, status, onAssignClick }) {
  const colSpan = 4;

  return (
    <SectionCard
      title="Tasks"
      subtitle="Tasks you've assigned to your team."
      action={
        <button
          type="button"
          onClick={onAssignClick}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900"
        >
          Assign Task
        </button>
      }
    >
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50/70">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Title</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Assignee</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Due date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {status === 'loading' && <LoadingRow colSpan={colSpan} />}
          {status === 'error' && <ErrorRow colSpan={colSpan} message="Couldn't load tasks." />}
          {status === 'ready' && (tasks ?? []).length === 0 && (
            <EmptyRow colSpan={colSpan} message="You haven't assigned any tasks yet." />
          )}
          {status === 'ready' &&
            (tasks ?? []).map((task) => {
              const { label, tone } = taskStatusInfo(task.status);
              return (
                <tr key={task.id} className="transition-colors hover:bg-signal-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{task.title}</td>
                  <td className="px-4 py-3 text-slate-500">{task.assignedTo?.name}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={tone}>{label}</StatusPill>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDateOnly(task.dueDate)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </SectionCard>
  );
}

// --- Body ---------------------------------------------------------------

function ManagerDashboardBody() {
  const [team, teamStatus] = useAsync(getMyTeam);
  const [requests, requestsStatus, refetchRequests] = useAsync(getManagerAccessRequests);
  const [overview, overviewStatus] = useAsync(getManagerOverview);
  const [leaveRequests, leaveRequestsStatus, refetchLeaveRequests] = useAsync(
    getManagerLeaveRequests
  );
  const [tasks, tasksStatus, refetchTasks] = useAsync(getManagerTasks);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [assigningTask, setAssigningTask] = useState(false);
  const [taskError, setTaskError] = useState('');

  async function handleAssignTask(payload) {
    setAssigningTask(true);
    setTaskError('');
    try {
      await assignTask(payload);
      setTaskModalOpen(false);
      refetchTasks();
    } catch (err) {
      setTaskError("Couldn't assign this task. Please try again.");
    } finally {
      setAssigningTask(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock
          label="Total Employees"
          value={overviewStatus === 'ready' ? formatStat(overview?.totalEmployees) : '—'}
        />
        <StatBlock
          label="Present Today"
          value={overviewStatus === 'ready' ? formatStat(overview?.presentToday) : '—'}
        />
        <StatBlock
          label="On Leave"
          value={overviewStatus === 'ready' ? formatStat(overview?.onLeaveToday) : '—'}
        />
        <StatBlock
          label="Pending Tasks"
          value={overviewStatus === 'ready' ? formatStat(overview?.pendingTasks) : '—'}
        />
      </div>

      <MyTeam team={team} status={teamStatus} />
      <AccessRequestsReview
        requests={requests}
        status={requestsStatus}
        onDecided={refetchRequests}
      />
      <ApprovalHistory requests={requests} status={requestsStatus} />
      <LeaveRequestsReview
        requests={leaveRequests}
        status={leaveRequestsStatus}
        onDecided={refetchLeaveRequests}
      />
      <LeaveHistory requests={leaveRequests} status={leaveRequestsStatus} />
      <ManagerTasksList
        tasks={tasks}
        status={tasksStatus}
        onAssignClick={() => setTaskModalOpen(true)}
      />

      {taskModalOpen && (
        <TaskAssignModal
          team={team}
          teamStatus={teamStatus}
          onClose={() => setTaskModalOpen(false)}
          onSubmit={handleAssignTask}
          submitting={assigningTask}
        />
      )}

      {taskError && (
        <p className="text-sm text-rose-500" role="alert">
          {taskError}
        </p>
      )}
    </div>
  );
}

export default function ManagerDashboard() {
  const raw = sessionStorage.getItem('user');
  const user = raw ? JSON.parse(raw) : null;

  if (!user) {
    window.location.href = '/';
    return null;
  }

  const allowed = !!user.roles?.includes(REQUIRED_ROLE);

  if (!allowed) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 md:p-10">
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-400">🔒 Restricted</p>
          <h1 className="mt-2 text-xl font-semibold text-slate-800">
            You don't have access to the Manager Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            This area is for team managers only.
          </p>
          <Link
            to="/dashboard"
            className="mt-4 inline-block text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/60">
      <Header />
      <div className="mx-auto max-w-6xl p-6 md:p-10">
        <Link to="/dashboard" className="text-sm font-medium text-slate-500 hover:text-slate-700">
          ← Back to Dashboard
        </Link>

        <div className="mt-4 flex items-center gap-3">
          <div className="h-8 w-1.5 rounded-full bg-indigo-500" />
          <h1 className="text-2xl font-semibold text-slate-800">Manager Dashboard</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Review your team's access requests before they go to Admin.
        </p>

        <div className="mt-8">
          <ManagerDashboardBody />
        </div>
      </div>
    </div>
  );
}