// Shared axios wrapper for the AccessOS API. Every page imports its calls
// from here rather than hitting axios directly, so auth-header injection
// and the base URL only live in one place.
//
// Base URL: docs/api-contract.md documents http://localhost:5000/api for
// dev. VITE_API_URL lets that be overridden (e.g. for a deployed backend)
// without touching this file.
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const api = axios.create({ baseURL: BASE_URL });

// Every protected route expects `Authorization: Bearer <jwt>` (see
// docs/api-contract.md). Login.jsx stores the token in sessionStorage on
// success, so attach it here on every outgoing request rather than having
// each call site remember to do it.
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- Auth ------------------------------------------------------------------

export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

export async function register(name, email, password) {
  const { data } = await api.post('/auth/register', { name, email, password });
  return data;
}

// Stateless JWTs — there's no server-side session to invalidate, so
// "logging out" just means forgetting the token/user locally.
export function logout() {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
}

// GET /auth/me — re-derives roles/permissions server-side on every call
// (see auth.routes.js), used by Dashboard.jsx's refreshSession() to pick
// up access changes without a fresh login.
export async function getMe() {
  const { data } = await api.get('/auth/me');
  return data;
}

// --- Access requests (self-service, any logged-in user) --------------------

export async function getAvailableRoles() {
  const { data } = await api.get('/roles');
  return data;
}

// durationHours: positive integer, or null/undefined for a permanent
// request (see Request.routes.js's POST /access-requests).
export async function requestAccess(requestedRoleId, durationHours) {
  const { data } = await api.post('/access-requests', { requestedRoleId, durationHours });
  return data;
}

export async function getMyAccessRequests() {
  const { data } = await api.get('/access-requests/me');
  return data;
}

// --- Leave requests (self-service, any logged-in user) ----------------------

export async function submitLeaveRequest({ startDate, endDate, reason }) {
  const { data } = await api.post('/leave-requests', { startDate, endDate, reason });
  return data;
}

export async function getMyLeaveRequests() {
  const { data } = await api.get('/leave-requests/me');
  return data;
}

// --- Admin -------------------------------------------------------------------

export async function getUsers() {
  const { data } = await api.get('/admin/users');
  return data;
}

export async function getRoles() {
  const { data } = await api.get('/admin/roles');
  return data;
}

// No status passed -> ?status=PENDING, which Request.routes.js aliases to
// both PENDING_MANAGER and PENDING_ADMIN, so the admin queue shows
// everything not yet finalized regardless of which stage it's sitting at.
export async function getAccessRequests() {
  const { data } = await api.get('/admin/access-requests', {
    params: { status: 'PENDING' },
  });
  return data;
}

export async function approveRequest(id) {
  const { data } = await api.put(`/admin/access-requests/${id}`, { status: 'approved' });
  return data;
}

export async function denyRequest(id) {
  const { data } = await api.put(`/admin/access-requests/${id}`, { status: 'denied' });
  return data;
}

export async function revokeRequest(id) {
  const { data } = await api.post(`/admin/access-requests/${id}/revoke`);
  return data;
}

export async function getAuditLogs() {
  const { data } = await api.get('/admin/audit-logs');
  return data;
}

export async function getAlerts() {
  const { data } = await api.get('/admin/alerts');
  return data;
}

export async function invalidateSession(alertId) {
  const { data } = await api.post(`/admin/alerts/${alertId}/invalidate-session`);
  return data;
}

// --- Manager -----------------------------------------------------------------

export async function getMyTeam() {
  const { data } = await api.get('/manager/team');
  return data;
}

export async function getManagerAccessRequests() {
  const { data } = await api.get('/manager/access-requests');
  return data;
}

// decision: 'approved' | 'rejected'
export async function reviewManagerRequest(id, decision, comment) {
  const { data } = await api.put(`/manager/access-requests/${id}`, { decision, comment });
  return data;
}

export async function getManagerOverview() {
  const { data } = await api.get('/manager/overview');
  return data;
}

// GET /manager/leave-requests, PUT /manager/leave-requests/:id — see
// index.js's routing comment: these ride along with the rest of the
// /api/manager mount in manager.routes.js. Same "not merged yet" situation
// GET /manager/overview's onLeaveToday sub-query already handles (Backend
// Dev 1 owns leave_requests) — written against the shape described in the
// task and mirroring reviewManagerRequest/getManagerAccessRequests above,
// so this works unchanged once those two routes land.
export async function getManagerLeaveRequests() {
  const { data } = await api.get('/manager/leave-requests');
  return data;
}

// decision: 'approved' | 'rejected'
export async function decideLeaveRequest(id, decision, comment) {
  const { data } = await api.put(`/manager/leave-requests/${id}`, { decision, comment });
  return data;
}

// --- Tasks -------------------------------------------------------------

// GET/POST /tasks, PUT /tasks/:id/status, GET /tasks/me — the `tasks`
// table is owned by Backend Dev 2 and isn't merged yet (see
// manager.routes.js's GET /manager/overview, which already treats a
// missing `tasks` table as "not ready" rather than failing). Written
// against the shape described in the task and mirroring the leave-request
// functions above, so this works unchanged once those routes land.
//
// NOTE: the manager-only actions below hit /tasks, not /manager/tasks —
// task.routes.js is mounted at /api/tasks directly (see index.js), and
// POST '/' / GET '/' already gate themselves to managers internally via
// requireRole('manager'), same as the rest of that file. This originally
// pointed at /manager/tasks by mistake (guessed from the leave/access
// request URL pattern, which really does live under /manager), causing
// every load here to 404.

// Manager-only: assigns a task to someone on their team.
export async function assignTask({ assignedTo, title, description, dueDate }) {
  const { data } = await api.post('/tasks', {
    assignedTo,
    title,
    description,
    dueDate,
  });
  return data;
}

// Manager-only: every task this manager has assigned, any status.
export async function getManagerTasks() {
  const { data } = await api.get('/tasks');
  return data;
}

// Any authenticated user: tasks assigned to them.
export async function getMyTasks() {
  const { data } = await api.get('/tasks/me');
  return data;
}

// status: 'todo' | 'in_progress' | 'done'. Any authenticated user, for a
// task assigned to them — this is the assignee moving their own task
// forward, not a manager approval step (unlike access/leave requests).
export async function updateTaskStatus(id, status) {
  const { data } = await api.put(`/tasks/${id}/status`, { status });
  return data;
}

// --- Finance dashboard ---------------------------------------------------

export async function getBudgets() {
  const { data } = await api.get('/finance/budgets');
  return data;
}

export async function getExpenses() {
  const { data } = await api.get('/finance/expenses');
  return data;
}

export async function createExpense(payload) {
  const { data } = await api.post('/finance/expenses', payload);
  return data;
}

// status: 'approved' | 'rejected'
export async function setExpenseStatus(id, status) {
  const { data } = await api.put(`/finance/expenses/${id}`, { status });
  return data;
}

export async function getFinanceReports() {
  const { data } = await api.get('/finance/reports');
  return data;
}

// --- HR dashboard ----------------------------------------------------------

export async function getEmployees() {
  const { data } = await api.get('/hr/employees');
  return data;
}

export async function createEmployee(payload) {
  const { data } = await api.post('/hr/employees', payload);
  return data;
}

// status: 'active' | 'inactive'
export async function setEmployeeStatus(id, status) {
  const { data } = await api.put(`/hr/employees/${id}/status`, { status });
  return data;
}