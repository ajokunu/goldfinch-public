/**
 * GET /accounts, GET /accounts/{accountId}, POST /accounts (P7-6), and
 * PATCH /accounts/{accountId} (P8-4 account type editing).
 *
 * POST creates a MANUAL account (source 'manual') so CSV imports can target
 * accounts SimpleFIN does not cover. simplefinAccountId stays required on the
 * item for compile compatibility with pre-Phase-7 consumers; manual writers
 * set the synthetic `manual:<accountId>`, which can never collide with a
 * bridge id, so sync's account matching is unaffected.
 *
 * PATCH sets ONLY the USER-OWNED override fields (typeOverride /
 * isLiabilityOverride — sync never writes them) and returns the account with
 * its EFFECTIVE values (shared effectiveAccountType()/effectiveIsLiability()).
 * A liability flip is allowed and immediately changes the account's net-worth
 * classification in GET /summary and the next net-worth snapshot, because all
 * of them classify through the same shared helpers.
 */

import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  ACCOUNT_TYPE_IDS,
  isAccountTypeId,
} from '@goldfinch/shared/accountTypes';
import type { AccountTypeId } from '@goldfinch/shared/accountTypes';
import { SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { KEY_PREFIX, acctSk, userPk } from '@goldfinch/shared/keys';
import { parseCurrencyAmount } from '@goldfinch/shared/money';
import type {
  AccountItem,
  AccountType,
  CreateAccountResponse,
  GetAccountResponse,
  ListAccountsResponse,
  PatchAccountResponse,
} from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { ddb, isConditionalCheckFailure, queryAll } from '../ddb.js';
import { nowIso } from '../dates.js';
import { getEnv } from '../env.js';
import { ApiError, json, parseJsonBody, requirePathParam } from '../http.js';
import { logger } from '../logger.js';
import { toAccountDto } from '../mapping.js';
import {
  optBool,
  optOverrideText,
  optString,
  optText,
  reqString,
  reqText,
} from '../validate.js';

const ACCOUNT_TYPES: readonly AccountType[] = [
  'checking',
  'savings',
  'credit',
  'investment',
  'loan',
  'other',
];

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export async function listHouseholdAccounts(
  household: string,
  tableName: string,
): Promise<AccountItem[]> {
  return queryAll<AccountItem>({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': userPk(household),
      ':prefix': KEY_PREFIX.account,
    },
  });
}

export async function listAccounts(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const accounts = await listHouseholdAccounts(household, env.tableName);
  const body: ListAccountsResponse = { items: accounts.map(toAccountDto) };
  return json(200, body);
}

export async function getAccount(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const accountId = requirePathParam(event, 'accountId');
  const res = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: acctSk(accountId) },
    }),
  );
  const item = res.Item as AccountItem | undefined;
  if (item === undefined) {
    throw new ApiError(404, 'NOT_FOUND', `account "${accountId}" not found`);
  }
  const body: GetAccountResponse = toAccountDto(item);
  return json(200, body);
}

/** POST /accounts — 201 with the created manual account. */
export async function createAccount(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const body = parseJsonBody(event);

  const name = reqText(body, 'name', 'accountName', { trim: false });
  const rawType = reqString(body, 'accountType');
  if (!ACCOUNT_TYPES.includes(rawType as AccountType)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `accountType must be one of: ${ACCOUNT_TYPES.join(', ')}`,
    );
  }
  const accountType = rawType as AccountType;
  const currency = reqString(body, 'currency');
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'currency must be a 3-letter ISO-4217 code (e.g. USD)',
    );
  }
  const institution =
    optText(body, 'institution', 'accountInstitution', { trim: false }) ?? 'Manual';
  const openingBalance = optString(body, 'openingBalance') ?? '0';
  // Throws MoneyError (-> 400) on anything that is not an exact decimal.
  const balanceMinor = parseCurrencyAmount(openingBalance, currency);

  const accountId = randomUUID();
  const now = nowIso();
  const item: AccountItem = {
    PK: userPk(household),
    SK: acctSk(accountId),
    entityType: 'ACCOUNT',
    schemaVersion: SCHEMA_VERSION,
    name,
    accountType,
    institution,
    balanceMinor,
    currency,
    balanceDate: Math.floor(Date.now() / 1000),
    // Synthetic stable id (P7-6): manual accounts have no bridge id.
    simplefinAccountId: `manual:${accountId}`,
    lastSyncedAt: now,
    source: 'manual',
    // Manual accounts are never synced, so holdings can never appear.
    holdingsSupported: false,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: env.tableName,
        Item: { ...item },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(409, 'ALREADY_EXISTS', `account "${accountId}" already exists`);
    }
    throw err;
  }

  const responseBody: CreateAccountResponse = toAccountDto(item);
  return json(201, responseBody);
}

/**
 * Optimistic-concurrency counter on the stored account item. It is not part
 * of the shared AccountItem contract (sync may rewrite synced accounts and
 * drop it; absence is always legal — the first PATCH conditions on absence
 * and sets 1, exactly like PATCH /profile). It exists purely so concurrent
 * PATCH /accounts writes surface as 409 VERSION_CONFLICT, never a silent
 * lost update.
 */
type VersionedAccountItem = AccountItem & { version?: number };

/**
 * PATCH /accounts/{accountId} (P8-4) — 200 with the account's post-write
 * EFFECTIVE values.
 *
 * - Identity (the household partition) comes ONLY from the JWT claims.
 * - `accountType` is validated with the shared isAccountTypeId() guard (never
 *   a hand-rolled list) and lands as the USER-OWNED typeOverride;
 *   `isLiability` must be a boolean and lands as isLiabilityOverride.
 *   `nameOverride`/`institutionOverride` are USER-OWNED custom labels: a
 *   non-empty trimmed string SETs them (length-capped via MAX_TEXT_LENGTHS,
 *   400 otherwise), and `null`/""/whitespace REMOVEs them so the effective
 *   value falls back to the synced one (shared effectiveAccountName()/
 *   effectiveInstitution()). At least one field is required (400 otherwise).
 * - 404 NOT_FOUND when the account does not exist; the write itself also
 *   conditions on attribute_exists so a delete racing the read still 404s.
 * - Version-conditional: the write requires the stored version to be
 *   unchanged since it was read (or still absent for never-patched items), so
 *   a concurrent edit is a 409 VERSION_CONFLICT, never a lost update.
 * - A liability flip immediately reclassifies the account's net-worth
 *   contribution (summary + snapshots share the effective helpers).
 */
export async function patchAccount(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const accountId = requirePathParam(event, 'accountId');
  const body = parseJsonBody(event);

  let typeOverride: AccountTypeId | undefined;
  const rawType = body['accountType'];
  if (rawType !== undefined && rawType !== null) {
    if (!isAccountTypeId(rawType)) {
      logger.warn('patchAccount rejected invalid accountType', {
        accountId,
        accountType: rawType,
      });
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `accountType must be one of: ${ACCOUNT_TYPE_IDS.join(', ')}`,
      );
    }
    typeOverride = rawType;
  }
  const isLiabilityOverride = optBool(body, 'isLiability');
  // undefined == absent (leave unchanged); null == clear (REMOVE the
  // attribute); a string == set. Trimmed + length-capped from the shared
  // MAX_TEXT_LENGTHS contract so client and server can never disagree.
  const nameOverride = optOverrideText(body, 'nameOverride', 'accountName');
  const institutionOverride = optOverrideText(
    body,
    'institutionOverride',
    'accountInstitution',
  );
  if (
    typeOverride === undefined &&
    isLiabilityOverride === undefined &&
    nameOverride === undefined &&
    institutionOverride === undefined
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'at least one of accountType, isLiability, nameOverride, or institutionOverride is required',
    );
  }

  const pk = userPk(household);
  const sk = acctSk(accountId);
  const res = await ddb.send(
    new GetCommand({ TableName: env.tableName, Key: { PK: pk, SK: sk } }),
  );
  const current = res.Item as VersionedAccountItem | undefined;
  if (current === undefined) {
    logger.warn('patchAccount target account not found', { accountId });
    throw new ApiError(404, 'NOT_FOUND', `account "${accountId}" not found`);
  }

  const names: Record<string, string> = {
    '#updatedAt': 'updatedAt',
    '#version': 'version',
  };
  const values: Record<string, unknown> = {
    ':updatedAt': nowIso(),
    ':nextVersion': (current.version ?? 0) + 1,
  };
  const sets = ['#updatedAt = :updatedAt', '#version = :nextVersion'];
  // A cleared (null) name/institution override REMOVEs the attribute so the
  // effective value falls back to the synced one — never stores an empty string.
  const removes: string[] = [];
  if (typeOverride !== undefined) {
    names['#typeOverride'] = 'typeOverride';
    values[':typeOverride'] = typeOverride;
    sets.push('#typeOverride = :typeOverride');
  }
  if (isLiabilityOverride !== undefined) {
    names['#isLiabilityOverride'] = 'isLiabilityOverride';
    values[':isLiabilityOverride'] = isLiabilityOverride;
    sets.push('#isLiabilityOverride = :isLiabilityOverride');
  }
  if (nameOverride !== undefined) {
    names['#nameOverride'] = 'nameOverride';
    if (nameOverride === null) {
      removes.push('#nameOverride');
    } else {
      values[':nameOverride'] = nameOverride;
      sets.push('#nameOverride = :nameOverride');
    }
  }
  if (institutionOverride !== undefined) {
    names['#institutionOverride'] = 'institutionOverride';
    if (institutionOverride === null) {
      removes.push('#institutionOverride');
    } else {
      values[':institutionOverride'] = institutionOverride;
      sets.push('#institutionOverride = :institutionOverride');
    }
  }
  let versionCondition = 'attribute_not_exists(#version)';
  if (current.version !== undefined) {
    versionCondition = '#version = :version';
    values[':version'] = current.version;
  }

  // `sets` always has the updatedAt/version bumps, so SET is unconditional;
  // REMOVE is appended only when an override was cleared (empty clause is illegal).
  let updateExpression = `SET ${sets.join(', ')}`;
  if (removes.length > 0) {
    updateExpression += ` REMOVE ${removes.join(', ')}`;
  }

  try {
    const updated = await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { PK: pk, SK: sk },
        UpdateExpression: updateExpression,
        ConditionExpression: `attribute_exists(SK) AND ${versionCondition}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
    const responseBody: PatchAccountResponse = toAccountDto(
      updated.Attributes as AccountItem,
    );
    return json(200, responseBody);
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      // ALL_OLD present == the item exists but the version moved (409);
      // absent == the account vanished between the read and the write (404).
      if (err.Item !== undefined) {
        logger.warn('patchAccount lost a concurrent-write race', { accountId });
        throw new ApiError(
          409,
          'VERSION_CONFLICT',
          'account was modified concurrently; refresh and retry',
        );
      }
      logger.warn('patchAccount target account deleted mid-write', { accountId });
      throw new ApiError(404, 'NOT_FOUND', `account "${accountId}" not found`);
    }
    throw err;
  }
}
