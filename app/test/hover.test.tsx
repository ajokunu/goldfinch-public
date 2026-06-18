/**
 * P8-1 hover system unit tests: the useHover hook is web-only and inert on
 * native (hover events do not exist there), respects the enabled flag, and
 * the style helpers implement the decided treatment -- one step toward
 * surfaceAlt, 120ms ease transition, pointer cursor, reduced-motion =
 * highlight without transition.
 */
import { Platform, Pressable, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Theme } from '../src/ui/theme';
import {
  HOVER_DURATION_MS,
  HOVER_LIFT_DISTANCE,
  HOVER_LIFT_DURATION_MS,
  hoverBackground,
  hoverLiftStyle,
  hoverLiftTransitionStyle,
  hoverTransitionStyle,
  useHover,
} from '../src/ui/useHover';

function HoverProbe({ enabled }: { enabled?: boolean }) {
  const { hovered, hoverProps } = useHover(enabled);
  return (
    <Pressable testID="probe" onPress={() => {}} {...hoverProps}>
      <Text>{hovered ? 'hovered' : 'idle'}</Text>
    </Pressable>
  );
}

/** Minimal theme slice the helpers read. */
const theme = {
  colors: { surface: '#ffffff', surfaceAlt: '#eeeeee' },
} as unknown as Theme;

describe('useHover', () => {
  let replaced: { restore: () => void } | null = null;

  function setPlatform(os: 'web' | 'ios'): void {
    replaced = jest.replaceProperty(Platform, 'OS', os);
  }

  afterEach(() => {
    replaced?.restore();
    replaced = null;
  });

  it('tracks hoverIn/hoverOut on web', () => {
    setPlatform('web');
    render(<HoverProbe />);

    expect(screen.getByText('idle')).toBeOnTheScreen();
    fireEvent(screen.getByTestId('probe'), 'hoverIn');
    expect(screen.getByText('hovered')).toBeOnTheScreen();
    fireEvent(screen.getByTestId('probe'), 'hoverOut');
    expect(screen.getByText('idle')).toBeOnTheScreen();
  });

  it('is inert when disabled (no handlers, never hovered)', () => {
    setPlatform('web');
    render(<HoverProbe enabled={false} />);

    // No onHoverIn prop is attached, so the event is a no-op.
    fireEvent(screen.getByTestId('probe'), 'hoverIn');
    expect(screen.getByText('idle')).toBeOnTheScreen();
  });

  it('is inert off web (native untouched)', () => {
    setPlatform('ios');
    render(<HoverProbe />);

    fireEvent(screen.getByTestId('probe'), 'hoverIn');
    expect(screen.getByText('idle')).toBeOnTheScreen();
  });
});

describe('hoverBackground', () => {
  it('lands transparent/unset resting surfaces on surfaceAlt', () => {
    expect(hoverBackground(theme)).toBe('#eeeeee');
    expect(hoverBackground(theme, 'transparent')).toBe('#eeeeee');
  });

  it('blends opaque surfaces halfway toward surfaceAlt', () => {
    // 50/50 of #ffffff and #eeeeee.
    expect(hoverBackground(theme, '#ffffff')).toBe('#f7f7f7');
  });

  it('steps surfaces already on surfaceAlt toward the raised surface', () => {
    expect(hoverBackground(theme, '#eeeeee')).toBe('#f7f7f7');
  });
});

describe('hoverTransitionStyle', () => {
  let replaced: { restore: () => void } | null = null;

  afterEach(() => {
    replaced?.restore();
    replaced = null;
  });

  it('returns the 120ms ease transition + pointer cursor on web', () => {
    replaced = jest.replaceProperty(Platform, 'OS', 'web');
    expect(hoverTransitionStyle(false)).toEqual({
      cursor: 'pointer',
      transitionProperty: 'background-color',
      transitionDuration: `${HOVER_DURATION_MS}ms`,
      transitionTimingFunction: 'ease',
    });
  });

  it('drops the transition (instant highlight) under reduced motion', () => {
    replaced = jest.replaceProperty(Platform, 'OS', 'web');
    expect(hoverTransitionStyle(true)).toEqual({ cursor: 'pointer' });
  });

  it('returns null off web', () => {
    replaced = jest.replaceProperty(Platform, 'OS', 'ios');
    expect(hoverTransitionStyle(false)).toBeNull();
    expect(hoverTransitionStyle(true)).toBeNull();
  });
});

describe('hoverLiftTransitionStyle (PHASE9-DECISIONS P9-2 item 5)', () => {
  let replaced: { restore: () => void } | null = null;

  afterEach(() => {
    replaced?.restore();
    replaced = null;
  });

  it('adds transform + box-shadow at the 160ms hover duration on web', () => {
    replaced = jest.replaceProperty(Platform, 'OS', 'web');
    expect(hoverLiftTransitionStyle(false)).toEqual({
      cursor: 'pointer',
      transitionProperty: 'background-color, transform, box-shadow',
      transitionDuration: `${HOVER_DURATION_MS}ms, ${HOVER_LIFT_DURATION_MS}ms, ${HOVER_LIFT_DURATION_MS}ms`,
      transitionTimingFunction: 'ease',
    });
  });

  it('keeps only the cursor under reduced motion', () => {
    replaced = jest.replaceProperty(Platform, 'OS', 'web');
    expect(hoverLiftTransitionStyle(true)).toEqual({ cursor: 'pointer' });
  });

  it('returns null off web', () => {
    replaced = jest.replaceProperty(Platform, 'OS', 'ios');
    expect(hoverLiftTransitionStyle(false)).toBeNull();
    expect(hoverLiftTransitionStyle(true)).toBeNull();
  });
});

describe('hoverLiftStyle (PHASE9-DECISIONS P9-2 item 5)', () => {
  let replaced: { restore: () => void } | null = null;

  afterEach(() => {
    replaced?.restore();
    replaced = null;
  });

  it('lifts -2dp while hovered on web', () => {
    replaced = jest.replaceProperty(Platform, 'OS', 'web');
    expect(hoverLiftStyle(true, false)).toEqual({
      transform: [{ translateY: -HOVER_LIFT_DISTANCE }],
    });
  });

  it('does not move when idle, reduced, or off web (P9-1)', () => {
    replaced = jest.replaceProperty(Platform, 'OS', 'web');
    expect(hoverLiftStyle(false, false)).toBeNull();
    expect(hoverLiftStyle(true, true)).toBeNull();
    replaced.restore();
    replaced = jest.replaceProperty(Platform, 'OS', 'ios');
    expect(hoverLiftStyle(true, false)).toBeNull();
  });
});
