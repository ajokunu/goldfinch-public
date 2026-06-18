/**
 * P8-4 account-type editing integration: the account detail screen's
 * "Account type" row opens the sheet of all shared ACCOUNT_TYPES, selection
 * PATCHes optimistically (the label flips before the server replies), the
 * server response converges the cache, and any PATCH failure (409 conflict)
 * rolls the optimistic edit back and surfaces the inline error note.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { PatchAccountRequest } from '@goldfinch/shared/types';

import AccountDetailScreen from '../features/investments';
import { listOf, makeAccountDto } from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

const ACCOUNT_ID = 'acct-checking';
const account = makeAccountDto(); // 'Everyday Checking', effective type 'checking'

function mockDetailRoutes(): void {
  mockApi.get(`/accounts/${ACCOUNT_ID}`, account);
  mockApi.get(`/accounts/${ACCOUNT_ID}/holdings`, {
    ...listOf([]),
    holdingsSupported: false,
  });
}

async function openSheetAndPickSavings(): Promise<void> {
  renderWithProviders(<AccountDetailScreen accountId={ACCOUNT_ID} />);
  fireEvent.press(await screen.findByLabelText('Account type'));
  fireEvent.press(await screen.findByTestId('account-type-option-savings'));
}

describe('P8-4 account type editing', () => {
  it('lists every shared account type in the sheet', async () => {
    mockDetailRoutes();
    renderWithProviders(<AccountDetailScreen accountId={ACCOUNT_ID} />);

    fireEvent.press(await screen.findByLabelText('Account type'));

    for (const typeId of [
      'checking',
      'savings',
      'credit-card',
      'investment',
      'business',
      'loan',
      'cash',
      'other',
    ]) {
      expect(
        await screen.findByTestId(`account-type-option-${typeId}`),
      ).toBeOnTheScreen();
    }
  });

  it('PATCHes optimistically and converges on the server response', async () => {
    mockDetailRoutes();
    const gate = mockApi.defer('PATCH', `/accounts/${ACCOUNT_ID}`);

    await openSheetAndPickSavings();

    // Optimistic: the row reflects Savings while the PATCH is still held.
    await waitFor(() =>
      expect(screen.getAllByText('Savings').length).toBeGreaterThan(0),
    );

    gate.resolve({
      status: 200,
      body: { ...account, accountTypeId: 'savings' },
    });

    await waitFor(() =>
      expect(screen.getAllByText('Savings').length).toBeGreaterThan(0),
    );
    expect(
      screen.queryByText(
        'The account type could not be updated. Your change was undone.',
      ),
    ).toBeNull();
  });

  it('sends the selected type as the PATCH body', async () => {
    mockDetailRoutes();
    const bodies: PatchAccountRequest[] = [];
    mockApi.on('PATCH', `/accounts/${ACCOUNT_ID}`, (request) => {
      bodies.push(request.body as PatchAccountRequest);
      return { status: 200, body: { ...account, accountTypeId: 'savings' } };
    });

    await openSheetAndPickSavings();

    await waitFor(() => expect(bodies).toEqual([{ accountType: 'savings' }]));
  });

  it('rolls back the optimistic edit and surfaces the note on 409', async () => {
    mockDetailRoutes();
    mockApi.error(
      'PATCH',
      `/accounts/${ACCOUNT_ID}`,
      409,
      'VERSION_CONFLICT',
      'another writer won',
    );

    await openSheetAndPickSavings();

    // Rollback: the error note appears and the row shows Checking again.
    expect(
      await screen.findByText(
        'The account type could not be updated. Your change was undone.',
      ),
    ).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Savings')).toBeNull());
    expect(screen.getAllByText('Checking').length).toBeGreaterThan(0);
  });
});
