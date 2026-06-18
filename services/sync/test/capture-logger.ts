/**
 * Test logger that captures every emitted JSON line, parsed, so suites can
 * assert on level/msg/fields (P7-10: loud failure paths are part of the
 * contract and therefore part of the tests).
 */

import { createLogger, type Logger, type LogLevel } from '@goldfinch/shared/logger';

export interface CapturedLogger {
  logger: Logger;
  lines: Array<Record<string, unknown>>;
  /** All captured lines at one level. */
  atLevel(level: LogLevel): Array<Record<string, unknown>>;
}

export function captureLogger(): CapturedLogger {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger({
    level: 'debug',
    sink: (_level, line) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  });
  return {
    logger,
    lines,
    atLevel: (level) => lines.filter((entry) => entry.level === level),
  };
}
