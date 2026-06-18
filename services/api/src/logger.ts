/**
 * Module-scope structured logger for the app API Lambda (P7-10). Every error
 * path in this service logs through this instance — JSON lines that CloudWatch
 * Logs Insights can filter on `level`.
 */

import { createLogger, type Logger } from '@goldfinch/shared/logger';

export const logger: Logger = createLogger({ base: { service: 'api' } });
