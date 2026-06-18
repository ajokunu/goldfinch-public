/**
 * Thin re-export of the shared segmented control (app/src/ui/Segmented.tsx),
 * adopted for the matchType selector in the rule editor (P8-1: feature parts
 * ride the kit primitive -- and its web hover treatment -- rather than
 * hand-rolling). Same options/value/onChange contract as the local copy it
 * replaces.
 */
export {
  SegmentedTabs,
  type SegmentedTabsProps,
} from '../../../src/ui/Segmented';
