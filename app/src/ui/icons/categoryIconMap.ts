/**
 * Category id/name -> identity glyph resolution (ops/design-spec/icons.md
 * section 4). Pure module: no react, no react-native -- only glyph component
 * references, so the mapping is unit-testable in isolation.
 *
 * Resolution order, all over the server's slug normalization (category ids
 * ARE name slugs, services/api/src/routes/categories.ts):
 *   1. exact slug match against the 31 live categories;
 *   2. ordered keyword rules (user-created categories like "Craft Coffee");
 *   3. `Tag` default. Null/undefined input is the uncategorized bucket and
 *      resolves to `CircleDashed`.
 */
import {
  AirplaneTiltIcon,
  ArrowsClockwiseIcon,
  ArrowsLeftRightIcon,
  BabyIcon,
  BarbellIcon,
  BasketIcon,
  BroomIcon,
  BusIcon,
  CarIcon,
  ChartLineUpIcon,
  CircleDashedIcon,
  CoffeeIcon,
  CreditCardIcon,
  DevicesIcon,
  FilmSlateIcon,
  FirstAidKitIcon,
  ForkKnifeIcon,
  GarageIcon,
  GasPumpIcon,
  GiftIcon,
  GraduationCapIcon,
  HandCoinsIcon,
  HouseIcon,
  LightbulbIcon,
  MoneyIcon,
  MusicNotesIcon,
  PawPrintIcon,
  PercentIcon,
  ReceiptXIcon,
  ScissorsIcon,
  ShapesIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  TagIcon,
  TShirtIcon,
  WifiHighIcon,
  WrenchIcon,
  type PhosphorIcon,
} from './glyphs';

/**
 * Client mirror of the server's `slugifyCategoryName` (categories route),
 * minus the throw: an input that produces no usable slug falls through to
 * the default glyph instead of erroring inside a render.
 */
export function slugifyCategoryKey(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The 32 live categories (icons.md section 5), keyed by stable slug id. */
export const CATEGORY_ICONS: Readonly<Record<string, PhosphorIcon>> = {
  paycheck: MoneyIcon,
  'other-income': HandCoinsIcon,
  'retirement-contributions': ChartLineUpIcon,
  groceries: BasketIcon,
  'dining-drinks': ForkKnifeIcon,
  'coffee-shops': CoffeeIcon,
  'rent-mortgage': HouseIcon,
  utilities: LightbulbIcon,
  'internet-phone': WifiHighIcon,
  'home-supplies': BroomIcon,
  'gas-fuel': GasPumpIcon,
  'auto-transport': CarIcon,
  'parking-tolls': GarageIcon,
  'rideshare-transit': BusIcon,
  shopping: ShoppingBagIcon,
  clothing: TShirtIcon,
  electronics: DevicesIcon,
  subscriptions: ArrowsClockwiseIcon,
  entertainment: FilmSlateIcon,
  'travel-vacation': AirplaneTiltIcon,
  'health-medical': FirstAidKitIcon,
  fitness: BarbellIcon,
  'personal-care': ScissorsIcon,
  insurance: ShieldCheckIcon,
  'fees-charges': ReceiptXIcon,
  taxes: PercentIcon,
  'gifts-donations': GiftIcon,
  pets: PawPrintIcon,
  education: GraduationCapIcon,
  'credit-card-payment': CreditCardIcon,
  transfers: ArrowsLeftRightIcon,
  miscellaneous: ShapesIcon,
};

/** Uncategorized bucket (null/undefined category id). */
export const UNCATEGORIZED_ICON: PhosphorIcon = CircleDashedIcon;

/** Terminal fallback when nothing matches a user-created category. */
export const DEFAULT_CATEGORY_ICON: PhosphorIcon = TagIcon;

interface CategoryIconRule {
  readonly pattern: RegExp;
  readonly icon: PhosphorIcon;
}

/**
 * Ordered keyword rules over the slug; first match wins. Hyphens are
 * non-word characters, so `\b` anchors at slug-token edges. Order matters
 * where stems overlap (transit terms before `tax`, exact `pet` before the
 * petrol-shaped prefixes, etc.).
 */
export const CATEGORY_FALLBACK_RULES: readonly CategoryIconRule[] = [
  { pattern: /\b(coffee|cafe|espresso)/, icon: CoffeeIcon },
  { pattern: /\b(grocer|supermarket|market)/, icon: BasketIcon },
  {
    pattern: /\b(dining|restaurant|food|drink|takeout|lunch|dinner)|\bbars?\b/,
    icon: ForkKnifeIcon,
  },
  { pattern: /\b(rent|mortgage|housing|home|house|apartment)/, icon: HouseIcon },
  { pattern: /\b(utilit|electric|water|power|sewer|trash)/, icon: LightbulbIcon },
  { pattern: /\b(internet|phone|mobile|wifi|broadband|cell)/, icon: WifiHighIcon },
  { pattern: /\b(gas|fuel|petrol)/, icon: GasPumpIcon },
  { pattern: /\b(parking|toll|garage)/, icon: GarageIcon },
  {
    pattern: /\b(taxi|uber|lyft|rideshare|transit|bus|train|metro|subway)/,
    icon: BusIcon,
  },
  { pattern: /\b(car|cars|auto|vehicle)\b/, icon: CarIcon },
  { pattern: /\b(shop|store|amazon)/, icon: ShoppingBagIcon },
  { pattern: /\b(cloth|apparel|fashion|shoe)/, icon: TShirtIcon },
  { pattern: /\b(electronic|computer|tech|gadget|device)/, icon: DevicesIcon },
  { pattern: /\b(subscript|membership|stream)/, icon: ArrowsClockwiseIcon },
  { pattern: /\b(entertain|movie|film|game|concert)/, icon: FilmSlateIcon },
  { pattern: /\bmusic/, icon: MusicNotesIcon },
  { pattern: /\b(travel|vacation|flight|hotel|trip|airfare)/, icon: AirplaneTiltIcon },
  {
    pattern: /\b(health|medical|doctor|dentist|dental|pharma|therapy)/,
    icon: FirstAidKitIcon,
  },
  { pattern: /\b(fitness|gym|sport|yoga)/, icon: BarbellIcon },
  { pattern: /\binsurance/, icon: ShieldCheckIcon },
  { pattern: /\b(fee|fees|charge|fine|penalt)/, icon: ReceiptXIcon },
  { pattern: /\btax(es)?\b/, icon: PercentIcon },
  { pattern: /\b(gift|donat|charity|tithe)/, icon: GiftIcon },
  { pattern: /\b(pet|pets|vet|dog|cat)\b/, icon: PawPrintIcon },
  { pattern: /\b(educat|school|tuition|course|book)/, icon: GraduationCapIcon },
  { pattern: /\b(kid|baby|child)/, icon: BabyIcon },
  { pattern: /\bcredit/, icon: CreditCardIcon },
  { pattern: /\btransfer/, icon: ArrowsLeftRightIcon },
  {
    pattern: /\b(income|salary|paycheck|payroll|wage|bonus|interest)/,
    icon: MoneyIcon,
  },
  { pattern: /\b(saving|invest)/, icon: ChartLineUpIcon },
  { pattern: /\b(repair|maintenance)/, icon: WrenchIcon },
  { pattern: /\b(personal|beauty|salon|hair|spa)/, icon: ScissorsIcon },
  { pattern: /\b(loan|debt)/, icon: HandCoinsIcon },
];

/**
 * Resolve a category to its identity glyph. Pass the id (preferred; live ids
 * are name slugs) and optionally the display name -- the name is a second
 * chance for both the exact and keyword passes, never the first.
 */
export function resolveCategoryIcon(
  categoryId?: string | null,
  categoryName?: string | null,
): PhosphorIcon {
  const keys: string[] = [];
  for (const raw of [categoryId, categoryName]) {
    if (typeof raw === 'string' && raw.length > 0) {
      const slug = slugifyCategoryKey(raw);
      if (slug.length > 0 && !keys.includes(slug)) keys.push(slug);
    }
  }
  if (keys.length === 0) return UNCATEGORIZED_ICON;
  for (const key of keys) {
    const exact = CATEGORY_ICONS[key];
    if (exact) return exact;
  }
  for (const key of keys) {
    for (const rule of CATEGORY_FALLBACK_RULES) {
      if (rule.pattern.test(key)) return rule.icon;
    }
  }
  return DEFAULT_CATEGORY_ICON;
}
