/**
 * Pure shell navigation predicates (design-spec shell.md 2.1 / 4.1 / 10).
 *
 * Zero imports on purpose: this module is exercised directly by node --test
 * (src/ui/test/navActive.test.ts) and is a StrykerJS mutation-testing target
 * ("pure shell logic (e.g. sidebar active-route matching)", shell.md 10).
 *
 * All predicates normalize trailing slashes first because web URLs can carry
 * them ("/more/goals/") while expo-router's native pathnames never do.
 */

/** Collapse trailing slashes; "" and "/" both normalize to "/". */
export function normalizePathname(pathname: string): string {
  let path = pathname;
  // Stripping "/" itself to "" is fine: the final fix-up restores "/", so a
  // length guard here would be a dead shadow of that rule.
  while (path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return path === '' ? '/' : path;
}

/**
 * Tabs whose focused screen shows the add FAB (shell.md 2.1, from the
 * prototype's ['dashboard','transactions','budget']). Detail routes, the
 * Reports tab, and the entire More stack are intentionally absent.
 */
const FAB_PATHNAMES: readonly string[] = Object.freeze([
  '/',
  '/transactions',
  '/budget',
]);

/** True when the focused route should show the floating add button. */
export function isFabPathname(pathname: string): boolean {
  return FAB_PATHNAMES.includes(normalizePathname(pathname));
}

/**
 * Desktop sidebar active-item matching (shell.md 4.1): exact match for '/',
 * prefix match (on path-segment boundaries) for everything else, so
 * '/more/goals' stays lit on any goal detail but '/transactions' does not
 * match a hypothetical '/transactions-export'.
 */
export function isSidebarItemActive(pathname: string, href: string): boolean {
  const path = normalizePathname(pathname);
  const target = normalizePathname(href);
  // No '/' special case: `${'/'}/` is '//', which can never prefix a
  // normalized pathname, so the dashboard item only ever matches exactly.
  return path === target || path.startsWith(`${target}/`);
}

/**
 * expo-router hides `href: null` screens from the tab bar by injecting
 * `tabBarItemStyle: { display: 'none' }` (TabsClient `href` shortcut). A
 * custom tab bar must re-apply that filter itself. Handles nested style
 * arrays without importing StyleSheet so the function stays node-pure.
 */
export function isHiddenTabItemStyle(style: unknown): boolean {
  if (Array.isArray(style)) return style.some(isHiddenTabItemStyle);
  return (
    typeof style === 'object' &&
    style !== null &&
    (style as { display?: unknown }).display === 'none'
  );
}
