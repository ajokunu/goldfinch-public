/**
 * Navigation + structure motion tests (PHASE9-DECISIONS P9-2 items 2/3/9).
 *
 * The pure builders are exercised across the full kill-switch matrix (full
 * motion / reduced motion / multiplier 0) -- the contract that makes the
 * navigator transitions one flag away from off. The hook leg runs under the
 * suite-wide reduced-motion mock and the store override, mirroring the
 * motion primitive suite. SharedMark and the ModalSheet content stagger are
 * asserted on their content contract: children always render, on both the
 * reduced and full-motion paths.
 */
import { Animated, Text } from 'react-native';
import { screen } from '@testing-library/react-native';

import { ModalSheet } from '../src/ui/ModalSheet';
import {
  buildStackTransition,
  buildTabTransition,
  FadeRise,
  NATIVE_SHARED_ELEMENTS_ENABLED,
  SharedMark,
  useTabTransition,
  type MotionSettings,
} from '../src/ui/motion';
import { useUiStore } from '../src/state/uiStore';
import { renderWithProviders } from './render';

const FULL: MotionSettings = { reduceMotion: false, multiplier: 1 };
const REDUCED: MotionSettings = { reduceMotion: true, multiplier: 0 };
const KILLED: MotionSettings = { reduceMotion: false, multiplier: 0 };

function specDuration(options: ReturnType<typeof buildTabTransition>): number {
  expect(options.transitionSpec).toBeDefined();
  const spec = options.transitionSpec as { config: { duration: number } };
  return spec.config.duration;
}

describe('buildTabTransition (P9-2 item 2: crossfade + drift)', () => {
  it('full motion: fade animation, 240ms switch, scene interpolator wired', () => {
    const options = buildTabTransition(FULL);
    expect(options.animation).toBe('fade');
    expect(specDuration(options)).toBe(240);

    // The interpolator must drive opacity AND vertical drift on the scene.
    const interpolated = options.sceneStyleInterpolator?.({
      current: { progress: new Animated.Value(0) },
    });
    expect(interpolated).toBeDefined();
    const sceneStyle = interpolated?.sceneStyle as {
      opacity: unknown;
      transform: { translateY: unknown }[];
    };
    expect(sceneStyle.opacity).toBeDefined();
    expect(sceneStyle.transform).toHaveLength(1);
    expect(sceneStyle.transform[0]?.translateY).toBeDefined();
  });

  it('reduced motion: collapses to the fast fade, never disables feedback', () => {
    const options = buildTabTransition(REDUCED);
    expect(options.animation).toBe('fade');
    expect(specDuration(options)).toBe(80);
  });

  it('multiplier 0 (kill switch): no animation at all', () => {
    expect(buildTabTransition(KILLED)).toEqual({ animation: 'none' });
  });
});

describe('buildStackTransition (P9-2 item 2: More-stack slide)', () => {
  it('full motion: platform push/slide (parallax push on iOS)', () => {
    expect(buildStackTransition(FULL)).toEqual({
      animation: 'slide_from_right',
    });
  });

  it('reduced motion: fast fade', () => {
    expect(buildStackTransition(REDUCED)).toEqual({
      animation: 'fade',
      animationDuration: 80,
    });
  });

  it('multiplier 0 (kill switch): no animation', () => {
    expect(buildStackTransition(KILLED)).toEqual({ animation: 'none' });
  });
});

describe('useTabTransition', () => {
  function Probe() {
    const options = useTabTransition();
    const duration =
      options.animation === 'none'
        ? 'none'
        : String(
            (options.transitionSpec as { config: { duration: number } }).config
              .duration,
          );
    return <Text testID="tab-transition-probe">{duration}</Text>;
  }

  it('follows the suite default (OS reduced motion): 80ms fast fade', async () => {
    renderWithProviders(<Probe />);
    expect(await screen.findByTestId('tab-transition-probe')).toHaveTextContent(
      '80',
    );
  });

  it('store override OFF restores the designed 240ms switch', async () => {
    useUiStore.setState({ reduceAnimations: false });
    renderWithProviders(<Probe />);
    expect(await screen.findByTestId('tab-transition-probe')).toHaveTextContent(
      '240',
    );
  });
});

describe('SharedMark (P9-2 item 3: continuity anchor)', () => {
  it('ships the FadeRise mimic path (native flag off by decision)', () => {
    // Reanimated 4 removed the shared-element API; the decisions-doc
    // fallback is the shipped path. This assertion documents that state --
    // flipping the flag without restoring the API only logs and mimics.
    expect(NATIVE_SHARED_ELEMENTS_ENABLED).toBe(false);
  });

  it('renders the anchor content in place (reduced motion default)', async () => {
    renderWithProviders(
      <SharedMark tag="account-test">
        <Text>Checking 1</Text>
      </SharedMark>,
    );
    expect(await screen.findByText('Checking 1')).toBeOnTheScreen();
    expect(screen.getByTestId('shared-mark-account-test')).toBeOnTheScreen();
  });

  it('renders under full motion without crashing the worklet path', async () => {
    useUiStore.setState({ reduceAnimations: false });
    renderWithProviders(
      <SharedMark tag="category-cat1" testID="chip-anchor">
        <Text>Groceries</Text>
      </SharedMark>,
    );
    expect(await screen.findByText('Groceries')).toBeOnTheScreen();
    expect(screen.getByTestId('chip-anchor')).toBeOnTheScreen();
  });
});

describe('FlashList post-window wrapper (P9-2 item 6: static FadeRise)', () => {
  // Rows past the first-page entrance window keep the FadeRise wrapper for a
  // constant element shape across FlashList recycling, but with zero
  // duration and zero distance -- they must render statically, even with
  // animations fully on.
  it('durationMs=0 / distance=0 renders children immediately under full motion', async () => {
    useUiStore.setState({ reduceAnimations: false });
    renderWithProviders(
      <FadeRise durationMs={0} distance={0} testID="static-row-wrapper">
        <Text>Recycled row content</Text>
      </FadeRise>,
    );
    expect(await screen.findByText('Recycled row content')).toBeOnTheScreen();
    expect(screen.getByTestId('static-row-wrapper')).toBeOnTheScreen();
  });
});

describe('ModalSheet content stagger (P9-2 item 9)', () => {
  it('staggers body children in without ever dropping content (reduced)', async () => {
    renderWithProviders(
      <ModalSheet visible title="Add" onClose={jest.fn()}>
        <Text>sheet row one</Text>
        <Text>sheet row two</Text>
      </ModalSheet>,
    );
    expect(await screen.findByText('sheet row one')).toBeOnTheScreen();
    expect(screen.getByText('sheet row two')).toBeOnTheScreen();
  });

  it('full motion: panel + staggered content still mount every child', async () => {
    useUiStore.setState({ reduceAnimations: false });
    renderWithProviders(
      <ModalSheet visible title="Add" onClose={jest.fn()}>
        <Text>flow row one</Text>
        <Text>flow row two</Text>
      </ModalSheet>,
    );
    expect(await screen.findByText('flow row one')).toBeOnTheScreen();
    expect(screen.getByText('flow row two')).toBeOnTheScreen();
  });
});
