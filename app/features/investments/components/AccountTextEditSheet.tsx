/**
 * Account label / institution override editor sheet: a small ModalSheet
 * mirroring AccountTypeSheet's structure and the GreetingNameSheet save flow.
 * A single TextInput (FormField) carries the USER-OWNED override; the parent's
 * usePatchAccount runs the optimistic PATCH and the inline error.
 *
 * Empty/whitespace input clears the override (the parent sends null), reverting
 * the effective value to the synced one -- so the placeholder shows the synced
 * value as the fallback the field falls back to when left blank. The draft
 * pattern (draft ?? prefill) tracks the prefill until the user types, and every
 * close path drops the draft so the next open starts from the saved override.
 */
import { useCallback, useState } from 'react';

import { Button } from '../../../src/ui/Button';
import { FormField } from '../../../src/ui/FormField';
import { ModalSheet } from '../../../src/ui/ModalSheet';

export interface AccountTextEditSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Sheet title + field label, e.g. "Name" / "Institution". */
  title: string;
  /** The current override (edit prefill); empty when none is set. */
  prefill: string;
  /** The synced value, shown as the placeholder (the blank-field fallback). */
  placeholder: string;
  /** Muted helper under the input (e.g. the clear-to-revert note). */
  hint: string;
  /** Abuse-ceiling for the override (shared MAX_TEXT_LENGTHS). */
  maxLength: number;
  /** Whether the parent's PATCH is in flight (drives the Save spinner). */
  saving: boolean;
  /** Inline error to surface (the parent's rollback note); null hides it. */
  error: string | null;
  /**
   * Save the raw draft. The parent maps empty/whitespace to a clearing null and
   * a non-empty draft to the trimmed override, then PATCHes optimistically and
   * closes on success. Editing as draft (not committing here) keeps the sheet
   * open for correction when the parent surfaces a failure.
   */
  onSave: (draft: string) => void;
  testID?: string;
}

export function AccountTextEditSheet({
  visible,
  onClose,
  title,
  prefill,
  placeholder,
  hint,
  maxLength,
  saving,
  error,
  onSave,
  testID,
}: AccountTextEditSheetProps) {
  // The field tracks the prefill until the user types (the same draft pattern
  // as GreetingNameSheet / the Settings display-name field).
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
        label={title}
        value={value}
        onChangeText={setDraft}
        placeholder={placeholder}
        hint={hint}
        error={error}
        // Allow a little slack over the abuse ceiling so the trim-then-validate
        // path can report rather than silently truncate (mirrors the greeting).
        maxLength={maxLength + 10}
        autoCapitalize="words"
        autoCorrect={false}
        testID={testID}
      />
    </ModalSheet>
  );
}
