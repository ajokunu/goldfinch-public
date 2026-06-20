/**
 * More hub integration: the five destination rows render with their
 * localized labels/details and navigate via the router, the profile card
 * renders identity from the stored Cognito ID token's display claims, and
 * the brand footer carries the wordmark + live version line.
 */
import { fireEvent, screen } from '@testing-library/react-native';

import MoreHubScreen from '../app/(app)/more/index';
import { SECURE_KEYS } from '../src/config';
import { routerMock } from './expoRouterMock';
import { renderWithProviders } from './render';
import { seedSecureStore } from './secureStoreMock';

/** Unsigned test JWT (header.payload.signature) carrying display claims. */
function fakeIdToken(claims: Record<string, unknown>): string {
  const b64url = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.x`;
}

describe('More hub', () => {
  it('renders every destination row and navigates on press', async () => {
    seedSecureStore(
      SECURE_KEYS.idToken,
      fakeIdToken({ name: 'Alex', email: 'alex@example.com' }),
    );
    renderWithProviders(<MoreHubScreen />);

    expect(await screen.findByText('Goals')).toBeOnTheScreen();
    expect(screen.getByText('Savings targets & projections')).toBeOnTheScreen();
    expect(screen.getByText('Recurring')).toBeOnTheScreen();
    expect(screen.getByText('Bills, subscriptions & income')).toBeOnTheScreen();
    expect(screen.getByText('Rules')).toBeOnTheScreen();
    expect(screen.getByText('Auto-categorize transactions')).toBeOnTheScreen();
    expect(screen.getByText('Import')).toBeOnTheScreen();
    expect(screen.getByText('Bring in CSV statements')).toBeOnTheScreen();
    expect(screen.getByText('Settings')).toBeOnTheScreen();
    expect(screen.getByText('Accounts, security, profile')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Goals'));
    expect(routerMock.push).toHaveBeenCalledWith('/more/goals');

    fireEvent.press(screen.getByText('Recurring'));
    expect(routerMock.push).toHaveBeenCalledWith('/more/recurring');
  });

  it('renders the profile card from the stored ID token claims', async () => {
    seedSecureStore(
      SECURE_KEYS.idToken,
      fakeIdToken({ name: 'Alex', email: 'alex@example.com' }),
    );
    renderWithProviders(<MoreHubScreen />);

    expect(await screen.findByText('Alex')).toBeOnTheScreen();
    expect(screen.getByText('alex@example.com')).toBeOnTheScreen();
  });

  it('degrades to identity-free chrome when no ID token exists', async () => {
    renderWithProviders(<MoreHubScreen />);

    expect(await screen.findByText('Goals')).toBeOnTheScreen();
    expect(screen.queryByText('Alex')).toBeNull();
    expect(screen.queryByText('alex@example.com')).toBeNull();
  });

  it('renders the brand footer with wordmark and version line', async () => {
    renderWithProviders(<MoreHubScreen />);

    expect(await screen.findByText('GoldFinch')).toBeOnTheScreen();
    expect(screen.getByText(/^Version /)).toBeOnTheScreen();
  });
});
