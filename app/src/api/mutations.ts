/**
 * Shared mutation hooks for the Phase 7 domains, following the established
 * pattern from features/budget/hooks/useBudgetMutations.ts: each mutation
 * invalidates exactly the caches its server-side write can change, and
 * version-conflict-prone PATCHes also invalidate on error so the next try
 * starts from the winning version.
 *
 * Feature parts compose these (adding their own optimistic cache edits where
 * a snappier UX is worth it); the invalidation sets here are the contract for
 * which views a write touches.
 */
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { ACCOUNT_TYPES } from '@goldfinch/shared/accountTypes';
import type {
  AccountDto,
  ApplyRuleRequest,
  CreateAccountRequest,
  CreateAttachmentRequest,
  CreateGoalContributionRequest,
  CreateGoalRequest,
  CreateRuleRequest,
  ImportTransactionsRequest,
  ListAccountsResponse,
  PatchAccountRequest,
  PatchGoalRequest,
  PatchRecurringRequest,
  PatchRuleRequest,
} from '@goldfinch/shared/types';

import { logger } from '../lib/logger';
import {
  applyRule,
  createAccount,
  createAttachment,
  createGoal,
  createGoalContribution,
  createRule,
  deleteAttachment,
  deleteGoal,
  deleteRule,
  importTransactions,
  patchAccount,
  patchGoal,
  patchRecurring,
  patchRule,
} from './endpoints';
import { queryKeys } from './queryKeys';

const log = logger.child({ module: 'api.mutations' });

function invalidate(
  queryClient: QueryClient,
  keys: ReadonlyArray<readonly unknown[]>,
): void {
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/** Every view derived from transaction/category placement (spend rollups). */
function spendViewKeys(): ReadonlyArray<readonly unknown[]> {
  return [
    queryKeys.transactions.all(),
    queryKeys.budgets.all(),
    queryKeys.cashflow.all(),
    queryKeys.reports.all(),
  ];
}

// ---------------------------------------------------------------------------
// Account type editing (P8-4) -- PATCH /accounts/{accountId}
// ---------------------------------------------------------------------------

/**
 * Optimistic projection of a PATCH body onto a cached AccountDto. The
 * effective values mirror the shared precedence for the optimistic window
 * only (an explicit isLiability wins; otherwise a type change falls to the
 * new type's metadata default). The server response -- computed through the
 * shared helpers, including any pre-existing liability override the client
 * cannot see -- is authoritative and replaces this projection on success.
 */
function applyAccountPatch(
  account: AccountDto,
  body: PatchAccountRequest,
): AccountDto {
  const accountTypeId = body.accountType ?? account.accountTypeId;
  const isLiability =
    body.isLiability ??
    (body.accountType !== undefined
      ? ACCOUNT_TYPES[body.accountType].isLiabilityDefault
      : account.isLiability);
  return { ...account, accountTypeId, isLiability };
}

interface PatchAccountContext {
  previousDetail: AccountDto | undefined;
  previousList: ListAccountsResponse | undefined;
}

/**
 * PATCH /accounts/{accountId} with an optimistic cache edit: the detail and
 * list caches flip to the projected effective values immediately, roll back
 * on ANY error (409 conflict, 400 validation, network), and converge on the
 * server's authoritative DTO on success. Summary/net-worth views recompute
 * server-side, so they are invalidated rather than projected.
 */
export function usePatchAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { accountId: string; body: PatchAccountRequest }) =>
      patchAccount(vars.accountId, vars.body),
    onMutate: async (vars): Promise<PatchAccountContext> => {
      const detailKey = queryKeys.accounts.detail(vars.accountId);
      const listKey = queryKeys.accounts.all();
      // listKey is a prefix of detailKey: one cancel covers both.
      await queryClient.cancelQueries({ queryKey: listKey });

      const previousDetail = queryClient.getQueryData<AccountDto>(detailKey);
      const previousList = queryClient.getQueryData<ListAccountsResponse>(listKey);

      if (previousDetail !== undefined) {
        queryClient.setQueryData(detailKey, applyAccountPatch(previousDetail, vars.body));
      }
      if (previousList !== undefined) {
        queryClient.setQueryData(listKey, {
          ...previousList,
          items: previousList.items.map((item) =>
            item.accountId === vars.accountId
              ? applyAccountPatch(item, vars.body)
              : item,
          ),
        });
      }
      return { previousDetail, previousList };
    },
    onError: (error, vars, context) => {
      log.warn('account PATCH failed; rolling back optimistic type edit', {
        accountId: vars.accountId,
        body: vars.body,
        error,
      });
      if (context?.previousDetail !== undefined) {
        queryClient.setQueryData(
          queryKeys.accounts.detail(vars.accountId),
          context.previousDetail,
        );
      }
      if (context?.previousList !== undefined) {
        queryClient.setQueryData(queryKeys.accounts.all(), context.previousList);
      }
      // 409/404 mean another writer won; refetch to converge on its values.
      invalidate(queryClient, [queryKeys.accounts.all(), queryKeys.summary()]);
    },
    onSuccess: (account, vars) => {
      queryClient.setQueryData(queryKeys.accounts.detail(vars.accountId), account);
      const list = queryClient.getQueryData<ListAccountsResponse>(
        queryKeys.accounts.all(),
      );
      if (list !== undefined) {
        queryClient.setQueryData(queryKeys.accounts.all(), {
          ...list,
          items: list.items.map((item) =>
            item.accountId === vars.accountId ? account : item,
          ),
        });
      }
      // A type/liability flip reclassifies net worth (P8-4).
      invalidate(queryClient, [
        queryKeys.summary(),
        queryKeys.netWorthHistory.all(),
      ]);
    },
  });
}

// ---------------------------------------------------------------------------
// Recurring (P7-1)
// ---------------------------------------------------------------------------

export function usePatchRecurring() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { seriesId: string; body: PatchRecurringRequest }) =>
      patchRecurring(vars.seriesId, vars.body),
    onSuccess: () => invalidate(queryClient, [queryKeys.recurring.all()]),
    // 404/race: the series may have been re-detected or removed; refetch.
    onError: () => invalidate(queryClient, [queryKeys.recurring.all()]),
  });
}

// ---------------------------------------------------------------------------
// Goals (P7-2)
// ---------------------------------------------------------------------------

export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGoalRequest) => createGoal(body),
    onSuccess: () => invalidate(queryClient, [queryKeys.goals.all()]),
  });
}

export function usePatchGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { goalId: string; body: PatchGoalRequest }) =>
      patchGoal(vars.goalId, vars.body),
    onSuccess: () => invalidate(queryClient, [queryKeys.goals.all()]),
    // VERSION_CONFLICT: pull the winning version so the next try uses it.
    onError: () => invalidate(queryClient, [queryKeys.goals.all()]),
  });
}

export function useDeleteGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goalId: string) => deleteGoal(goalId),
    onSuccess: () => invalidate(queryClient, [queryKeys.goals.all()]),
    onError: () => invalidate(queryClient, [queryKeys.goals.all()]),
  });
}

export function useCreateGoalContribution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      goalId: string;
      body: CreateGoalContributionRequest;
    }) => createGoalContribution(vars.goalId, vars.body),
    // The response carries the refreshed goal, but other devices' lists also
    // change; the list invalidation covers both.
    onSuccess: () => invalidate(queryClient, [queryKeys.goals.all()]),
  });
}

// ---------------------------------------------------------------------------
// Rules (P7-5)
// ---------------------------------------------------------------------------

export function useCreateRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRuleRequest) => createRule(body),
    onSuccess: () => invalidate(queryClient, [queryKeys.rules.all()]),
  });
}

export function usePatchRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { ruleId: string; body: PatchRuleRequest }) =>
      patchRule(vars.ruleId, vars.body),
    onSuccess: () => invalidate(queryClient, [queryKeys.rules.all()]),
    // VERSION_CONFLICT: pull the winning version so the next try uses it.
    onError: () => invalidate(queryClient, [queryKeys.rules.all()]),
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => deleteRule(ruleId),
    onSuccess: () => invalidate(queryClient, [queryKeys.rules.all()]),
    onError: () => invalidate(queryClient, [queryKeys.rules.all()]),
  });
}

/** Retroactive apply recategorizes transactions: spend views shift. */
export function useApplyRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { ruleId: string; body?: ApplyRuleRequest }) =>
      applyRule(vars.ruleId, vars.body ?? {}),
    onSuccess: () => invalidate(queryClient, spendViewKeys()),
  });
}

// ---------------------------------------------------------------------------
// CSV import + manual accounts (P7-6)
// ---------------------------------------------------------------------------

/**
 * Importing writes TXN# rows and moves manual-account balances: transactions,
 * accounts, summary, and every spend rollup can change. Retrying the same
 * batch is safe server-side (importId + rowHash pointers).
 */
export function useImportTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportTransactionsRequest) => importTransactions(body),
    onSuccess: () =>
      invalidate(queryClient, [
        ...spendViewKeys(),
        queryKeys.accounts.all(),
        queryKeys.summary(),
        queryKeys.netWorthHistory.all(),
      ]),
    // Partial batch failures may still have created rows; refetch to converge.
    onError: () =>
      invalidate(queryClient, [
        ...spendViewKeys(),
        queryKeys.accounts.all(),
        queryKeys.summary(),
      ]),
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAccountRequest) => createAccount(body),
    onSuccess: () =>
      invalidate(queryClient, [queryKeys.accounts.all(), queryKeys.summary()]),
  });
}

// ---------------------------------------------------------------------------
// Attachments (P7-9)
// ---------------------------------------------------------------------------

/**
 * Step 1 of the upload flow: create metadata + presigned PUT URL. The caller
 * performs the S3 PUT itself (and the item stays status 'pending' until the
 * server confirms the upload), so the attachment list is invalidated here and
 * again by the caller after the PUT settles.
 */
export function useCreateAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { txnId: string; body: CreateAttachmentRequest }) =>
      createAttachment(vars.txnId, vars.body),
    onSuccess: (_data, vars) =>
      invalidate(queryClient, [queryKeys.attachments.byTxn(vars.txnId)]),
  });
}

export function useDeleteAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { txnId: string; attachId: string }) =>
      deleteAttachment(vars.txnId, vars.attachId),
    onSuccess: (_data, vars) =>
      invalidate(queryClient, [queryKeys.attachments.byTxn(vars.txnId)]),
    onError: (_error, vars) =>
      invalidate(queryClient, [queryKeys.attachments.byTxn(vars.txnId)]),
  });
}
