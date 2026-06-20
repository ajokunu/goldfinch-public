/**
 * Pure shell-logic unit tests (design-spec shell.md 10: sidebar active-route
 * matching and friends are node --test + StrykerJS targets). Expected values
 * are literals from shell.md 2.1 / 4.1, never recomputed with the helpers
 * under test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isFabPathname,
  isHiddenTabItemStyle,
  isSidebarItemActive,
  normalizePathname,
} from '../shell/navActive';
import { EMPTY_PROFILE, profileFromClaims } from '../shell/profileClaims';

describe('normalizePathname', () => {
  it('keeps the root as-is', () => {
    assert.equal(normalizePathname('/'), '/');
  });

  it('maps the empty string to the root', () => {
    assert.equal(normalizePathname(''), '/');
  });

  it('strips a single trailing slash', () => {
    assert.equal(normalizePathname('/more/goals/'), '/more/goals');
  });

  it('strips repeated trailing slashes', () => {
    assert.equal(normalizePathname('/budget///'), '/budget');
  });

  it('leaves interior segments untouched', () => {
    assert.equal(normalizePathname('/more/goals'), '/more/goals');
  });
});

describe('isFabPathname (shell.md 2.1: Home, Activity, Budget only)', () => {
  it('shows the FAB on the three add-capable tabs', () => {
    assert.equal(isFabPathname('/'), true);
    assert.equal(isFabPathname('/transactions'), true);
    assert.equal(isFabPathname('/budget'), true);
  });

  it('shows the FAB for trailing-slash web URLs', () => {
    assert.equal(isFabPathname('/transactions/'), true);
  });

  it('hides the FAB on Reports and the More stack', () => {
    assert.equal(isFabPathname('/reports'), false);
    assert.equal(isFabPathname('/more'), false);
    assert.equal(isFabPathname('/more/goals'), false);
    assert.equal(isFabPathname('/more/settings'), false);
  });

  it('hides the FAB on detail routes', () => {
    assert.equal(isFabPathname('/accounts/abc123'), false);
    assert.equal(isFabPathname('/attachments/t1/a1'), false);
  });
});

describe('isSidebarItemActive (shell.md 4.1: exact for /, prefix otherwise)', () => {
  it('matches the dashboard only exactly', () => {
    assert.equal(isSidebarItemActive('/', '/'), true);
    assert.equal(isSidebarItemActive('/transactions', '/'), false);
    assert.equal(isSidebarItemActive('/more/goals', '/'), false);
  });

  it('matches exact non-root routes', () => {
    assert.equal(isSidebarItemActive('/transactions', '/transactions'), true);
    assert.equal(isSidebarItemActive('/more/goals', '/more/goals'), true);
  });

  it('prefix-matches deeper paths on segment boundaries', () => {
    assert.equal(
      isSidebarItemActive('/more/goals/g-42', '/more/goals'),
      true,
    );
  });

  it('does not match sibling routes sharing a string prefix', () => {
    assert.equal(
      isSidebarItemActive('/transactions-export', '/transactions'),
      false,
    );
    assert.equal(
      isSidebarItemActive('/more/goalsetting', '/more/goals'),
      false,
    );
  });

  it('does not cross-match distinct More children', () => {
    assert.equal(isSidebarItemActive('/more/rules', '/more/import'), false);
  });

  it('normalizes trailing slashes on both sides', () => {
    assert.equal(isSidebarItemActive('/more/goals/', '/more/goals'), true);
    assert.equal(isSidebarItemActive('/more/goals', '/more/goals/'), true);
  });
});

describe('isHiddenTabItemStyle (expo-router href:null filter)', () => {
  it('detects the display:none object expo-router injects', () => {
    assert.equal(isHiddenTabItemStyle({ display: 'none' }), true);
  });

  it('detects display:none inside nested style arrays', () => {
    assert.equal(
      isHiddenTabItemStyle([null, [{ flex: 1 }, { display: 'none' }]]),
      true,
    );
  });

  it('passes visible styles through', () => {
    assert.equal(isHiddenTabItemStyle(undefined), false);
    assert.equal(isHiddenTabItemStyle(null), false);
    assert.equal(isHiddenTabItemStyle({ display: 'flex' }), false);
    assert.equal(isHiddenTabItemStyle([{ flex: 1 }]), false);
  });
});

describe('profileFromClaims (shell.md 3.1 identity rules)', () => {
  it('uses the name claim with the email as the secondary line', () => {
    const profile = profileFromClaims({
      name: 'Alex',
      email: 'alex@example.com',
    });
    assert.deepEqual(profile, {
      name: 'Alex',
      email: 'alex@example.com',
      initial: 'A',
    });
  });

  it('falls back to given_name when name is absent', () => {
    const profile = profileFromClaims({
      given_name: 'mina',
      email: 'mina@example.com',
    });
    assert.equal(profile.name, 'mina');
    assert.equal(profile.initial, 'M');
  });

  it('derives the initial from the email when no name claim exists', () => {
    const profile = profileFromClaims({ email: 'kim@example.com' });
    assert.deepEqual(profile, {
      name: null,
      email: 'kim@example.com',
      initial: 'K',
    });
  });

  it('treats blank and non-string claims as absent', () => {
    const profile = profileFromClaims({
      name: '   ',
      given_name: 42,
      email: false,
    });
    assert.deepEqual(profile, { name: null, email: null, initial: null });
  });

  it('trims whitespace around claims', () => {
    const profile = profileFromClaims({ email: '  pat@example.com  ' });
    assert.equal(profile.email, 'pat@example.com');
    assert.equal(profile.initial, 'P');
  });

  it('keeps non-Latin initials intact', () => {
    const profile = profileFromClaims({ name: '민지' });
    assert.equal(profile.initial, '민');
  });

  it('exposes a frozen empty profile for the claims-unavailable branch', () => {
    assert.deepEqual(EMPTY_PROFILE, { name: null, email: null, initial: null });
    assert.equal(Object.isFrozen(EMPTY_PROFILE), true);
  });
});
