/**
 * Rules route (P7-5). Thin typed route binding; the screen body is owned by
 * the rules feature (features/rules/). The /index import is explicit so
 * Metro never has to consult the feature directory's package.json for
 * directory resolution.
 */
import RulesScreen from '../../../features/rules/index';

export default RulesScreen;
