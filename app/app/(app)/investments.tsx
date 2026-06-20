/**
 * Investments tab route. The screen body is owned by the investments feature
 * part (features/investments/InvestmentsScreen); this file stays a thin typed
 * route binding. Path: /investments.
 *
 * Note: features/investments/index.tsx remains the per-account detail screen
 * behind /accounts/[accountId]; this aggregate tab is a separate entry so that
 * existing route is untouched.
 */
import InvestmentsScreen from '../../features/investments/InvestmentsScreen';

export default InvestmentsScreen;
