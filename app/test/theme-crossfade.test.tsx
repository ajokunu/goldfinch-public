/**
 * Theme crossfade integration (PHASE9-DECISIONS P9-2 item 8): switching
 * direction/mode animates the palette through the ThemeProvider-level
 * snapshot crossfade, while reduced motion (the suite default -- the OS flag
 * is pinned true in setup.ts) swaps instantly with no capture and no overlay.
 *
 * The pixel-capture leg (Skia makeImageFromView) is mocked at its module
 * boundary: jest resolves ../src/ui/motion/themeSnapshot to the .native leg
 * exactly like the hook's own import, so the mock covers both. The contract
 * under test is the orchestration: the OLD theme stays live until the
 * snapshot has decoded (no visible hard repaint), then the flip happens under
 * the overlay; every failure path degrades to the instant swap.
 */
import { Text } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { THEME_CROSSFADE_OVERLAY_TEST_ID } from '../src/ui/motion';
import { captureViewSnapshot } from '../src/ui/motion/themeSnapshot';
import { useUiStore } from '../src/state/uiStore';
import {
  resolveTheme,
  type ThemeDirection,
  type ThemeMode,
} from '../src/ui/theme';
import { renderWithProviders, THEME_PROBE_TEST_ID } from './render';

jest.mock('../src/ui/motion/themeSnapshot', () => ({
  captureViewSnapshot: jest.fn(),
}));

const capture = jest.mocked(captureViewSnapshot);

/** A 1x1 JPEG-ish data URI; content is irrelevant, decoding is mocked too. */
const SNAPSHOT_URI = 'data:image/jpeg;base64,Zg==';

function probeText(): string {
  const probe = screen.getByTestId(THEME_PROBE_TEST_ID);
  return (probe.props as { children: string }).children;
}

/**
 * The overlay deliberately hides itself from accessibility (it is a
 * decorative snapshot of pixels the user already saw), and RNTL's default
 * queries exclude accessibility-hidden elements -- so every overlay lookup
 * (presence AND absence) must opt into hidden elements, or absence checks
 * pass vacuously.
 */
const OVERLAY_QUERY = { includeHiddenElements: true } as const;

function queryOverlay(): ReturnType<typeof screen.queryByTestId> {
  return screen.queryByTestId(THEME_CROSSFADE_OVERLAY_TEST_ID, OVERLAY_QUERY);
}

async function findOverlay(): Promise<ReturnType<typeof screen.getByTestId>> {
  return screen.findByTestId(THEME_CROSSFADE_OVERLAY_TEST_ID, OVERLAY_QUERY);
}

/** Mirrors ThemeProbe's rendering of the resolved theme identity/tokens. */
function expectedProbe(direction: ThemeDirection, mode: ThemeMode): string {
  const theme = resolveTheme(direction, mode);
  return [
    theme.direction,
    theme.mode,
    theme.colors.accent,
    theme.colors.bg,
    String(theme.radius.card),
    theme.fonts.display,
  ].join('|');
}

function switchDirection(direction: ThemeDirection): void {
  act(() => {
    useUiStore.setState({ themeDirection: direction });
  });
}

async function renderProbe(): Promise<void> {
  renderWithProviders(<Text>crossfade host</Text>, { withThemeProbe: true });
  expect(await screen.findByText('crossfade host')).toBeOnTheScreen();
}

beforeEach(() => {
  capture.mockReset();
});

describe('theme crossfade (reduced motion -- suite default)', () => {
  it('swaps instantly: no capture, no overlay, new tokens immediately', async () => {
    await renderProbe();
    expect(probeText()).toBe(expectedProbe('meridian', 'light'));

    switchDirection('quant');

    expect(probeText()).toBe(expectedProbe('quant', 'light'));
    expect(capture).not.toHaveBeenCalled();
    expect(queryOverlay()).toBeNull();
  });

  it('mode switches swap instantly too', async () => {
    await renderProbe();

    act(() => {
      useUiStore.setState({ themeOverride: 'dark' });
    });

    expect(probeText()).toBe(expectedProbe('meridian', 'dark'));
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('theme crossfade (full motion)', () => {
  beforeEach(() => {
    act(() => {
      useUiStore.setState({ reduceAnimations: false });
    });
  });

  it('keeps the old palette live until the snapshot decodes, then flips under the overlay', async () => {
    let resolveCapture: (uri: string | null) => void = () => undefined;
    capture.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveCapture = resolve;
        }),
    );
    await renderProbe();

    switchDirection('quant');

    // Capture is in flight; consumers still resolve the outgoing theme (the
    // crossfade must never show a hard repaint before the overlay is up).
    expect(capture).toHaveBeenCalledTimes(1);
    expect(probeText()).toBe(expectedProbe('meridian', 'light'));

    await act(async () => {
      resolveCapture(SNAPSHOT_URI);
    });

    // Overlay mounted (old pixels, fully opaque) but the image has not
    // decoded yet -- the theme flip still waits.
    const overlay = await findOverlay();
    expect(probeText()).toBe(expectedProbe('meridian', 'light'));

    fireEvent(overlay, 'load');

    // Decoded: the real tree repaints in the new theme under the overlay.
    expect(probeText()).toBe(expectedProbe('quant', 'light'));
  });

  it('a null capture (logged by the capture leg) degrades to an instant swap', async () => {
    capture.mockResolvedValue(null);
    await renderProbe();

    switchDirection('studio');

    await waitFor(() => {
      expect(probeText()).toBe(expectedProbe('studio', 'light'));
    });
    expect(queryOverlay()).toBeNull();
  });

  it('a rejected capture is logged and degrades to an instant swap', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      capture.mockRejectedValue(new Error('no skia bindings'));
      await renderProbe();

      switchDirection('halo');

      await waitFor(() => {
        expect(probeText()).toBe(expectedProbe('halo', 'light'));
      });
      expect(queryOverlay()).toBeNull();
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('an overlay image that errors swaps without a fade and removes itself', async () => {
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      capture.mockResolvedValue(SNAPSHOT_URI);
      await renderProbe();

      switchDirection('quant');

      const overlay = await findOverlay();
      fireEvent(overlay, 'error');

      expect(probeText()).toBe(expectedProbe('quant', 'light'));
      expect(queryOverlay()).toBeNull();
      expect(consoleWarn).toHaveBeenCalled();
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it('a rapid second switch supersedes the first capture (last tap wins)', async () => {
    const pending: Array<(uri: string | null) => void> = [];
    capture.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          pending.push(resolve);
        }),
    );
    await renderProbe();

    switchDirection('quant');
    switchDirection('halo');

    // The first capture resolving late must not mount a stale overlay or
    // flip to the superseded theme.
    await act(async () => {
      pending[0]?.(SNAPSHOT_URI);
    });
    expect(probeText()).toBe(expectedProbe('meridian', 'light'));

    await act(async () => {
      pending[1]?.(SNAPSHOT_URI);
    });
    const overlay = await findOverlay();
    fireEvent(overlay, 'load');

    expect(probeText()).toBe(expectedProbe('halo', 'light'));
  });
});
