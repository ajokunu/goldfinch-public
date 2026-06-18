/**
 * Import route (P7-6). The screen body is owned by the import feature
 * (features/import/): CSV file pick, column mapping with preview, manual
 * account creation, batched import with progress, and the per-row report.
 * The /index import is explicit so Metro never has to consult the feature
 * directory's package.json for directory resolution.
 */
import ImportScreen from '../../../features/import/index';

export default ImportScreen;
