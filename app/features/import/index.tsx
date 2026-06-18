/**
 * CSV import wizard (P7-6): file pick -> target account (with inline manual
 * account creation) -> interactive column mapping with normalized preview ->
 * batched POST /import/transactions with progress -> per-row final report.
 *
 * All normalization and hashing identity comes from @goldfinch/shared/csv
 * (the contract the server re-runs); the deterministic importId in
 * lib/importPlan.ts makes re-imports and retries idempotent. Every parsed
 * data row is accounted for in the final report -- imported, duplicate, or
 * failed with a line + reason -- never silently dropped.
 */
import { useCallback, useMemo, useState } from 'react';

import { Screen } from '../../src/ui/Screen';
import type { AccountDto } from '@goldfinch/shared/types';

import { useImportRunner } from './hooks/useImportRunner';
import { useCategoriesQuery, useCategoryIndex, useCategoryNames } from './hooks/useImportQueries';
import {
  EMPTY_MAPPING,
  guessMapping,
  isMappingComplete,
  prepareRows,
  type ColumnMapping,
  type PreparedImport,
  type RowFailure,
} from './lib/mapping';
import { deriveImportId, planBatches, type ImportPlan } from './lib/importPlan';
import { guessHasHeader } from './lib/parseCsv';
import { AccountStep } from './components/AccountStep';
import { FileStep, type PickedCsv } from './components/FileStep';
import { MappingStep } from './components/MappingStep';
import { RunStep } from './components/RunStep';
import { WizardSteps } from './components/WizardSteps';

type WizardStep = 'file' | 'account' | 'mapping' | 'run';

const STEP_LABELS = ['File', 'Account', 'Columns', 'Import'] as const;
const STEP_INDEX: Record<WizardStep, number> = {
  file: 0,
  account: 1,
  mapping: 2,
  run: 3,
};

export default function ImportScreen() {
  const [step, setStep] = useState<WizardStep>('file');
  const [picked, setPicked] = useState<PickedCsv | null>(null);
  const [hasHeader, setHasHeader] = useState(false);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [account, setAccount] = useState<AccountDto | null>(null);

  const categoriesQuery = useCategoriesQuery();
  const categoryIndex = useCategoryIndex();
  const categoryNameById = useCategoryNames();
  const runner = useImportRunner();

  // Derived pipeline: raw matrix -> normalized rows (shared CSV module) ->
  // batch plan. Pure functions of the wizard state, so changing the account,
  // header toggle, or mapping recomputes the preview instantly.
  const prepared: PreparedImport | null = useMemo(() => {
    if (picked === null || account === null || !isMappingComplete(mapping)) {
      return null;
    }
    return prepareRows({
      allRows: picked.parsed.rows,
      hasHeader,
      mapping,
      currency: account.currency,
      categoryIndex,
      parseIssues: picked.parsed.rowIssues,
    });
  }, [picked, account, mapping, hasHeader, categoryIndex]);

  const plan: ImportPlan | null = useMemo(
    () => (prepared === null ? null : planBatches(prepared.rows)),
    [prepared],
  );

  const importId: string | null = useMemo(
    () =>
      picked === null || account === null
        ? null
        : deriveImportId(account.accountId, picked.fileText),
    [picked, account],
  );

  /** Rows that never reach the server, included in the final report. */
  const preFailures: RowFailure[] = useMemo(
    () => [...(prepared?.failures ?? []), ...(plan?.oversizeFailures ?? [])],
    [prepared, plan],
  );

  const handleParsed = useCallback((next: PickedCsv) => {
    const headerGuess = guessHasHeader(next.parsed.rows);
    setPicked(next);
    setHasHeader(headerGuess);
    setMapping(
      guessMapping(
        headerGuess ? (next.parsed.rows[0] ?? null) : null,
        next.parsed.columnCount,
      ),
    );
    setStep('account');
  }, []);

  const startImport = useCallback(() => {
    if (plan === null || importId === null || account === null) return;
    if (plan.batches.length === 0) return;
    setStep('run');
    void runner.run({
      importId,
      accountId: account.accountId,
      batches: plan.batches,
    });
  }, [plan, importId, account, runner]);

  const startOver = useCallback(() => {
    runner.reset();
    setPicked(null);
    setHasHeader(false);
    setMapping(EMPTY_MAPPING);
    setAccount(null);
    setStep('file');
  }, [runner]);

  return (
    <Screen scroll>
      <WizardSteps labels={STEP_LABELS} activeIndex={STEP_INDEX[step]} />

      {step === 'file' ? <FileStep onParsed={handleParsed} /> : null}

      {step === 'account' ? (
        <AccountStep
          selectedAccountId={account?.accountId ?? null}
          onSelect={setAccount}
          onContinue={() => setStep('mapping')}
          onBack={() => setStep('file')}
        />
      ) : null}

      {step === 'mapping' && picked !== null && account !== null ? (
        <MappingStep
          fileName={picked.fileName}
          parsed={picked.parsed}
          account={account}
          hasHeader={hasHeader}
          onToggleHeader={setHasHeader}
          mapping={mapping}
          onMappingChange={setMapping}
          prepared={prepared}
          plan={plan}
          categoriesPending={categoriesQuery.isPending}
          categoryNameById={categoryNameById}
          onImport={startImport}
          onBack={() => setStep('account')}
        />
      ) : null}

      {step === 'run' && account !== null && picked !== null ? (
        <RunStep
          state={runner.state}
          account={account}
          fileName={picked.fileName}
          preFailures={preFailures}
          onRetry={startImport}
          onStartOver={startOver}
        />
      ) : null}
    </Screen>
  );
}
