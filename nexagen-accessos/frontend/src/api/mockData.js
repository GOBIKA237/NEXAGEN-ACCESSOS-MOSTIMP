// Mirrors docs/api-contract.md response shapes exactly, so swapping mock -> real
// API later is a find-and-replace, not a rewrite.

export const mockLoginResponse = {
  token: 'mock-jwt-token',
  user: {
    id: 1,
    name: 'Priya Sharma',
    email: 'priya@nexagen.com',
    roles: ['finance'],
    permissions: ['view_finance_dashboard'],
  },
};

export const mockUsers = [
  { id: 1, name: 'Priya Sharma', email: 'priya@nexagen.com', roles: ['finance'] },
  { id: 2, name: 'Arjun Mehta', email: 'arjun@nexagen.com', roles: ['hr'] },
  { id: 3, name: 'Admin User', email: 'admin@nexagen.com', roles: ['admin'] },
];

export const mockRoles = [
  { id: 1, name: 'admin', description: 'Full system access' },
  { id: 2, name: 'finance', description: 'Finance team access' },
  { id: 3, name: 'hr', description: 'HR team access' },
  { id: 4, name: 'employee', description: 'Base employee access' },
];

export const mockAccessRequests = [
  {
    id: 1,
    user: { id: 1, name: 'Priya Sharma' },
    requestedRole: { id: 3, name: 'hr' },
    requestedAt: '2026-07-17T09:00:00Z',
  },
];

export const mockAuditLogs = [
  { id: 1, user: { name: 'Priya Sharma' }, action: 'ACCESS_GRANTED', resource: 'view_finance_dashboard', ipAddress: '10.0.0.4', createdAt: '2026-07-17T09:01:00Z' },
  { id: 2, user: { name: 'Arjun Mehta' }, action: 'ACCESS_DENIED', resource: 'manage_users', ipAddress: '10.0.0.9', createdAt: '2026-07-17T09:05:00Z' },
];

export const mockAlerts = [
  { id: 1, userId: 1, riskScore: 72, reason: 'Login from new device at unusual hour', createdAt: '2026-07-17T02:14:00Z' },
];

// =========================
// HR / FINANCE DASHBOARDS (Frontend Dev 3)
// =========================
// Shapes match the assumptions documented in api/client.js for
// hr.routes.js / finance.routes.js, which aren't built yet.

export const mockEmployees = [
  { id: 1, name: 'Priya Sharma', email: 'priya@nexagen.com', department: 'Finance', roles: ['finance'], status: 'active', joinedAt: '2025-03-10T00:00:00Z' },
  { id: 2, name: 'Arjun Mehta', email: 'arjun@nexagen.com', department: 'HR', roles: ['hr'], status: 'active', joinedAt: '2025-06-01T00:00:00Z' },
  { id: 3, name: 'Kavya Rao', email: 'kavya@nexagen.com', department: 'Engineering', roles: ['employee'], status: 'inactive', joinedAt: '2024-11-20T00:00:00Z' },
];

export const mockBudgets = [
  { id: 1, category: 'Engineering', allocated: 200000, spent: 142500 },
  { id: 2, category: 'Marketing', allocated: 80000, spent: 91000 },
  { id: 3, category: 'Operations', allocated: 50000, spent: 12000 },
];

export const mockExpenses = [
  { id: 1, category: 'Engineering', description: 'AWS invoice — June', amount: 4200, status: 'approved', submittedBy: { name: 'Priya Sharma' }, submittedAt: '2026-07-01T09:00:00Z', reviewedAt: '2026-07-02T10:00:00Z' },
  { id: 2, category: 'Marketing', description: 'Conference sponsorship', amount: 15000, status: 'pending', submittedBy: { name: 'Arjun Mehta' }, submittedAt: '2026-07-18T09:00:00Z' },
];

export const mockFinanceReports = {
  budgetSummary: { totalAllocated: 330000, totalSpent: 245500, totalRemaining: 84500, utilizationPercent: 74 },
  expenseSummary: { totalPending: 1, totalApproved: 1, totalRejected: 0, totalAmountApproved: 4200 },
  monthlySummary: [
    { month: 'May 2026', totalSpent: 68000 },
    { month: 'Jun 2026', totalSpent: 91500 },
    { month: 'Jul 2026', totalSpent: 86000 },
  ],
};