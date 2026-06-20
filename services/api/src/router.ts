/**
 * routeKey -> handler map (master plan section 8 decision 2: hand-rolled
 * dispatch on event.routeKey, no framework). Every key in the shared
 * API_ROUTES manifest MUST have a handler here — the gateway route table is
 * derived from that manifest, so an unmapped key would deploy as a live route
 * that can only 404 (router-parity test enforces full coverage).
 *
 * Aliases beyond @goldfinch/shared API_ROUTES:
 * - GET /networth is the infra-registered name for the summary endpoint
 *   (NetWorthResponse is a type alias of SummaryResponse).
 * - PUT /budgets/{categoryId} shares the optimistic-lock update with PATCH.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { API_ROUTES } from '@goldfinch/shared/constants';
import {
  createAccount,
  getAccount,
  listAccounts,
  patchAccount,
} from './routes/accounts.js';
import {
  createAttachment,
  deleteAttachment,
  getAttachmentDownload,
  listAttachments,
} from './routes/attachments.js';
import {
  createBudget,
  deleteBudget,
  listBudgets,
  updateBudget,
} from './routes/budgets.js';
import { getCashflow } from './routes/cashflow.js';
import {
  archiveCategory,
  createCategory,
  listCategories,
  patchCategory,
} from './routes/categories.js';
import { deletePushToken, registerPushToken } from './routes/devices.js';
import {
  createGoal,
  createGoalContribution,
  deleteGoal,
  listGoals,
  patchGoal,
} from './routes/goals.js';
import { health } from './routes/health.js';
import {
  holdingPriceHistory,
  listAccountHoldings,
  setHoldingCostBasis,
} from './routes/holdings.js';
import { importTransactions } from './routes/import.js';
import { netWorthHistory } from './routes/networth.js';
import { getProfile, patchProfile } from './routes/profile.js';
import { listRecurring, patchRecurring } from './routes/recurring.js';
import { reportsFlow, reportsTrends } from './routes/reports.js';
import {
  applyRule,
  createRule,
  deleteRule,
  listRules,
  patchRule,
} from './routes/rules.js';
import { getSummary } from './routes/summary.js';
import { getSyncStatus, runSync } from './routes/sync.js';
import {
  listAccountTransactions,
  listTransactions,
  patchTransaction,
} from './routes/transactions.js';

export type RouteHandler = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
) => Promise<APIGatewayProxyStructuredResultV2>;

export const routes: Readonly<Record<string, RouteHandler>> = {
  [API_ROUTES.health]: health,
  [API_ROUTES.listAccounts]: listAccounts,
  [API_ROUTES.getAccount]: getAccount,
  [API_ROUTES.listAccountTransactions]: listAccountTransactions,
  [API_ROUTES.summary]: getSummary,
  'GET /networth': getSummary,
  [API_ROUTES.listTransactions]: listTransactions,
  [API_ROUTES.patchTransaction]: patchTransaction,
  [API_ROUTES.listBudgets]: listBudgets,
  [API_ROUTES.createBudget]: createBudget,
  [API_ROUTES.patchBudget]: updateBudget,
  'PUT /budgets/{categoryId}': updateBudget,
  [API_ROUTES.deleteBudget]: deleteBudget,
  [API_ROUTES.listCategories]: listCategories,
  [API_ROUTES.createCategory]: createCategory,
  [API_ROUTES.patchCategory]: patchCategory,
  [API_ROUTES.deleteCategory]: archiveCategory,
  [API_ROUTES.cashflow]: getCashflow,
  // --- Phase 7 (PHASE7-DECISIONS.md P7-1..P7-9) ---
  [API_ROUTES.listRecurring]: listRecurring,
  [API_ROUTES.patchRecurring]: patchRecurring,
  [API_ROUTES.listGoals]: listGoals,
  [API_ROUTES.createGoal]: createGoal,
  [API_ROUTES.patchGoal]: patchGoal,
  [API_ROUTES.deleteGoal]: deleteGoal,
  [API_ROUTES.createGoalContribution]: createGoalContribution,
  [API_ROUTES.listAccountHoldings]: listAccountHoldings,
  [API_ROUTES.setHoldingCostBasis]: setHoldingCostBasis,
  [API_ROUTES.holdingPriceHistory]: holdingPriceHistory,
  [API_ROUTES.netWorthHistory]: netWorthHistory,
  [API_ROUTES.reportsTrends]: reportsTrends,
  [API_ROUTES.reportsFlow]: reportsFlow,
  [API_ROUTES.listRules]: listRules,
  [API_ROUTES.createRule]: createRule,
  [API_ROUTES.patchRule]: patchRule,
  [API_ROUTES.deleteRule]: deleteRule,
  [API_ROUTES.applyRule]: applyRule,
  [API_ROUTES.importTransactions]: importTransactions,
  [API_ROUTES.createAccount]: createAccount,
  [API_ROUTES.registerPushToken]: registerPushToken,
  [API_ROUTES.deletePushToken]: deletePushToken,
  [API_ROUTES.createAttachment]: createAttachment,
  [API_ROUTES.listAttachments]: listAttachments,
  [API_ROUTES.getAttachmentDownload]: getAttachmentDownload,
  [API_ROUTES.deleteAttachment]: deleteAttachment,
  // --- User profile (display name; per-sub PROFILE#<sub> items) ---
  [API_ROUTES.getProfile]: getProfile,
  [API_ROUTES.patchProfile]: patchProfile,
  // --- Phase 8 (ops/PHASE8-DECISIONS.md) ---
  // P8-4 account type editing (USER-OWNED typeOverride/isLiabilityOverride).
  [API_ROUTES.patchAccount]: patchAccount,
  // On-demand "Sync now": status read + debounced async invoke of the sync Lambda.
  [API_ROUTES.syncStatus]: getSyncStatus,
  [API_ROUTES.syncRun]: runSync,
};
