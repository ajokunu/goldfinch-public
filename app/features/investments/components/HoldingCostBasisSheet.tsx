/**
 * Manual cost-basis entry sheet (Investments enrichment, Part A): a numeric
 * variant of AccountTextEditSheet. A single FormField carries the TOTAL amount
 * the user paid for the position (decimal-pad keyboard, no autocapitalize /
 * autocorrect on a numeric field); the parent's useSetHoldingCostBasis runs the
 * optimistic POST and surfaces the inline error.
 *
 * Empty/whitespace input CLEARS the basis (the parent sends amount:null), so the
 * row falls back to the feed value or the em-dash -- never a misleading $0. The
 * draft pattern (draft ?? prefill) tracks the prefill until the user types, and
 * every close path drops the draft so the next open starts from the saved value.
 */
import { useCallback, useState } from 'react';

import { Button } from '../../../src/ui/Button';
import { FormField } from '../../../src/ui/FormField';
import { ModalSheet } from '../../../src/ui/ModalSheet';

export interface HoldingCostBasisSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Sheet title + field label (e.g. the symbol or "Cost basis"). */
  title: string;
  /** The current manual basis as a decimal string (edit prefill); empty when none. */
  prefill: string;
  /** Muted helper under the input (e.g. the clear-to-revert / total-cost note). */
  hint: string;
  /** Whether the parent's POST is in flight (drives the Save spinner). */
  saving: boolean;
  /** Inline error to surface (the parent's rollback note); null hides it. */
  error: string | null;
  /**
   * Save the raw draft. The parent maps empty/whitespace to a clearing null and
   * a non-empty draft to the typed decimal string, then POSTs optimistically and
   * closes on success. Editing as draft (not committing here) keeps the sheet
   * open for correction when the parent surfaces a failure.
   */
  onSave: (draft: string) => void;
  testID?: string;
}

export function HoldingCostBasisSheet({
  visible,
  onClose,
  title,
  prefill,
  hint,
  saving,
  error,
  onSave,
  testID,
}: HoldingCostBasisSheetProps) {
  // Tracks the prefill until the user types (the same draft pattern as the
  // account label/greeting fields).
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? prefill;

  const close = useCallback(() => {
    setDraft(null);
    onClose();
  }, [onClose]);

  return (
    <ModalSheet
      visible={visible}
      title={title}
      onClose={close}
      footer={
        <Button
          label="Save"
          onPress={() => onSave(value)}
          loading={saving}
          style={{ flex: 1 }}
        />
      }
    >
      <FormField
        label="Total cost"
        value={value}
        onChangeText={setDraft}
        placeholder="0.00"
        hint={hint}
        error={error}
        keyboardType="decimal-pad"
        autoCapitalize="none"
        autoCorrect={false}
        testID={testID}
      />
    </ModalSheet>
  );
}
