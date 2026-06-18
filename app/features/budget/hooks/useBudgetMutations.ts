/**
 * Write hooks for the budgeting feature: budget CRUD, category CRUD, and
 * single-transaction recategorization. Every mutation invalidates exactly the
 * caches its server-side write can change.
 */
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CreateBudgetRequest,
  CreateCategoryRequest,
  IsoDate,
  PatchBudgetRequest,
  PatchCategoryRequest,
} from '@goldfinch/shared/types';

import {
  archiveCategory,
  createBudget,
  createCategory,
  deleteBudget,
  patchBudget,
  patchCategory,
  patchTransactionCategory,
} from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';

/**
 * Prefix shared by every cashflow range key. Derived from the factory (not a
 * re-typed literal) so it cannot drift from queryKeys.cashflow.range output.
 */
const CASHFLOW_PREFIX = queryKeys.cashflow.range('', '').slice(0, 2);

function invalidateBudgets(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all() });
}

function invalidateCategories(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.categories.all() });
}

function invalidateSpendViews(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all() });
  void queryClient.invalidateQueries({ queryKey: CASHFLOW_PREFIX });
  invalidateBudgets(queryClient);
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export function useCreateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBudgetRequest) => createBudget(body),
    onSuccess: () => invalidateBudgets(queryClient),
    // ALREADY_EXISTS means another device created it; refetch to show it.
    onError: () => invalidateBudgets(queryClient),
  });
}

export function usePatchBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { categoryId: string; body: PatchBudgetRequest }) =>
      patchBudget(vars.categoryId, vars.body),
    onSuccess: () => invalidateBudgets(queryClient),
    // VERSION_CONFLICT: pull the winning version so the next try uses it.
    onError: () => invalidateBudgets(queryClient),
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => deleteBudget(categoryId),
    onSuccess: () => invalidateBudgets(queryClient),
    onError: () => invalidateBudgets(queryClient),
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategoryRequest) => createCategory(body),
    onSuccess: () => invalidateCategories(queryClient),
  });
}

export function usePatchCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { categoryId: string; body: PatchCategoryRequest }) =>
      patchCategory(vars.categoryId, vars.body),
    onSuccess: () => {
      invalidateCategories(queryClient);
      // categoryName is denormalized onto budgets; renames must refresh both.
      invalidateBudgets(queryClient);
    },
  });
}

/** Soft archive (DELETE /categories/{id}); restore via usePatchCategory. */
export function useArchiveCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => archiveCategory(categoryId),
    onSuccess: () => {
      invalidateCategories(queryClient);
      invalidateBudgets(queryClient);
    },
  });
}

// ---------------------------------------------------------------------------
// Recategorize
// ---------------------------------------------------------------------------

export interface RecategorizeVars {
  txnId: string;
  /** The transaction's current date -- required so the API can build the SK. */
  date: IsoDate;
  categoryId: string;
  note?: string;
}

export function useRecategorizeTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ txnId, date, categoryId, note }: RecategorizeVars) =>
      patchTransactionCategory(
        txnId,
        note === undefined ? { date, categoryId } : { date, categoryId, note },
      ),
    // Moving a transaction between categories shifts spend everywhere:
    // transaction lists, budget actuals, and cash-flow rollups.
    onSuccess: () => invalidateSpendViews(queryClient),
  });
}
