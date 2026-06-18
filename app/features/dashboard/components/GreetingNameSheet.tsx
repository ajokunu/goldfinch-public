/**
 * Greeting name editor (P8, ops/PHASE8-DECISIONS.md interaction pass): a
 * small ModalSheet opened from the pressable dashboard greeting, carrying
 * the same display-name FormField and optimistic usePatchProfile mutation as
 * Settings -- the name is editable right at the welcome screen, and both
 * editors converge on the one profile cache entry.
 *
 * Validation mirrors the shared trimmed length bounds so the client can
 * never send what the API rejects. A failed save (409 conflict or any other
 * error) keeps the sheet open and surfaces the inline message while the
 * hook's rollback restores the previous greeting; a successful save closes
 * the sheet over the already-updated greeting. Every close path (header X,
 * backdrop, post-save) drops the draft so the next open starts from the
 * server name, never a stale edit.
 */
import { useCallback, useState } from 'react';
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MIN_LENGTH,
} from '@goldfinch/shared/constants';
import { validateDisplayName } from '@goldfinch/shared/profile';

import { usePatchProfile, useProfile } from '../../../src/api/profile';
import { displayNameLengthError, useLang, useT } from '../../../src/i18n';
import { logger } from '../../../src/lib/logger';
import { Button } from '../../../src/ui/Button';
import { FormField } from '../../../src/ui/FormField';
import { ModalSheet } from '../../../src/ui/ModalSheet';

const log = logger.child({ screen: 'dashboard' });

export interface GreetingNameSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function GreetingNameSheet({ visible, onClose }: GreetingNameSheetProps) {
  const t = useT();
  const lang = useLang();
  const { data: profile } = useProfile();
  const patchProfile = usePatchProfile();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The field tracks the server value until the user types (same draft
  // pattern as the Settings DisplayNameField).
  const value = draft ?? profile?.displayName ?? '';

  const close = useCallback(() => {
    setDraft(null);
    setError(null);
    onClose();
  }, [onClose]);

  const handleSave = useCallback(() => {
    // Single source of truth shared with the API and Settings field.
    const result = validateDisplayName(value);
    if (!result.ok) {
      setError(
        displayNameLengthError(
          lang,
          PROFILE_DISPLAY_NAME_MIN_LENGTH,
          PROFILE_DISPLAY_NAME_MAX_LENGTH,
        ),
      );
      return;
    }
    setError(null);
    patchProfile.mutate(
      { displayName: result.value },
      {
        onSuccess: close,
        onError: (mutationError) => {
          // The hook already logged and rolled the cache back; this surfaces
          // the failure to the user instead of silently reverting the field.
          log.warn('display-name save surfaced to greeting sheet', {
            error: mutationError,
          });
          setError(t('Could not save your name'));
        },
      },
    );
  }, [close, lang, patchProfile, t, value]);

  return (
    <ModalSheet
      visible={visible}
      title={t('Edit name')}
      onClose={close}
      footer={
        <Button
          label={t('Save name')}
          onPress={handleSave}
          loading={patchProfile.isPending}
          disabled={draft === null}
          style={{ flex: 1 }}
        />
      }
    >
      <FormField
        label={t('Display name')}
        value={value}
        onChangeText={(text) => {
          setDraft(text);
          setError(null);
        }}
        placeholder={t('Display name')}
        hint={t('Shown in your dashboard greeting')}
        error={error}
        maxLength={PROFILE_DISPLAY_NAME_MAX_LENGTH + 10}
        autoCapitalize="words"
        autoCorrect={false}
        testID="greeting-name-input"
      />
    </ModalSheet>
  );
}
