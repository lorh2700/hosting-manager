import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAdminNavigation, isAdminNavActive } from '../lib/admin-navigation';

test('host managers can reach daily and maintenance work without administrator-only menus', () => {
  const navigation = getAdminNavigation('host', 'manager');
  const paths = navigation.groups.flatMap(group => group.items.map(item => item.href));
  assert.deepEqual(navigation.primary.map(item => item.href), ['/admin', '/admin/calendar', '/admin/messages']);
  for (const href of ['/admin/issues', '/admin/supplies', '/admin/integrations', '/admin/payments']) assert.ok(paths.includes(href));
  assert.ok(!paths.includes('/admin/guests'));
  assert.ok(!paths.includes('/admin/api-clients'));
  assert.equal(navigation.secondary[0].href, '/cleaner');
});

test('tour bottom navigation prioritizes tour bookings and products instead of cleaning', () => {
  const navigation = getAdminNavigation('tour', 'admin');
  assert.deepEqual(navigation.primary.map(item => item.href), ['/admin', '/admin/tour-bookings', '/admin/tours']);
  const paths = navigation.groups.flatMap(group => group.items.map(item => item.href));
  assert.ok(paths.includes('/admin/tour-operators'));
  assert.ok(paths.includes('/admin/api-clients'));
  assert.ok(!paths.includes('/admin/calendar'));
  assert.ok(!paths.includes('/admin/payments'));
  assert.equal(navigation.secondary[0].href, '/cleaner');
});

test('cleaner roles do not acquire admin work links through menu configuration', () => {
  for (const mode of ['host', 'tour'] as const) {
    const navigation = getAdminNavigation(mode, 'cleaner');
    assert.deepEqual(navigation.groups.flatMap(group => group.items.map(item => item.href)), ['/admin/settings/profile']);
    assert.equal(navigation.primary.length, 0);
    assert.equal(navigation.secondary.length, 0);
  }
});

test('active menu follows nested routes and the Today alias without partial path matches', () => {
  assert.equal(isAdminNavActive('/admin/ops', '/admin'), true);
  assert.equal(isAdminNavActive('/admin/calendar', '/admin'), false);
  assert.equal(isAdminNavActive('/admin/properties/anon/calendar', '/admin/properties'), true);
  assert.equal(isAdminNavActive('/admin/properties-old', '/admin/properties'), false);
  assert.equal(isAdminNavActive('/admin/tour-bookings', '/admin/tours'), false);
});
