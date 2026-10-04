import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAdminNavigation, isAdminNavActive } from '../lib/admin-navigation';

test('host managers can reach daily and maintenance work without administrator-only menus', () => {
  const navigation = getAdminNavigation('host', 'manager');
  const paths = navigation.groups.flatMap(group => group.items.map(item => item.href));
  assert.deepEqual(navigation.primary.map(item => item.href), ['/admin', '/admin/calendar', '/admin/messages']);
  for (const href of ['/admin/inventory', '/admin/issues', '/admin/supplies', '/admin/integrations', '/admin/payments']) assert.ok(paths.includes(href));
  assert.ok(!paths.includes('/admin/guests'));
  assert.ok(!paths.includes('/admin/api-clients'));
  assert.ok(!paths.includes('/admin/jongno-events'));
  assert.ok(!paths.includes('/admin/cleaning-requests'));
  assert.equal(navigation.secondary[0].href, '/cleaner');
});

test('tour bottom navigation prioritizes tour bookings and products instead of cleaning', () => {
  const navigation = getAdminNavigation('tour', 'super_admin');
  assert.deepEqual(navigation.primary.map(item => item.href), ['/admin', '/admin/tour-bookings', '/admin/tours']);
  const paths = navigation.groups.flatMap(group => group.items.map(item => item.href));
  assert.ok(paths.includes('/admin/tour-operators'));
  assert.ok(paths.includes('/admin/api-clients'));
  assert.ok(paths.includes('/admin/jongno-events'));
  assert.ok(!paths.includes('/admin/calendar'));
  assert.ok(!paths.includes('/admin/payments'));
  assert.equal(navigation.secondary[0].href, '/cleaner');
});

test('Jongno event editing stays administrator-only in both management modes', () => {
  for (const mode of ['host', 'tour'] as const) {
    const administrator = getAdminNavigation(mode, 'super_admin').groups.flatMap(group => group.items);
    const manager = getAdminNavigation(mode, 'manager').groups.flatMap(group => group.items);
    assert.ok(administrator.some(item => item.href === '/admin/jongno-events'));
    assert.ok(!manager.some(item => item.href === '/admin/jongno-events'));
  }
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

test('a manager sees granted modules while business administrators do not acquire platform tools', () => {
  const limited = getAdminNavigation('host', 'manager', { enabledModules: ['cleaning', 'laundry', 'staff'], organizationFeatures: { laundry: false } });
  const paths = limited.groups.flatMap(group => group.items.map(item => item.href));
  assert.ok(!paths.includes('/admin/cleaning-requests'));
  assert.ok(paths.includes('/admin/staff'));
  for (const hidden of ['/admin/calendar', '/admin/messages', '/admin/laundry', '/admin/settings', '/admin/activity']) assert.ok(!paths.includes(hidden));
  const business = getAdminNavigation('host', 'admin').groups.flatMap(group => group.items.map(item => item.href));
  assert.ok(business.includes('/admin/settings')); assert.ok(business.includes('/admin/activity'));
  assert.ok(!business.includes('/admin/api-clients')); assert.ok(!business.includes('/admin/guests'));
});
