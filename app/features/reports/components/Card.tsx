/**
 * Thin re-export of the promoted shared Card (app/src/ui/Card.tsx). The
 * reports feature's original copy was byte-identical in API; the shared kit
 * version adds the direction-aware restyle (themed border width, radius.card,
 * small shadow where the theme says so, display vs caps title treatment).
 */
export { Card, CardHeader } from '../../../src/ui/Card';
export type { CardHeaderProps, CardProps } from '../../../src/ui/Card';
