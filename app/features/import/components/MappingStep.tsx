/**
 * Step 3: interactive column mapping with a live preview of normalized rows
 * (P7-6). Everything shown here is produced by the shared CSV module, so the
 * preview is exactly what the server will receive and hash. This step is
 * also the guard for month-first slash dates (shared contract: slash dates
 * are ALWAYS parsed US-style) -- the preview makes a dd/mm source visible
 * before anything imports.
 */
import { Switch, StyleSheet, Text, View } from 'react-native';
import { Info, TriangleAlert } from 'lucide-react-native';
import type { AccountDto } from '@goldfinch/shared/types';

import { CurrencyAmount } from '../../../src/ui/CurrencyAmount';
import { formatTxnDate } from '../../../src/lib/dates';
import { useTheme } from '../../../src/ui/ThemeProvider';
import type { ColumnMapping, MappingField, PreparedImport } from '../lib/mapping';
import type { ImportPlan } from '../lib/importPlan';
import type { ParsedCsv } from '../lib/parseCsv';
import { Button } from './Buttons';
import { ColumnPickerField } from './ColumnPickerField';

const PREVIEW_ROW_COUNT = 5;
const PREVIEW_FAILURE_COUNT = 3;

const FIELD_LABELS: ReadonlyArray<readonly [MappingField, string, boolean]> = [
  ['date', 'Date', true],
  ['amount', 'Amount', true],
  ['payee', 'Payee', true],
  ['category', 'Category', false],
  ['note', 'Note', false],
];

export interface MappingStepProps {
  fileName: string;
  parsed: ParsedCsv;
  account: AccountDto;
  hasHeader: boolean;
  onToggleHeader: (value: boolean) => void;
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  /** Normalization result for the full file; null while mapping incomplete. */
  prepared: PreparedImport | null;
  /** Batch plan over prepared rows; null while mapping incomplete. */
  plan: ImportPlan | null;
  /** Category lookups still loading (matters when a category column is mapped). */
  categoriesPending: boolean;
  categoryNameById: ReadonlyMap<string, string>;
  onImport: () => void;
  onBack: () => void;
}

export function MappingStep({
  fileName,
  parsed,
  account,
  hasHeader,
  onToggleHeader,
  mapping,
  onMappingChange,
  prepared,
  plan,
  categoriesPending,
  categoryNameById,
  onImport,
  onBack,
}: MappingStepProps) {
  const theme = useTheme();

  const headerRow = hasHeader ? (parsed.rows[0] ?? null) : null;
  const firstDataRow = parsed.rows[hasHeader ? 1 : 0] ?? null;
  const dataRowCount = Math.max(parsed.rows.length - (hasHeader ? 1 : 0), 0);
  const waitingOnCategories = categoriesPending && mapping.category !== null;
  const importableCount = plan?.plannedRowCount ?? 0;
  const failureCount =
    (prepared?.failures.length ?? 0) + (plan?.oversizeFailures.length ?? 0);

  const caption = {
    color: theme.colors.textSecondary,
    fontSize: theme.text.caption,
  } as const;

  return (
    <View>
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: theme.text.heading,
          fontWeight: '700',
          marginBottom: theme.spacing.xs,
        }}
      >
        Map the columns
      </Text>
      <Text style={[caption, { marginBottom: theme.spacing.md }]}>
        {fileName}: {dataRowCount} data rows
        {parsed.delimiter !== null ? `, "${parsed.delimiter}" delimited` : ''}.
        Importing into {account.name} ({account.currency}).
      </Text>

      {parsed.fileIssues.map((issue) => (
        <NoticeRow key={issue} kind="warning" text={`CSV warning: ${issue}`} />
      ))}

      <View
        style={[
          styles.toggleRow,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
            marginBottom: theme.spacing.md,
            padding: theme.spacing.md,
          },
        ]}
      >
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            flex: 1,
          }}
        >
          First row is column headers
        </Text>
        <Switch
          value={hasHeader}
          onValueChange={onToggleHeader}
          trackColor={{ true: theme.colors.accent, false: theme.colors.surfaceAlt }}
          accessibilityLabel="First row is column headers"
        />
      </View>

      {FIELD_LABELS.map(([field, label, required]) => (
        <ColumnPickerField
          key={field}
          label={label}
          required={required}
          columnCount={parsed.columnCount}
          headerRow={headerRow}
          sampleRow={firstDataRow}
          selectedIndex={mapping[field]}
          onSelect={(index) => onMappingChange({ ...mapping, [field]: index })}
        />
      ))}

      <NoticeRow
        kind="info"
        text="Slash dates are read month-first (US): 03/04/2026 means March 4. Check the preview if your bank exports day-first dates."
      />

      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: theme.text.body,
          fontWeight: '700',
          marginTop: theme.spacing.md,
          marginBottom: theme.spacing.sm,
        }}
      >
        Preview
      </Text>

      {prepared === null ? (
        <Text style={[caption, { marginBottom: theme.spacing.md }]}>
          Map the date, amount, and payee columns to preview rows.
        </Text>
      ) : (
        <View style={{ marginBottom: theme.spacing.md }}>
          {prepared.rows.slice(0, PREVIEW_ROW_COUNT).map(({ line, row }) => (
            <View
              key={line}
              style={[
                styles.previewRow,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderRadius: theme.radius.md,
                  marginBottom: theme.spacing.xs,
                  padding: theme.spacing.md,
                },
              ]}
            >
              <View style={styles.previewText}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.colors.textPrimary,
                    fontSize: theme.text.body,
                    fontWeight: '600',
                  }}
                >
                  {row.payee}
                </Text>
                <Text numberOfLines={1} style={[caption, { marginTop: 2 }]}>
                  Line {line} | {formatTxnDate(row.date)}
                  {row.categoryId !== null && row.categoryId !== undefined
                    ? ` | ${categoryNameById.get(row.categoryId) ?? row.categoryId}`
                    : ' | uncategorized'}
                  {row.note !== undefined ? ` | ${row.note}` : ''}
                </Text>
              </View>
              <CurrencyAmount
                amountMinor={row.amountMinor}
                currency={account.currency}
                colorBySign
                size="sm"
              />
            </View>
          ))}
          {prepared.rows.length === 0 ? (
            <NoticeRow
              kind="warning"
              text="No rows parse with this mapping. Check the column choices and the header toggle."
            />
          ) : null}

          {failureCount > 0 ? (
            <NoticeRow
              kind="warning"
              text={`${failureCount} of ${dataRowCount} rows cannot import with this mapping. They will be skipped and listed in the final report -- first ${Math.min(PREVIEW_FAILURE_COUNT, failureCount)} shown here.`}
            />
          ) : null}
          {(prepared.failures.slice(0, PREVIEW_FAILURE_COUNT)).map((failure) => (
            <Text
              key={failure.line}
              style={[caption, { color: theme.colors.danger, marginBottom: 2 }]}
            >
              Line {failure.line}: {failure.reason}
            </Text>
          ))}

          {prepared.duplicateRowCount > 0 ? (
            <NoticeRow
              kind="info"
              text={`${prepared.duplicateRowCount} rows are exact repeats within this file (same date, amount, payee). Each one is imported as its own transaction.`}
            />
          ) : null}

          {mapping.category !== null ? (
            <NoticeRow
              kind="info"
              text={
                waitingOnCategories
                  ? 'Loading your categories to match this column...'
                  : prepared.unmatchedCategoryValues.length > 0
                    ? `Unmatched category values import as uncategorized: ${prepared.unmatchedCategoryValues.join(', ')}`
                    : prepared.matchedCategoryValues.length > 0
                      ? `All category values matched: ${prepared.matchedCategoryValues.join(', ')}`
                      : 'The category column is empty; rows import as uncategorized.'
              }
            />
          ) : null}
        </View>
      )}

      <NoticeRow
        kind="info"
        text="Re-import safe: importing this exact file into this account again only adds rows that were not imported before -- retrying after an error never creates duplicates."
      />

      <View style={{ height: theme.spacing.sm }} />
      <Button
        label={
          importableCount > 0
            ? `Import ${importableCount} ${importableCount === 1 ? 'transaction' : 'transactions'}`
            : 'Import'
        }
        onPress={onImport}
        disabled={importableCount === 0 || waitingOnCategories}
      />
      <View style={{ height: theme.spacing.sm }} />
      <Button label="Back" variant="secondary" onPress={onBack} />
    </View>
  );
}

function NoticeRow({ kind, text }: { kind: 'info' | 'warning'; text: string }) {
  const theme = useTheme();
  const color = kind === 'warning' ? theme.colors.warning : theme.colors.textSecondary;
  const Icon = kind === 'warning' ? TriangleAlert : Info;
  return (
    <View style={[styles.notice, { marginBottom: theme.spacing.sm }]}>
      <Icon size={14} color={color} style={{ marginTop: 2 }} />
      <Text
        style={{
          color,
          fontSize: theme.text.caption,
          flex: 1,
          marginLeft: theme.spacing.xs,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row' },
  previewRow: { alignItems: 'center', borderWidth: 1, flexDirection: 'row' },
  previewText: { flex: 1, marginRight: 8 },
  toggleRow: { alignItems: 'center', borderWidth: 1, flexDirection: 'row' },
});
