/**
 * Motion primitive integration tests (PHASE9-DECISIONS P9-1/P9-3).
 *
 * The suite-wide useReducedMotion mock pins the OS flag to TRUE, so the
 * default path here is the sanctioned accessibility path: every primitive
 * must render its final content immediately (CountUp shows the exact
 * shared-formatted value, Crossfade swaps with no ghost overlay, Stagger
 * children all mount at once). Individual tests flip the store override
 * (reduceAnimations: false) to exercise the full-motion Reanimated path and
 * assert it mounts without crashing and with the same content contract.
 */
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';
import type { MinorUnits } from '@goldfinch/shared/types';

import {
  CountUp,
  Crossfade,
  FadeRise,
  PressableScale,
  Stagger,
} from '../src/ui/motion';
import { useUiStore } from '../src/state/uiStore';
import { renderWithProviders } from './render';

function enableFullMotion(): void {
  useUiStore.setState({ reduceAnimations: false });
}

describe('CountUp', () => {
  it('reduced motion renders the exact shared-formatted value immediately', async () => {
    renderWithProviders(
      <CountUp amountMinor={123456 as MinorUnits} currency="USD" testID="net" />,
    );
    expect(await screen.findByText('$1,234.56')).toBeOnTheScreen();
  });

  it('respects per-currency minor-unit digits (JPY has none)', async () => {
    renderWithProviders(
      <CountUp amountMinor={1235 as MinorUnits} currency="JPY" />,
    );
    expect(await screen.findByText('¥1,235')).toBeOnTheScreen();
  });

  it('updates to the new exact value when the amount changes', async () => {
    // Stateful harness: renderWithProviders composes the provider stack, so
    // value changes must flow through state, not a root rerender.
    function Harness() {
      const [amount, setAmount] = useState(-4599 as MinorUnits);
      return (
        <>
          <CountUp amountMinor={amount} currency="USD" />
          <Pressable
            testID="bump-amount"
            onPress={() => setAmount(1500 as MinorUnits)}
          >
            <Text>bump</Text>
          </Pressable>
        </>
      );
    }
    renderWithProviders(<Harness />);
    expect(await screen.findByText('-$45.99')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('bump-amount'));
    expect(await screen.findByText('$15.00')).toBeOnTheScreen();
    expect(screen.queryByText('-$45.99')).toBeNull();
  });

  it('degrades to a logged raw fallback on a malformed runtime amount', async () => {
    // The logger reports through console.error; keep the suite output clean
    // and assert the failure path actually fired.
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      renderWithProviders(
        <CountUp amountMinor={12.5 as MinorUnits} currency="USD" />,
      );
      expect(await screen.findByText('12.5 USD')).toBeOnTheScreen();
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('full motion renders rolling digit columns labeled with the exact value', async () => {
    enableFullMotion();
    renderWithProviders(
      <CountUp amountMinor={9042 as MinorUnits} currency="USD" testID="roll" />,
    );
    const row = await screen.findByTestId('roll');
    expect(row.props.accessibilityLabel).toBe('$90.42');
    // The static glyphs render directly; the digits render as 0-9 strips.
    expect(screen.getByText('$')).toBeOnTheScreen();
    expect(screen.getByText('.')).toBeOnTheScreen();
    // Four digit columns, each containing one full strip (one '7' per strip).
    expect(screen.getAllByText('7')).toHaveLength(4);
  });
});

describe('FadeRise', () => {
  it('renders its children (reduced motion: final state immediately)', async () => {
    renderWithProviders(
      <FadeRise testID="fade-rise">
        <Text>greeting</Text>
      </FadeRise>,
    );
    expect(await screen.findByText('greeting')).toBeOnTheScreen();
  });

  it('renders under full motion without crashing the worklet path', async () => {
    enableFullMotion();
    renderWithProviders(
      <FadeRise delay={45}>
        <Text>animated greeting</Text>
      </FadeRise>,
    );
    expect(await screen.findByText('animated greeting')).toBeOnTheScreen();
  });
});

describe('Stagger', () => {
  it('mounts every child immediately under reduced motion', async () => {
    renderWithProviders(
      <Stagger>
        <Text>card one</Text>
        <Text>card two</Text>
        <Text>card three</Text>
      </Stagger>,
    );
    expect(await screen.findByText('card one')).toBeOnTheScreen();
    expect(screen.getByText('card two')).toBeOnTheScreen();
    expect(screen.getByText('card three')).toBeOnTheScreen();
  });

  it('mounts every child under full motion (delays never drop content)', async () => {
    enableFullMotion();
    renderWithProviders(
      <Stagger intervalMs={45}>
        <Text>first</Text>
        <Text>second</Text>
      </Stagger>,
    );
    expect(await screen.findByText('first')).toBeOnTheScreen();
    expect(screen.getByText('second')).toBeOnTheScreen();
  });
});

describe('Crossfade', () => {
  /** Switches both stateKey and content when pressed. */
  function KeySwitchHarness() {
    const [page, setPage] = useState<'home' | 'reports'>('home');
    return (
      <>
        <Crossfade stateKey={page}>
          <Text>{page === 'home' ? 'home content' : 'reports content'}</Text>
        </Crossfade>
        <Pressable testID="switch-page" onPress={() => setPage('reports')}>
          <Text>switch</Text>
        </Pressable>
      </>
    );
  }

  /** Same stateKey, new content. */
  function ContentUpdateHarness() {
    const [version, setVersion] = useState(1);
    return (
      <>
        <Crossfade stateKey="home">
          <Text>{`v${version}`}</Text>
        </Crossfade>
        <Pressable testID="update-content" onPress={() => setVersion(2)}>
          <Text>update</Text>
        </Pressable>
      </>
    );
  }

  it('reduced motion swaps content instantly with no ghost overlay', async () => {
    renderWithProviders(<KeySwitchHarness />);
    expect(await screen.findByText('home content')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('switch-page'));
    expect(await screen.findByText('reports content')).toBeOnTheScreen();
    // Exactly one copy: the outgoing layer must never mount when reduced.
    expect(screen.queryByText('home content')).toBeNull();
  });

  it('same-key re-renders update content in place', async () => {
    renderWithProviders(<ContentUpdateHarness />);
    expect(await screen.findByText('v1')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('update-content'));
    expect(await screen.findByText('v2')).toBeOnTheScreen();
    expect(screen.queryByText('v1')).toBeNull();
  });
});

describe('PressableScale', () => {
  it('fires press handlers through the animated wrapper', async () => {
    const onPress = jest.fn();
    renderWithProviders(
      <PressableScale onPress={onPress} testID="press-scale">
        <Text>press me</Text>
      </PressableScale>,
    );
    const pressable = await screen.findByTestId('press-scale');
    fireEvent(pressable, 'pressIn');
    fireEvent.press(pressable);
    fireEvent(pressable, 'pressOut');
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('handles press feedback under full motion (spring path) without crashing', async () => {
    enableFullMotion();
    const onPress = jest.fn();
    renderWithProviders(
      <PressableScale onPress={onPress} testID="press-spring">
        <Text>spring press</Text>
      </PressableScale>,
    );
    const pressable = await screen.findByTestId('press-spring');
    fireEvent(pressable, 'pressIn');
    fireEvent(pressable, 'pressOut');
    fireEvent.press(pressable);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
