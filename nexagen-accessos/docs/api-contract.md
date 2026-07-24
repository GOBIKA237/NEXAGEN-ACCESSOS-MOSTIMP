# AccessOS API Contract

Base URL (dev): `http://localhost:5000/api`
All protected routes require header: `Authorization: Bearer <jwt>`

## Auth — Backend Dev 1

### POST /auth/register
Request: `{ name, email, password }`
Response 201: `{ id, name, email }`

### POST /auth/login
Request: `{ email, password }`
Response 200: `{ token, user: { id, name, email, roles: [...], permissions: [...] } }`
Response 401: `{ error: "Invalid credentials" }`

### GET /users/me
Response 200: `{ id, name, email, roles: [...], permissions: [...] }`

## Admin — Backend Dev 2

### GET /admin/users
Response 200: `[{ id, name, email, roles: [...] }]`

### PUT /admin/users/:id/roles
Request: `{ roleIds: [1,2] }`
Response 200: `{ id, roles: [...] }`

### PUT /admin/users/:id/manager
Request: `{ managerId }`
Response 200: `{ id, name, email, department, status, manager_id }`
Response 400: `{ error: "managerId is required" }` |
  `{ error: "A user cannot be their own manager" }` |
  `{ error: "managerId must belong to a user holding the manager role" }`
Response 404: `{ error: "User not found" }`
`managerId` must belong to a user currently holding the `manager` role
(active `user_roles` row, not expired) or the request is rejected — see
rbac.routes.js. Fills the gap noted in Request.routes.js: without this,
`users.manager_id` stays NULL after registration and every access request
sits at `PENDING_MANAGER` forever unless an admin skip-levels it via PUT
`/admin/access-requests/:id`.

### GET /admin/roles
### POST /admin/roles          Request: `{ name, description }`
### PUT /admin/roles/:id       Request: `{ name?, description?, permissionIds? }`
### DELETE /admin/roles/:id

### GET /admin/permissions
### POST /admin/permissions    Request: `{ name, description }`

### POST /access-requests
Request: `{ requestedRoleId }`   (user-facing, any logged-in user)
Response 201: `{ id, status: "pending" }`

### GET /admin/access-requests?status=pending
Response 200: `[{ id, user: {...}, requestedRole: {...}, requestedAt }]`

### PUT /admin/access-requests/:id
Request: `{ status: "approved" | "denied" }`
Response 200: `{ id, status }`

### GET /admin/audit-logs?limit=50&page=1&userId=
Response 200: `[{ id, user, action, resource, ipAddress, createdAt }]`

## Rules Engine / Alerts — Lead

### GET /admin/alerts?minScore=50&page=1&limit=20
Response 200: `[{ id, userId, riskScore, reason, createdAt }]`

### POST /admin/alerts/:id/invalidate-session
`:id` is the alert's `id` (the underlying `login_events` row), not a user id.
Forces that user's current token(s) to stop passing `requireAuth` — see
`tokens_invalid_before` in schema.sql (schema change, team notified).
Response 200: `{ message, user: { id, name, email, tokensInvalidBefore } }`
Response 404 if the alert id doesn't exist.

## Route protection
Every route above except `/auth/*` uses:
```js
router.get('/admin/users', requireAuth, checkPermission('manage_users'), handler);
```
`requireAuth` verifies the JWT. `checkPermission(featureName)` checks the
user's roles → permissions in Postgres, logs the check to `audit_logs`, and
returns 403 if not permitted.