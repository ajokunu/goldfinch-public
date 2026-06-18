/**
 * Display-name change flow (the "iPhone can't change my name" report).
 *
 * Proves the feature works against the live data layer over the mocked fetch
 * edge: opening the greeting sheet, typing a name, and saving issues the exact
 * PATCH /profile the deployed API accepts, and a rejected save surfaces an
 * error without closing. Platform-agnostic (jest-expo) -- the same code path
 * runs on iOS, Android, and web, so a green run here means the only way the
 * iPhone "can't change the name" is a stale build, not a code defect.
 */
import { fireEvent, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { GreetingNameSheet } from '../features/dashboard/components/GreetingNameSheet';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

beforeEach(() => mockApi.install());
afterEach(() => {
  mockApi.reset();
  mockApi.uninstall();
});

describe('display-name change', () => {
  it('PATCHes /profile with the typed name and closes on success', async () => {
    // Fresh user with no profile yet (Dami: GET 404 -> null name).
    mockApi.error('GET', '/profile', 404, 'NOT_FOUND', 'no profile yet');
    let received: unknown = null;
    mockApi.on('PATCH', '/profile', (req) => {
      received = req.body;
      return { status: 200, body: { displayName: 'Dami', email: 'd@x.com' } };
    });

    let closed = false;
    const { getByTestId, getByText } = renderWithProviders(
      <GreetingNameSheet
        visible
        onClose={() => {
          closed = true;
        }}
      />,
    );

    fireEvent.changeText(getByTestId('greeting-name-input'), 'Dami');
    fireEvent.press(getByText('Save name'));

    await waitFor(() => expect(received).toEqual({ displayName: 'Dami' }));
    await waitFor(() => expect(closed).toBe(true));
  });

  it('trims whitespace before sending', async () => {
    mockApi.error('GET', '/profile', 404, 'NOT_FOUND', 'no profile yet');
    let received: unknown = null;
    mockApi.on('PATCH', '/profile', (req) => {
      received = req.body;
      return { status: 200, body: { displayName: 'Dami' } };
    });
    const { getByTestId, getByText } = renderWithProviders(
      <GreetingNameSheet visible onClose={() => {}} />,
    );
    fireEvent.changeText(getByTestId('greeting-name-input'), '  Dami  ');
    fireEvent.press(getByText('Save name'));
    await waitFor(() => expect(received).toEqual({ displayName: 'Dami' }));
  });

  it('surfaces an error and does not close when the API rejects', async () => {
    mockApi.error('GET', '/profile', 404, 'NOT_FOUND', 'no profile yet');
    mockApi.error('PATCH', '/profile', 409, 'VERSION_CONFLICT', 'conflict');
    mockApi.error('GET', '/profile', 404, 'NOT_FOUND', 'settled refetch');
    let closed = false;
    const { getByTestId, getByText } = renderWithProviders(
      <GreetingNameSheet
        visible
        onClose={() => {
          closed = true;
        }}
      />,
    );
    fireEvent.changeText(getByTestId('greeting-name-input'), 'Dami');
    fireEvent.press(getByText('Save name'));
    await waitFor(() =>
      expect(getByText('Could not save your name')).toBeTruthy(),
    );
    expect(closed).toBe(false);
  });
});
