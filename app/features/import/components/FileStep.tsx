/**
 * Step 1: pick a CSV file via the shell FilePicker and parse it locally
 * (papaparse). Cancel keeps the user here; read/parse failures render an
 * inline error (logged), never a silent blank.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FileSpreadsheet } from 'lucide-react-native';

import { FilePickerError, pickFile } from '../../../src/lib/filePicker';
import { logger } from '../../../src/lib/logger';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { CsvParseError, parseCsvText, type ParsedCsv } from '../lib/parseCsv';
import { Button } from './Buttons';

/** Banks export CSV under several MIME types; text/plain covers Android. */
const CSV_MIME_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'text/plain',
] as const;

export interface PickedCsv {
  fileName: string;
  /** Raw file text -- the deterministic importId derives from it. */
  fileText: string;
  parsed: ParsedCsv;
}

export interface FileStepProps {
  onParsed: (picked: PickedCsv) => void;
}

export function FileStep({ onParsed }: FileStepProps) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const file = await pickFile({ mimeTypes: CSV_MIME_TYPES });
      if (file === null) return; // user cancel -- not an error
      const fileText = await file.text();
      const parsed = parseCsvText(fileText);
      onParsed({ fileName: file.name, fileText, parsed });
    } catch (caught) {
      if (caught instanceof FilePickerError || caught instanceof CsvParseError) {
        // Already logged at the source with full context.
        setError(caught.message);
      } else {
        logger.error('reading or parsing the picked CSV failed', { error: caught });
        setError(
          caught instanceof Error && caught.message
            ? caught.message
            : 'Reading the file failed.',
        );
      }
    } finally {
      setBusy(false);
    }
  }, [onParsed]);

  return (
    <View style={styles.center}>
      <FileSpreadsheet size={40} color={theme.colors.accent} />
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: theme.text.heading,
          fontWeight: '700',
          marginTop: theme.spacing.md,
          textAlign: 'center',
        }}
      >
        Import transactions from CSV
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.body,
          marginTop: theme.spacing.sm,
          marginBottom: theme.spacing.lg,
          textAlign: 'center',
        }}
      >
        Pick a CSV export from your bank. The file is parsed on this device;
        you will map its columns and choose a target account before anything
        is imported.
      </Text>
      <Button
        label={busy ? 'Opening picker' : 'Choose CSV file'}
        onPress={() => void choose()}
        loading={busy}
      />
      {error !== null ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: theme.text.body,
            marginTop: theme.spacing.md,
            textAlign: 'center',
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 32 },
});
