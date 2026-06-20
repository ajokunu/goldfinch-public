/**
 * Settings screen (shell-owned, lives under the More stack per the Phase 7
 * IA -- /settings no longer exists as a URL). Rebuilt per design-spec
 * shell.md section 5:
 *
 *   0. Profile -- display-name field (GET/PATCH /profile; the API keys the
 *      item by the JWT sub, so each spouse edits her own name). Saves are
 *      optimistic via usePatchProfile; validation mirrors the shared
 *      trimmed-1-40 bounds so the client can never send what the API rejects.
 *   1. Appearance -- theme-direction cards (DIR_ORDER, each previewed in its
 *      own default-mode palette and display font) + System/Light/Dark mode
 *      segmented control. Direction changes NEVER mutate the mode setting
 *      (the prototype's DEFAULT_MODE adoption on switch is demo behavior,
 *      not integrated -- decision 2 keeps mode an independent setting).
 *      Also hosts the "Reduce animations" motion kill switch (PHASE9 P9-3):
 *      the switch mirrors the OS reduced-motion flag until toggled, after
 *      which the explicit boolean override is persisted in the uiStore and
 *      consumed by every src/ui/motion primitive via useMotionSettings.
 *   2. Language -- System default / English / 한국어 radio rows. Language
 *      names are autonyms by convention (shell.md 8.5) and never translated.
 *   3. Security -- biometric toggle, native only (logic unchanged).
 *   4. Account -- sign out (logic + logged failure unchanged; destructive
 *      styling maps to the theme danger token via ListRow).
 *   5. Brand footer (shared with the More hub) with the live version.
 *
 * The screen title comes from the More stack header.
 */
import { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Check, EyeOff, Fingerprint, LogOut, Wind } from 'lucide-react-native';
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MIN_LENGTH,
} from '@goldfinch/shared/constants';

import { useProfile, usePatchProfile } from '../../../src/api/profile';
import { useAuth } from '../../../src/auth/AuthProvider';
import {
  displayNameLengthError,
  useLang,
  useT,
  type LanguageSetting,
} from '../../../src/i18n';
import { logger } from '../../../src/lib/logger';
import { useUiStore, type ThemeOverride } from '../../../src/state/uiStore';
import { Button } from '../../../src/ui/Button';
import { Card } from '../../../src/ui/Card';
import { FormField } from '../../../src/ui/FormField';
import { ListRow } from '../../../src/ui/ListRow';
import { Screen } from '../../../src/ui/Screen';
import { Segmented, type SegmentedOption } from '../../../src/ui/Segmented';
import { BrandFooter } from '../../../src/ui/shell/BrandFooter';
import {
  DEFAULT_MODE,
  DIR_ORDER,
  resolveTheme,
  type ThemeDirection,
} from '../../../src/ui/theme';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useReducedMotion } from '../../../src/ui/useReducedMotion';

/** Below this width the direction cards stack in one column (shell.md 5.2). */
const TWO_COLUMN_MIN_WIDTH = 360;

function SectionHeader({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        color: theme.colors.textSecondary,
        fontFamily: theme.fonts.sans,
        fontSize: theme.text.caption,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginTop: theme.spacing.lg,
        marginBottom: theme.spacing.sm,
      }}
    >
      {title}
    </Text>
  );
}

/**
 * One theme-direction card: swatch strip in that direction's default-mode
 * palette, name in its display font, tagline, selected ring + check badge.
 */
function DirectionCard({
  direction,
  selected,
  twoColumn,
  onSelect,
}: {
  direction: ThemeDirection;
  selected: boolean;
  twoColumn: boolean;
  onSelect: (direction: ThemeDirection) => void;
}) {
  const theme = useTheme();
  // Preview tokens come from the direction's prototype first-load mode
  // (DEFAULT_MODE) -- purely a preview; selecting never touches the user's
  // mode preference.
  const preview = resolveTheme(direction, DEFAULT_MODE[direction]);
  const swatches = [
    preview.colors.bg,
    preview.colors.surface,
    preview.colors.accent,
    preview.colors.accent2,
  ];

  return (
    <Pressable
      onPress={() => onSelect(direction)}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={preview.name}
      accessibilityHint={preview.tagline}
      testID={`theme-direction-${direction}`}
      style={({ pressed }) => [
        styles.dirCard,
        {
          flexBasis: twoColumn ? '46%' : '100%',
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.card,
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.swatchRow}>
        {swatches.map((color, index) => (
          <View
            key={index}
            style={[
              styles.swatch,
              { backgroundColor: color, borderColor: theme.colors.line },
            ]}
          />
        ))}
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.dirName,
          { color: theme.colors.textPrimary, fontFamily: preview.fonts.display },
        ]}
      >
        {preview.name}
      </Text>
      <Text
        numberOfLines={2}
        style={[
          styles.dirTagline,
          { color: theme.colors.textSecondary, fontFamily: theme.fonts.sans },
        ]}
      >
        {preview.tagline}
      </Text>
      {selected ? (
        <View
          style={[styles.checkBadge, { backgroundColor: theme.colors.accent }]}
        >
          <Check size={12} strokeWidth={3} color={theme.colors.onAccent} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Display-name editor (Profile section). The field tracks the server value
 * until the user types (draft state); Save validates against the shared
 * bounds, then runs the optimistic PATCH. A 409 (the other device won) or
 * any other failure surfaces inline and the rolled-back name reappears.
 */
function DisplayNameField() {
  const t = useT();
  const lang = useLang();
  const { data: profile } = useProfile();
  const patchProfile = usePatchProfile();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const value = draft ?? profile?.displayName ?? '';

  const handleSave = useCallback(() => {
    const trimmed = value.trim();
    if (
      trimmed.length < PROFILE_DISPLAY_NAME_MIN_LENGTH ||
      trimmed.length > PROFILE_DISPLAY_NAME_MAX_LENGTH
    ) {
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
      { displayName: trimmed },
      {
        onSuccess: () => setDraft(null),
        onError: (mutationError) => {
          // The hook already logged and rolled back the cache; this surfaces
          // the failure to the user instead of silently reverting the field.
          logger.warn('display-name save surfaced to settings UI', {
            error: mutationError,
          });
          setError(t('Could not save your name'));
        },
      },
    );
  }, [lang, patchProfile, t, value]);

  return (
    <Card style={styles.profileCard}>
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
        testID="display-name-input"
      />
      <Button
        label={t('Save name')}
        onPress={handleSave}
        loading={patchProfile.isPending}
        disabled={draft === null}
      />
    </Card>
  );
}

/** Selection row with radio semantics (shell.md 5.3). */
function RadioRow({
  label,
  checked,
  onSelect,
  testID,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [
        styles.radioRow,
        {
          borderRadius: theme.radius.control,
          backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.radioLabel,
          { color: theme.colors.textPrimary, fontFamily: theme.fonts.sans },
        ]}
      >
        {label}
      </Text>
      {checked ? (
        <Check size={20} strokeWidth={2.4} color={theme.colors.accent} />
      ) : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const theme = useTheme();
  const t = useT();
  const { width } = useWindowDimensions();
  const { signOut } = useAuth();
  const themeOverride = useUiStore((s) => s.themeOverride);
  const setThemeOverride = useUiStore((s) => s.setThemeOverride);
  const themeDirection = useUiStore((s) => s.themeDirection);
  const setThemeDirection = useUiStore((s) => s.setThemeDirection);
  const language = useUiStore((s) => s.language);
  const setLanguage = useUiStore((s) => s.setLanguage);
  const biometricEnabled = useUiStore((s) => s.biometricEnabled);
  const setBiometricEnabled = useUiStore((s) => s.setBiometricEnabled);
  const reduceAnimations = useUiStore((s) => s.reduceAnimations);
  const setReduceAnimations = useUiStore((s) => s.setReduceAnimations);
  const privacyMode = useUiStore((s) => s.privacyMode);
  const setPrivacyMode = useUiStore((s) => s.setPrivacyMode);
  // The toggle mirrors the OS reduced-motion flag until the user overrides
  // it; the stored override then wins (motionMath.resolveReduceMotion).
  const osReducedMotion = useReducedMotion();
  const reduceAnimationsValue = reduceAnimations ?? osReducedMotion;
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      // The call site is void-ed; without this catch a failure would be an
      // unhandled rejection nobody ever sees (P7-10).
      logger.error('sign-out failed', { error });
    } finally {
      setSigningOut(false);
    }
  }, [signOut, signingOut]);

  const twoColumn = width >= TWO_COLUMN_MIN_WIDTH;

  const modeOptions: ReadonlyArray<SegmentedOption<ThemeOverride>> = [
    { key: 'system', label: t('System') },
    { key: 'light', label: t('Light') },
    { key: 'dark', label: t('Dark') },
  ];

  // Language autonyms render in their own language by convention (shell.md
  // 8.5); pickers never translate language names.
  const languageOptions: ReadonlyArray<{
    value: LanguageSetting;
    label: string;
  }> = [
    { value: 'system', label: t('System default') },
    { value: 'en', label: 'English' },
    { value: 'ko', label: '한국어' },
  ];

  return (
    <Screen scroll>
      <SectionHeader title={t('Profile')} />
      <DisplayNameField />

      <SectionHeader title={t('Appearance')} />
      <View accessibilityRole="radiogroup" style={styles.dirGrid}>
        {DIR_ORDER.map((direction) => (
          <DirectionCard
            key={direction}
            direction={direction}
            selected={direction === themeDirection}
            twoColumn={twoColumn}
            onSelect={setThemeDirection}
          />
        ))}
      </View>
      <Text
        style={[
          styles.subLabel,
          { color: theme.colors.textSecondary, fontFamily: theme.fonts.sans },
        ]}
      >
        {t('Mode')}
      </Text>
      <Segmented
        options={modeOptions}
        value={themeOverride}
        onChange={setThemeOverride}
      />
      <Card style={[styles.rowCard, styles.motionCard]}>
        <ListRow
          label={t('Reduce animations')}
          icon={Wind}
          right={
            <Switch
              value={reduceAnimationsValue}
              onValueChange={setReduceAnimations}
              trackColor={{ true: theme.colors.accent }}
              testID="reduce-animations-switch"
            />
          }
        />
      </Card>

      <SectionHeader title={t('Privacy')} />
      <Card style={styles.rowCard}>
        <ListRow
          label={t('Open with amounts hidden')}
          sub={t('Mask balances until you tap the eye on the dashboard')}
          icon={EyeOff}
          right={
            <Switch
              value={privacyMode}
              onValueChange={setPrivacyMode}
              trackColor={{ true: theme.colors.accent }}
              testID="privacy-mode-switch"
            />
          }
        />
      </Card>

      <SectionHeader title={t('Language')} />
      <Card style={styles.rowCard}>
        <View accessibilityRole="radiogroup">
          {languageOptions.map((option, index) => (
            <View key={option.value}>
              {index > 0 ? (
                <View
                  style={[
                    styles.hairline,
                    { backgroundColor: theme.colors.line },
                  ]}
                />
              ) : null}
              <RadioRow
                label={option.label}
                checked={language === option.value}
                onSelect={() => setLanguage(option.value)}
                testID={`language-${option.value}`}
              />
            </View>
          ))}
        </View>
      </Card>

      {Platform.OS !== 'web' ? (
        <>
          <SectionHeader title={t('Security')} />
          <Card style={styles.rowCard}>
            <ListRow
              label={t('Require Face ID / biometric unlock')}
              icon={Fingerprint}
              right={
                <Switch
                  value={biometricEnabled}
                  onValueChange={setBiometricEnabled}
                  trackColor={{ true: theme.colors.accent }}
                />
              }
            />
          </Card>
        </>
      ) : null}

      <SectionHeader title={t('Account')} />
      <Card style={styles.rowCard}>
        <ListRow
          label={signingOut ? t('Signing out') : t('Sign out')}
          icon={LogOut}
          destructive
          disabled={signingOut}
          onPress={() => void handleSignOut()}
        />
      </Card>

      <BrandFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  dirGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  dirCard: {
    flexGrow: 1,
    borderWidth: 2,
    padding: 12,
    gap: 6,
  },
  swatchRow: { flexDirection: 'row', gap: 5, marginBottom: 2 },
  swatch: {
    flex: 1,
    height: 22,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dirName: { fontSize: 17 },
  dirTagline: { fontSize: 12 },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 8,
  },
  rowCard: { padding: 6 },
  motionCard: { marginTop: 14 },
  profileCard: { padding: 14 },
  hairline: { height: StyleSheet.hairlineWidth },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 13,
    paddingVertical: 13,
    paddingHorizontal: 10,
  },
  radioLabel: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
});
