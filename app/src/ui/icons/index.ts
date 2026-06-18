/**
 * Identity icon system barrel (ops/design-spec/icons.md): CategoryIcon /
 * CategoryGlyph and AccountTypeIcon for every category or account identity
 * slot, plus the curated phosphor glyph set for non-category identity wells
 * (recurring bill/income). Lucide remains chrome-only (chevrons, close, tab
 * bar); feature code imports identity glyphs from here, never from
 * phosphor-react-native directly.
 */
export {
  AccountTypeIcon,
  ACCOUNT_TYPE_ICON_GLYPHS,
  accountTypeGlyph,
  type AccountTypeIconProps,
} from './AccountTypeIcon';
export {
  CategoryGlyph,
  CategoryIcon,
  type CategoryGlyphProps,
  type CategoryIconProps,
} from './CategoryIcon';
export {
  CATEGORY_FALLBACK_RULES,
  CATEGORY_ICONS,
  DEFAULT_CATEGORY_ICON,
  resolveCategoryIcon,
  slugifyCategoryKey,
  UNCATEGORIZED_ICON,
} from './categoryIconMap';
export { resolveCategoryGlyph } from './resolveCategoryGlyph';
export * from './glyphs';
