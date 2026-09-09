import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginDestination } from '../lib/login-destination';
test('login returns to the requested conversation and respects account role', () => {
 assert.equal(loginDestination('/admin/messages?eventId=123', 'manager'), '/admin/messages?eventId=123');
 assert.equal(loginDestination('/cleaner/calendar', 'cleaner'), '/cleaner/calendar');
 assert.equal(loginDestination('/admin/users', 'cleaner'), '/cleaner');
 assert.equal(loginDestination(null, 'manager'), '/admin');
});
test('login never redirects to an external or public destination', () => {
 for (const path of ['//evil.example', 'https://evil.example', '/api/auth/logout', '/admin/../../login', '/administer', '/\\evil.example']) assert.equal(loginDestination(path, 'manager'), '/admin');
});
