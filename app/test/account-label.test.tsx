/**
 * Account label + institution override editing (client UI over the locked
 * shared contract): the account detail screen's "Name" / "Institution" rows
 * open a text-edit sheet, saving PATCHes the matching override optimistically
 * (the row + header flip before the server replies), an empty draft sends null
 * to CLEAR the override (reverting to the synced value), and a set override
 * surfaces the synced value as a "from <synced>" subtitle. Also covers the
 * dashboard reachability + grouping-default changes: an account row navigates to
 * the detail route, the detail screen carries a View transactions affordance,
 * and the Accounts card defaults to Type grouping.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { PatchAccountRequest } from '@goldfinch/shared/types';

import AccountDetailScreen from '../features/investments';
import DashboardScreen from '../features/dashboard';
import {
  listOf,
  makeAccountDto,
  makeNetWorthHistoryResponse,
  makeReportsFlowResponse,
  makeSummaryResponse,
} from './fixtures';
import { currentIsoMonth } from '../src/lib/dates';
import { mockApi } from './mockApi';
import { routerMock } from './expoRouterMock';
import { renderWithProviders } from './render';

const ACCOUNT_ID = 'acct-checking';
const MONTH = currentIsoMonth();

// 'Everyday Checking' / 'Test Credit Union', no overrides set.
const account = makeAccountDto();
// Same account with a label override already set -> the subtitle path.
const renamedAccount = makeAccountDto({
  overrides: { nameOverride: 'Joint Checking' },
});

function mockDetailRoutes(dto = account): void {
  mockApi.get(`/accounts/${ACCOUNT_ID}`, dto);
  mockApi.get(`/accounts/${ACCOUNT_ID}/holdings`, {
    ...listOf([]),
    holdingsSupported: false,
  });
}

async function openNameSheet(): Promise<void> {
  renderWithProviders(<AccountDetailScreen accountId={ACCOUNT_ID} />);
  fireEvent.press(await screen.findByLabelText('Name'));
  await screen.findByTestId('account-name-input');
}

describe('account label editing', () => {
  it('prefills the name input from the override, with the synced name as placeholder', async () => {
    mockDetailRoutes(renamedAccount);

    renderWithProviders(<AccountDetailScreen accountId={ACCOUNT_ID} />);
    fireEvent.press(await screen.findByLabelText('Name'));

    const input = await screen.findByTestId('account-name-input');
    expect(input.props.value).toBe('Joint Checking');
    expect(input.props.placeholder).toBe('Everyday Checking');
  });

  it('shows the synced name as a "from <synced>" subtitle when an override is set', async () => {
    mockDetailRoutes(renamedAccount);

    renderWithProviders(<AccountDetailScreen accountId={ACCOUNT_ID} />);

    expect(await screen.findByText('from Everyday Checking')).toBeOnTheScreen();
  });

  it('PATCHes nameOverride and optimistically updates before the server replies', async () => {
    mockDetailRoutes();
    const gate = mockApi.defer('PATCH', `/accounts/${ACCOUNT_ID}`);

    await openNameSheet();
    fireEvent.changeText(screen.getByTestId('account-name-input'), '  Joint Checking  ');
    fireEvent.press(screen.getByText('Save'));

    // Optimistic: the effective name flips while the PATCH is still held.
    await waitFor(() =>
      expect(screen.getAllByText('Joint Checking').length).toBeGreaterThan(0),
    );

    gate.resolve({
      status: 200,
      body: { ...account, name: 'Joint Checking', nameOverride: 'Joint Checking' },
    });

    await waitFor(() =>
      expect(screen.getAllByText('Joint Checking').length).toBeGreaterThan(0),
    );
    expect(
      screen.queryByText('The name could not be updated. Your change was undone.'),
    ).toBeNull();
  });

  it('sends the trimmed override as the PATCH body', async () => {
    mockDetailRoutes();
    const bodies: PatchAccountRequest[] = [];
    mockApi.on('PATCH', `/accounts/${ACCOUNT_ID}`, (request) => {
      bodies.push(request.body as PatchAccountRequest);
      return {
        status: 200,
        body: { ...account, name: 'Joint Checking', nameOverride: 'Joint Checking' },
      };
    });

    await openNameSheet();
    fireEvent.changeText(screen.getByTestId('account-name-input'), '  Joint Checking  ');
    fireEvent.press(screen.getByText('Save'));

    await waitFor(() =>
      expect(bodies).toEqual([{ nameOverride: 'Joint Checking' }]),
    );
  });

  it('sends null to CLEAR the override when the input is emptied', async () => {
    mockDetailRoutes(renamedAccount);
    const bodies: PatchAccountRequest[] = [];
    mockApi.on('PATCH', `/accounts/${ACCOUNT_ID}`, (request) => {
      bodies.push(request.body as PatchAccountRequest);
      return { status: 200, body: account };
    });

    renderWithProviders(<AccountDetailScreen accountId={ACCOUNT_ID} />);
    fireEvent.press(await screen.findByLabelText('Name'));
    fireEvent.changeText(await screen.findByTestId('account-name-input'), '   ');
    fireEvent.press(screen.getByText('Save'));

    // Clear semantics: a blank draft becomes null on the wire.
    await waitFor(() => expect(bodies).toEqual([{ nameOverride: null }]));
    // The effective name reverts to the synced one.
    await waitFor(() =>
      expect(screen.getAllByText('Everyday Checking').length).toBeGreaterThan(0),
    );
  });

  it('rolls back and surfaces the inline note on a 409', async () => {
    mockDetailRoutes();
    mockApi.error(
      'PATCH',
      `/accounts/${ACCOUNT_ID}`,
      409,
      'VERSION_CONFLICT',
      'another writer won',
    );

    await openNameSheet();
    fireEvent.changeText(screen.getByTestId('account-name-input'), 'Joint Checking');
    fireEvent.press(screen.getByText('Save'));

    expect(
      await screen.findByText(
        'The name could not be updated. Your change was undone.',
      ),
    ).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Joint Checking')).toBeNull());
  });

  it('PATCHes institutionOverride from the Institution row', async () => {
    mockDetailRoutes();
    const bodies: PatchAccountRequest[] = [];
    mockApi.on('PATCH', `/accounts/${ACCOUNT_ID}`, (request) => {
      bodies.push(request.body as PatchAccountRequest);
      return {
        status: 200,
        body: { ...account, institution: 'My Bank', institutionOverride: 'My Bank' },
      };
    });

    renderWithProviders(<AccountDetailScreen accountId={ACCOUNT_ID} />);
    fireEvent.press(await screen.findByLabelText('Institution'));
    fireEvent.changeText(
      await screen.findByTestId('account-institution-input'),
      'My Bank',
    );
    fireEvent.press(screen.getByText('Save'));

    await waitFor(() =>
      expect(bodies).toEqual([{ institutionOverride: 'My Bank' }]),
    );
  });
});

describe('account detail reachability', () => {
  it('navigates from the detail screen to the account-scoped transactions view', async () => {
    mockDetailRoutes();

    renderWithProviders(<AccountDetailScreen accountId={ACCOUNT_ID} />);
    fireEvent.press(await screen.findByLabelText('View transactions'));

    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/transactions',
      params: { accountId: ACCOUNT_ID },
    });
  });
});

describe('dashboard accounts card', () => {
  const checking = makeAccountDto();
  const summary = makeSummaryResponse({
    netWorthMinor: 523_055,
    assetsTotalMinor: 523_055,
    liabilitiesTotalMinor: 0,
    byType: [
      {
        type: 'checking',
        label: 'Cash',
        isLiability: false,
        totalMinor: 523_055,
        accounts: [checking],
      },
    ],
    byInstitution: [
      {
        institution: 'Test Credit Union',
        totalMinor: 523_055,
        accounts: [checking],
      },
    ],
  });

  function mockDashboardRoutes(): void {
    mockApi.get('/summary', summary);
    mockApi.get('/accounts', listOf([checking]));
    mockApi.get('/transactions', listOf([]));
    mockApi.get('/categories', listOf([]));
    mockApi.get('/recurring', listOf([]));
    mockApi.get('/networth/history', makeNetWorthHistoryResponse([]));
    mockApi.get(
      '/reports/flow',
      makeReportsFlowResponse(MONTH, { incomeMinor: 0, expenseMinor: 0 }, []),
    );
    mockApi.get('/profile', { displayName: null });
  }

  it('defaults the grouping to Type (institution shown as the row secondary)', async () => {
    mockDashboardRoutes();

    renderWithProviders(<DashboardScreen />);

    expect(await screen.findByText('Everyday Checking')).toBeOnTheScreen();
    // Type grouping keys groups by the effective-type label ('Cash'), which is
    // exclusive to the Type view; Bank grouping would head the group with the
    // institution instead. The institution moves to the row secondary line.
    expect(await screen.findByText('Cash')).toBeOnTheScreen();
    expect(await screen.findByText('Test Credit Union')).toBeOnTheScreen();
  });

  it('navigates an account row to the detail route, not straight to transactions', async () => {
    mockDashboardRoutes();

    renderWithProviders(<DashboardScreen />);
    fireEvent.press(await screen.findByText('Everyday Checking'));

    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/accounts/[accountId]',
      params: { accountId: 'acct-checking' },
    });
  });
});
