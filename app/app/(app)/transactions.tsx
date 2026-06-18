/**
 * Transactions tab route. The screen body is owned by the transactions
 * feature (features/transactions/); this file stays a thin typed route
 * binding. The /index import is explicit so Metro never has to consult the
 * feature directory's package.json for directory resolution.
 */
import TransactionsScreen from '../../features/transactions/index';

export default TransactionsScreen;
