/**
 * Thin re-export of the shared segmented control (app/src/ui/Segmented.tsx).
 * The kit's SegmentedTabs alias is a drop-in for the previous feature-local
 * implementation (same options/value/onChange contract); the active
 * treatment now follows the theme (`segmentedActive`).
 */
export {
  SegmentedTabs,
  type SegmentedTabsProps,
} from '../../../src/ui/Segmented';
