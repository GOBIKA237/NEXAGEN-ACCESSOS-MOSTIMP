// Integration tests for auth.routes.js.
//
// These hit a real Postgres database via the same `pool` the app uses
// (DATABASE_URL from .env / .env.test), because db.js exports a live pg
// Pool at module scope and isn't mine to change to support mocking.
// Run against a disposable/dev DB — these tests write and delete rows.
//
// Run with: npm test
// (requires the `supertest` devDependency added alongside this file)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import authRoutes from '../src/routes/auth.routes.js';
import { pool } from '../src/config/db.js';

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);

const TEST_EMAIL = 'auth-test-user@example.com';
const TEST_PASSWORD = 'correct-horse-battery';

async function cleanupTestUser() {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [TEST_EMAIL]);
  const userId = rows[0]?.id;
  if (!userId) return;

  // No ON DELETE CASCADE on login_events / audit_logs (see docs/schema.sql),
  // so these have to go first or the users delete violates the FK.
  await pool.query('DELETE FROM login_events WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

before(async () => {
  await cleanupTestUser();
});

after(async () => {
  await cleanupTestUser();
  await pool.end();
});

test('POST /auth/register with a duplicate email returns 409', async () => {
  const payload = { name: 'Auth Test User', email: TEST_EMAIL, password: TEST_PASSWORD };

  const first = await request(app).post('/auth/register').send(payload);
  assert.equal(first.status, 201);

  const second = await request(app).post('/auth/register').send(payload);
  assert.equal(second.status, 409);
  assert.equal(typeof second.body.error, 'string');
});

test('POST /auth/login with the wrong password returns 401', async () => {
  const res = await request(app)
    .post('/auth/login')
    .send({ email: TEST_EMAIL, password: 'definitely-not-the-right-password' });

  assert.equal(res.status, 401);
  assert.equal(typeof res.body.error, 'string');
});

test('GET /auth/me reflects a role change made after login, not the login-time snapshot', async () => {
  // Fresh user for this test so we control its starting role precisely.
  const email = 'auth-test-role-refresh@example.com';
  const password = 'correct-horse-battery';
  await pool.query('DELETE FROM login_events WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [email]);
  await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [email]);
  await pool.query('DELETE FROM users WHERE email = $1', [email]);

  await request(app).post('/auth/register').send({ name: 'Role Refresh', email, password });
  // New registrations land on 'employee' (see /auth/register) — no permissions
  // are granted to that role in the seed data, so this starts empty.

  const login = await request(app).post('/auth/login').send({ email, password });
  assert.equal(login.status, 200);
  const { token } = login.body;

  const before = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
  assert.equal(before.status, 200);
  assert.deepEqual(before.body.roles, ['employee']);
  assert.deepEqual(before.body.permissions, []);

  // Simulate an admin granting the 'admin' role via rbac.routes.js, without
  // the user logging in again or getting a new token.
  const { rows: userRows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  const userId = userRows[0].id;
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'admin'`,
    [userId]
  );

  const after = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
  assert.equal(after.status, 200);
  assert.ok(after.body.roles.includes('admin'), 'expected the newly granted admin role to appear');
  assert.ok(
    after.body.permissions.length > before.body.permissions.length,
    'expected permissions to grow along with the new role'
  );

  // cleanup
  await pool.query('DELETE FROM login_events WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
});

test('POST /auth/login locks the account after repeated failed attempts, independent of scoreLogin', async () => {
  const email = 'auth-test-lockout@example.com';
  const password = 'correct-horse-battery';
  await pool.query('DELETE FROM login_events WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [email]);
  await pool.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email = $1)', [email]);
  await pool.query('DELETE FROM users WHERE email = $1', [email]);

  await request(app).post('/auth/register').send({ name: 'Lockout Test', email, password });

  // Threshold is 5 by default (LOGIN_LOCKOUT_THRESHOLD) — drive it there with
  // wrong-password attempts, same as a real brute-force attempt would.
  let lastRes;
  for (let i = 0; i < 5; i += 1) {
    lastRes = await request(app).post('/auth/login').send({ email, password: 'wrong-password' });
  }
  assert.equal(lastRes.status, 401, 'the 5th failure itself should still just be a normal 401');

  // The 6th attempt — even with the CORRECT password — should now be hard-blocked.
  const blocked = await request(app).post('/auth/login').send({ email, password });
  assert.equal(blocked.status, 429);
  assert.equal(typeof blocked.body.error, 'string');
  assert.ok(blocked.headers['retry-after'], 'expected a Retry-After header on the 429');

  // scoreLogin()'s own risk-scoring path must be untouched: the failed
  // attempts above still land in login_events with an integer risk_score,
  // never anything that would indicate scoreLogin's return shape changed.
  const { rows: userRows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  const userId = userRows[0].id;
  const { rows: events } = await pool.query(
    'SELECT risk_score FROM login_events WHERE user_id = $1',
    [userId]
  );
  assert.ok(events.length >= 6);
  for (const row of events) {
    assert.equal(typeof row.risk_score, 'number');
  }

  // cleanup
  await pool.query('DELETE FROM login_events WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
});