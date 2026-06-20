/**
 * Settings screen integration: theme direction cards + mode segmented control
 * actually change the tokens resolved by useTheme() consumers, the language
 * radio rows carry radio semantics, the display-name field round-trips
 * through GET/PATCH /profile with shared-bounds validation, and sign-out
 * routes through the auth provider with its in-flight disable.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MIN_LENGTH,
} from '@goldfinch/shared/constants';

import SettingsScreen from '../app/(app)/more/settings';
import { displayNameLengthError } from '../src/i18n';
import { resolveTheme } from '../src/ui/theme';
import { useUiStore } from '../src/state/uiStore';
import { signOutSpy } from './authProviderMock';
import { mockApi } from './mockApi';
import { renderWithProviders, THEME_PROBE_TEST_ID } from './render';

function probeText(): string {
  const probe = screen.getByTestId(THEME_PROBE_TEST_ID);
  return (probe.props as { children: string }).children;
}

// The screen's profile query fires on every mount; tests that exercise the
// display-name flow override this default registration.
beforeEach(() => {
  mockApi.get('/profile', { displayName: null });
});

describe('Settings screen', () => {
  it('renders all four direction cards with names, taglines, and radio state', async () => {
    renderWithProviders(<SettingsScreen />);

    expect(await screen.findByText('Meridian')).toBeOnTheScreen();
    expect(screen.getByText('Quant')).toBeOnTheScreen();
    expect(screen.getByText('Studio')).toBeOnTheScreen();
    expect(screen.getByText('Halo')).toBeOnTheScreen();
    expect(
      screen.getByText('Calm · premium · editorial serif'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Dense · pro · data-first')).toBeOnTheScreen();

    expect(
      screen.getByTestId('theme-direction-meridian').props.accessibilityState,
    ).toMatchObject({ checked: true });
    expect(
      screen.getByTestId('theme-direction-quant').props.accessibilityState,
    ).toMatchObject({ checked: false });
  });

  it('switching direction changes the resolved theme tokens', async () => {
    renderWithProviders(<SettingsScreen />, { withThemeProbe: true });
    await screen.findByText('Meridian');

    const meridianLight = resolveTheme('meridian', 'light');
    expect(probeText()).toBe(
      [
        'meridian',
        'light',
        meridianLight.colors.accent,
        meridianLight.colors.bg,
        String(meridianLight.radius.card),
        meridianLight.fonts.display,
      ].join('|'),
    );

    fireEvent.press(screen.getByTestId('theme-direction-quant'));

    // Direction changes NEVER mutate the mode preference (decision 2):
    // override stays 'system', which resolves light in the test environment.
    const quantLight = resolveTheme('quant', 'light');
    expect(useUiStore.getState().themeDirection).toBe('quant');
    expect(useUiStore.getState().themeOverride).toBe('system');
    expect(probeText()).toBe(
      [
        'quant',
        'light',
        quantLight.colors.accent,
        quantLight.colors.bg,
        String(quantLight.radius.card),
        quantLight.fonts.display,
      ].join('|'),
    );
    expect(quantLight.colors.accent).not.toBe(meridianLight.colors.accent);
    expect(
      screen.getByTestId('theme-direction-quant').props.accessibilityState,
    ).toMatchObject({ checked: true });
  });

  it('switching mode to dark resolves the dark token set', async () => {
    renderWithProviders(<SettingsScreen />, { withThemeProbe: true });
    await screen.findByText('Meridian');

    fireEvent.press(screen.getByText('Dark'));

    const meridianDark = resolveTheme('meridian', 'dark');
    expect(useUiStore.getState().themeOverride).toBe('dark');
    expect(probeText()).toBe(
      [
        'meridian',
        'dark',
        meridianDark.colors.accent,
        meridianDark.colors.bg,
        String(meridianDark.radius.card),
        meridianDark.fonts.display,
      ].join('|'),
    );
  });

  it('reduce-animations switch mirrors the OS flag until overridden, then stores the override', async () => {
    renderWithProviders(<SettingsScreen />);
    await screen.findByText('Meridian');

    // No override stored: the switch mirrors the OS reduced-motion flag,
    // which the suite-wide useReducedMotion mock pins to true.
    expect(useUiStore.getState().reduceAnimations).toBeNull();
    const toggle = screen.getByTestId('reduce-animations-switch');
    expect(toggle.props.value).toBe(true);

    // Toggling stores an explicit boolean override that beats the OS flag.
    fireEvent(toggle, 'valueChange', false);
    expect(useUiStore.getState().reduceAnimations).toBe(false);
    expect(
      screen.getByTestId('reduce-animations-switch').props.value,
    ).toBe(false);

    fireEvent(
      screen.getByTestId('reduce-animations-switch'),
      'valueChange',
      true,
    );
    expect(useUiStore.getState().reduceAnimations).toBe(true);
  });

  it('language rows carry radio semantics and update the store', async () => {
    renderWithProviders(<SettingsScreen />);
    await screen.findByText('Meridian');

    const english = screen.getByTestId('language-en');
    expect(english.props.accessibilityRole).toBe('radio');
    expect(english.props.accessibilityState).toMatchObject({ checked: false });
    expect(
      screen.getByTestId('language-system').props.accessibilityState,
    ).toMatchObject({ checked: true });
    expect(screen.getByText('한국어')).toBeOnTheScreen();

    fireEvent.press(english);
    expect(useUiStore.getState().language).toBe('en');
    expect(
      screen.getByTestId('language-en').props.accessibilityState,
    ).toMatchObject({ checked: true });
  });

  it('sign out invokes the auth provider sign-out', async () => {
    renderWithProviders(<SettingsScreen />);
    await screen.findByText('Meridian');

    fireEvent.press(screen.getByText('Sign out'));
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    // Flush the async sign-out settle (the in-flight flag resets) inside act.
    await act(async () => {});
  });
});

describe('Settings display name (profile)', () => {
  it('shows the stored name and saves a trimmed edit through PATCH /profile', async () => {
    // Stateful mock server: the post-save invalidation refetch must return
    // the NEW name, exactly like the real API.
    let stored: { displayName: string | null } = { displayName: 'Alex' };
    let patched: unknown;
    mockApi.on('GET', '/profile', () => ({ status: 200, body: stored }));
    mockApi.on('PATCH', '/profile', (request) => {
      patched = request.body;
      stored = {
        displayName: (request.body as { displayName: string }).displayName,
      };
      return { status: 200, body: stored };
    });

    renderWithProviders(<SettingsScreen />);

    expect(await screen.findByDisplayValue('Alex')).toBeOnTheScreen();

    fireEvent.changeText(screen.getByTestId('display-name-input'), '  Taylor  ');
    fireEvent.press(screen.getByText('Save name'));

    // The client sends the TRIMMED name (shared bounds rule).
    await waitFor(() => expect(patched).toEqual({ displayName: 'Taylor' }));
    // Optimistic cache + refetch converge on the saved name.
    expect(await screen.findByDisplayValue('Taylor')).toBeOnTheScreen();
    expect(
      screen.queryByText(
        displayNameLengthError(
          'en',
          PROFILE_DISPLAY_NAME_MIN_LENGTH,
          PROFILE_DISPLAY_NAME_MAX_LENGTH,
        ),
      ),
    ).toBeNull();
  });

  it('rejects a whitespace-only name inline and never calls PATCH', async () => {
    renderWithProviders(<SettingsScreen />);
    await screen.findByText('Meridian');

    fireEvent.changeText(screen.getByTestId('display-name-input'), '   ');
    fireEvent.press(screen.getByText('Save name'));

    expect(
      await screen.findByText(
        displayNameLengthError(
          'en',
          PROFILE_DISPLAY_NAME_MIN_LENGTH,
          PROFILE_DISPLAY_NAME_MAX_LENGTH,
        ),
      ),
    ).toBeOnTheScreen();
    // No PATCH route is registered: had the screen attempted one, the
    // unmatched-request assertion in test teardown would fail this test.
  });

  it('surfaces a save failure inline and keeps the draft for retry', async () => {
    mockApi.get('/profile', { displayName: 'Alex' });
    mockApi.error('PATCH', '/profile', 409, 'VERSION_CONFLICT', 'concurrent edit');

    renderWithProviders(<SettingsScreen />);
    expect(await screen.findByDisplayValue('Alex')).toBeOnTheScreen();

    fireEvent.changeText(screen.getByTestId('display-name-input'), 'Taylor');
    fireEvent.press(screen.getByText('Save name'));

    expect(
      await screen.findByText('Could not save your name'),
    ).toBeOnTheScreen();
    // The draft stays in the field so the user can retry without retyping.
    expect(screen.getByDisplayValue('Taylor')).toBeOnTheScreen();
  });
});
