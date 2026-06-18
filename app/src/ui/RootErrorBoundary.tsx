/**
 * Last-resort error boundary above the provider stack. A render crash anywhere
 * below would otherwise paint a blank screen (the worst possible failure mode
 * to diagnose in the field); this renders a readable error card and logs the
 * componentStack. Deliberately theme-independent: the ThemeProvider itself is
 * inside the boundary, so only hardcoded neutral styling is safe here.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { logger } from '../lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string;
}

export class RootErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? 'unavailable';
    logger.error('root render crash', { error, componentStack });
    this.setState({ componentStack });
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
        <Text style={styles.title}>GoldFinch hit an unexpected error</Text>
        <Text style={styles.message}>
          {this.state.error.name}: {this.state.error.message}
        </Text>
        <Text style={styles.stack} selectable>
          {(this.state.error.stack ?? '').split('\n').slice(0, 4).join('\n')}
        </Text>
        <Text style={styles.stack} selectable>
          {this.state.componentStack
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .slice(0, 12)
            .join('\n')}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={this.reset}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111417' },
  body: { padding: 24, paddingTop: 80, gap: 14 },
  title: { color: '#E8ECEA', fontSize: 20, fontWeight: '700' },
  message: { color: '#FF8A8A', fontSize: 14, fontFamily: 'monospace' },
  stack: { color: '#8A9499', fontSize: 11, fontFamily: 'monospace' },
  button: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#C6F24E',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  buttonText: { color: '#0A0C0B', fontSize: 15, fontWeight: '600' },
});
