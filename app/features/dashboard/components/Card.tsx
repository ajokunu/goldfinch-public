/**
 * Thin re-export of the promoted shared card surface (components.md: the
 * feature copies keep their paths as re-exports of app/src/ui/Card so every
 * dashboard section picks up the direction-aware card treatment -- themed
 * border width, radius.card, optional small shadow, display/caps title --
 * without import churn).
 */
export {
  Card,
  CardHeader,
  type CardProps,
  type CardHeaderProps,
} from '../../../src/ui/Card';
