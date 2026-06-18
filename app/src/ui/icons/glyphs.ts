/**
 * The ONLY module allowed to deep-import phosphor-react-native icons
 * (ops/design-spec/icons.md section 3): per-icon `src/icons/<Name>` imports
 * are the package's documented tree-shake path (an explicit `exports` entry),
 * so the bundle carries exactly the glyphs mapped here and feature code never
 * spells a deep import. Identity icons render in the duotone weight; lucide
 * stays for utilitarian chrome only.
 *
 * Type-only re-exports from the package root are erased at compile time and
 * do not pull the full icon barrel into the bundle.
 */
export type {
  Icon as PhosphorIcon,
  IconProps as PhosphorIconProps,
  IconWeight,
} from 'phosphor-react-native';

// Category identity (icons.md section 5).
export { AirplaneTiltIcon } from 'phosphor-react-native/src/icons/AirplaneTilt';
export { ArrowsClockwiseIcon } from 'phosphor-react-native/src/icons/ArrowsClockwise';
export { ArrowsLeftRightIcon } from 'phosphor-react-native/src/icons/ArrowsLeftRight';
export { BarbellIcon } from 'phosphor-react-native/src/icons/Barbell';
export { BasketIcon } from 'phosphor-react-native/src/icons/Basket';
export { BroomIcon } from 'phosphor-react-native/src/icons/Broom';
export { BusIcon } from 'phosphor-react-native/src/icons/Bus';
export { CarIcon } from 'phosphor-react-native/src/icons/Car';
export { CoffeeIcon } from 'phosphor-react-native/src/icons/Coffee';
export { CreditCardIcon } from 'phosphor-react-native/src/icons/CreditCard';
export { DevicesIcon } from 'phosphor-react-native/src/icons/Devices';
export { FilmSlateIcon } from 'phosphor-react-native/src/icons/FilmSlate';
export { FirstAidKitIcon } from 'phosphor-react-native/src/icons/FirstAidKit';
export { ForkKnifeIcon } from 'phosphor-react-native/src/icons/ForkKnife';
export { GarageIcon } from 'phosphor-react-native/src/icons/Garage';
export { GasPumpIcon } from 'phosphor-react-native/src/icons/GasPump';
export { GiftIcon } from 'phosphor-react-native/src/icons/Gift';
export { GraduationCapIcon } from 'phosphor-react-native/src/icons/GraduationCap';
export { HandCoinsIcon } from 'phosphor-react-native/src/icons/HandCoins';
export { HouseIcon } from 'phosphor-react-native/src/icons/House';
export { LightbulbIcon } from 'phosphor-react-native/src/icons/Lightbulb';
export { MoneyIcon } from 'phosphor-react-native/src/icons/Money';
export { PawPrintIcon } from 'phosphor-react-native/src/icons/PawPrint';
export { PercentIcon } from 'phosphor-react-native/src/icons/Percent';
export { ReceiptXIcon } from 'phosphor-react-native/src/icons/ReceiptX';
export { ScissorsIcon } from 'phosphor-react-native/src/icons/Scissors';
export { ShapesIcon } from 'phosphor-react-native/src/icons/Shapes';
export { ShieldCheckIcon } from 'phosphor-react-native/src/icons/ShieldCheck';
export { ShoppingBagIcon } from 'phosphor-react-native/src/icons/ShoppingBag';
export { TShirtIcon } from 'phosphor-react-native/src/icons/TShirt';
export { WifiHighIcon } from 'phosphor-react-native/src/icons/WifiHigh';

// Fallback-rule extras for user-created categories (icons.md section 4).
export { BabyIcon } from 'phosphor-react-native/src/icons/Baby';
export { ChartLineUpIcon } from 'phosphor-react-native/src/icons/ChartLineUp';
export { MusicNotesIcon } from 'phosphor-react-native/src/icons/MusicNotes';
export { WrenchIcon } from 'phosphor-react-native/src/icons/Wrench';

// Phase 10 (P10-2) common-user-category picker spread. These are pickable-only
// identity glyphs: the curated icon picker maps each GLYPH_KEYS entry to a
// component below; no keyword auto-fallback references them.
export { BookIcon } from 'phosphor-react-native/src/icons/Book';
export { CakeIcon } from 'phosphor-react-native/src/icons/Cake';
export { GameControllerIcon } from 'phosphor-react-native/src/icons/GameController';
export { HamburgerIcon } from 'phosphor-react-native/src/icons/Hamburger';
export { HeartIcon } from 'phosphor-react-native/src/icons/Heart';
export { LeafIcon } from 'phosphor-react-native/src/icons/Leaf';
export { PhoneIcon } from 'phosphor-react-native/src/icons/Phone';
export { TicketIcon } from 'phosphor-react-native/src/icons/Ticket';
export { WineIcon } from 'phosphor-react-native/src/icons/Wine';

// Resolution terminals.
export { CircleDashedIcon } from 'phosphor-react-native/src/icons/CircleDashed';
export { TagIcon } from 'phosphor-react-native/src/icons/Tag';

// Account types (icons.md section 4; P8-4 full AccountTypeId set --
// CreditCard / ChartLineUp / HandCoins / Money are already exported above).
export { BankIcon } from 'phosphor-react-native/src/icons/Bank';
export { BriefcaseIcon } from 'phosphor-react-native/src/icons/Briefcase';
export { PiggyBankIcon } from 'phosphor-react-native/src/icons/PiggyBank';
export { WalletIcon } from 'phosphor-react-native/src/icons/Wallet';

// Recurring identity (bill / expected income wells).
export { ArrowCircleDownIcon } from 'phosphor-react-native/src/icons/ArrowCircleDown';
export { RepeatIcon } from 'phosphor-react-native/src/icons/Repeat';

// ---------------------------------------------------------------------------
// P10-2 — the curated, searchable category glyph map (THE icon picker source)
// ---------------------------------------------------------------------------
//
// Local imports (same allowed deep-import module) so the curated map can bind
// the components as VALUES. These names are re-exported above for the rest of
// the icon system; importing them here from the package directly keeps this
// the single phosphor deep-import site without a re-export/import name clash.
import { AirplaneTiltIcon as AirplaneTilt } from 'phosphor-react-native/src/icons/AirplaneTilt';
import { ArrowsClockwiseIcon as ArrowsClockwise } from 'phosphor-react-native/src/icons/ArrowsClockwise';
import { ArrowsLeftRightIcon as ArrowsLeftRight } from 'phosphor-react-native/src/icons/ArrowsLeftRight';
import { BabyIcon as Baby } from 'phosphor-react-native/src/icons/Baby';
import { BarbellIcon as Barbell } from 'phosphor-react-native/src/icons/Barbell';
import { BasketIcon as Basket } from 'phosphor-react-native/src/icons/Basket';
import { BookIcon as Book } from 'phosphor-react-native/src/icons/Book';
import { BroomIcon as Broom } from 'phosphor-react-native/src/icons/Broom';
import { BusIcon as Bus } from 'phosphor-react-native/src/icons/Bus';
import { CakeIcon as Cake } from 'phosphor-react-native/src/icons/Cake';
import { CarIcon as Car } from 'phosphor-react-native/src/icons/Car';
import { ChartLineUpIcon as ChartLineUp } from 'phosphor-react-native/src/icons/ChartLineUp';
import { CircleDashedIcon as CircleDashed } from 'phosphor-react-native/src/icons/CircleDashed';
import { CoffeeIcon as Coffee } from 'phosphor-react-native/src/icons/Coffee';
import { CreditCardIcon as CreditCard } from 'phosphor-react-native/src/icons/CreditCard';
import { DevicesIcon as Devices } from 'phosphor-react-native/src/icons/Devices';
import { FilmSlateIcon as FilmSlate } from 'phosphor-react-native/src/icons/FilmSlate';
import { FirstAidKitIcon as FirstAidKit } from 'phosphor-react-native/src/icons/FirstAidKit';
import { ForkKnifeIcon as ForkKnife } from 'phosphor-react-native/src/icons/ForkKnife';
import { GameControllerIcon as GameController } from 'phosphor-react-native/src/icons/GameController';
import { GarageIcon as Garage } from 'phosphor-react-native/src/icons/Garage';
import { GasPumpIcon as GasPump } from 'phosphor-react-native/src/icons/GasPump';
import { GiftIcon as Gift } from 'phosphor-react-native/src/icons/Gift';
import { GraduationCapIcon as GraduationCap } from 'phosphor-react-native/src/icons/GraduationCap';
import { HamburgerIcon as Hamburger } from 'phosphor-react-native/src/icons/Hamburger';
import { HandCoinsIcon as HandCoins } from 'phosphor-react-native/src/icons/HandCoins';
import { HeartIcon as Heart } from 'phosphor-react-native/src/icons/Heart';
import { HouseIcon as House } from 'phosphor-react-native/src/icons/House';
import { LeafIcon as Leaf } from 'phosphor-react-native/src/icons/Leaf';
import { LightbulbIcon as Lightbulb } from 'phosphor-react-native/src/icons/Lightbulb';
import { MoneyIcon as Money } from 'phosphor-react-native/src/icons/Money';
import { MusicNotesIcon as MusicNotes } from 'phosphor-react-native/src/icons/MusicNotes';
import { PawPrintIcon as PawPrint } from 'phosphor-react-native/src/icons/PawPrint';
import { PercentIcon as Percent } from 'phosphor-react-native/src/icons/Percent';
import { PhoneIcon as Phone } from 'phosphor-react-native/src/icons/Phone';
import { PiggyBankIcon as PiggyBank } from 'phosphor-react-native/src/icons/PiggyBank';
import { ReceiptXIcon as ReceiptX } from 'phosphor-react-native/src/icons/ReceiptX';
import { ScissorsIcon as Scissors } from 'phosphor-react-native/src/icons/Scissors';
import { ShapesIcon as Shapes } from 'phosphor-react-native/src/icons/Shapes';
import { ShieldCheckIcon as ShieldCheck } from 'phosphor-react-native/src/icons/ShieldCheck';
import { ShoppingBagIcon as ShoppingBag } from 'phosphor-react-native/src/icons/ShoppingBag';
import { TagIcon as Tag } from 'phosphor-react-native/src/icons/Tag';
import { TicketIcon as Ticket } from 'phosphor-react-native/src/icons/Ticket';
import { TShirtIcon as TShirt } from 'phosphor-react-native/src/icons/TShirt';
import { WifiHighIcon as WifiHigh } from 'phosphor-react-native/src/icons/WifiHigh';
import { WineIcon as Wine } from 'phosphor-react-native/src/icons/Wine';
import { WrenchIcon as Wrench } from 'phosphor-react-native/src/icons/Wrench';

import { GLYPH_KEYS, type GlyphKey } from '@goldfinch/shared/categoryStyle';

import type { Icon as PhosphorIconValue } from 'phosphor-react-native';

/** Picker search metadata for a curated glyph (P10-2 label + keywords). */
export interface GlyphMeta {
  /** The curated glyph component (duotone identity weight at render). */
  readonly glyph: PhosphorIconValue;
  /** Human label shown under the swatch / used as the accessibility label. */
  readonly label: string;
  /** Lowercase search terms the picker filters on (label is searched too). */
  readonly keywords: readonly string[];
}

/**
 * THE curated glyph map (P10-2), keyed EXACTLY to the shared `GLYPH_KEYS`
 * contract from `@goldfinch/shared/categoryStyle`. Typed as a total
 * `Record<GlyphKey, GlyphMeta>`, so a key added to the shared contract without
 * a glyph here is a COMPILE error (never a blank well); the load-time assertion
 * below additionally pins the runtime key set equal to `GLYPH_KEYS` so neither
 * extra nor missing keys can ship. This is the app side of the cross-workspace
 * glyph contract the API's `isGlyphKey` validates against.
 */
export const GLYPH_MAP: Readonly<Record<GlyphKey, GlyphMeta>> = {
  money: { glyph: Money, label: 'Money', keywords: ['paycheck', 'income', 'cash', 'salary', 'bill'] },
  'hand-coins': { glyph: HandCoins, label: 'Hand coins', keywords: ['income', 'loan', 'debt', 'payout', 'tip'] },
  basket: { glyph: Basket, label: 'Basket', keywords: ['groceries', 'grocery', 'market', 'supermarket', 'food'] },
  'fork-knife': { glyph: ForkKnife, label: 'Fork & knife', keywords: ['dining', 'restaurant', 'food', 'meal', 'dinner'] },
  coffee: { glyph: Coffee, label: 'Coffee', keywords: ['cafe', 'espresso', 'latte', 'tea', 'drink'] },
  house: { glyph: House, label: 'House', keywords: ['rent', 'mortgage', 'home', 'housing', 'apartment'] },
  lightbulb: { glyph: Lightbulb, label: 'Lightbulb', keywords: ['utilities', 'electric', 'power', 'energy', 'bill'] },
  'wifi-high': { glyph: WifiHigh, label: 'Wi-Fi', keywords: ['internet', 'broadband', 'wifi', 'network', 'connection'] },
  broom: { glyph: Broom, label: 'Broom', keywords: ['home supplies', 'cleaning', 'chores', 'household'] },
  'gas-pump': { glyph: GasPump, label: 'Gas pump', keywords: ['gas', 'fuel', 'petrol', 'diesel', 'station'] },
  car: { glyph: Car, label: 'Car', keywords: ['auto', 'vehicle', 'transport', 'driving', 'commute'] },
  garage: { glyph: Garage, label: 'Garage', keywords: ['parking', 'toll', 'garage', 'lot'] },
  bus: { glyph: Bus, label: 'Bus', keywords: ['transit', 'rideshare', 'train', 'metro', 'subway', 'taxi'] },
  'shopping-bag': { glyph: ShoppingBag, label: 'Shopping bag', keywords: ['shopping', 'store', 'retail', 'purchase', 'bag'] },
  't-shirt': { glyph: TShirt, label: 'T-shirt', keywords: ['clothing', 'apparel', 'fashion', 'clothes', 'wardrobe'] },
  devices: { glyph: Devices, label: 'Devices', keywords: ['electronics', 'tech', 'gadget', 'computer', 'phone'] },
  'arrows-clockwise': { glyph: ArrowsClockwise, label: 'Subscriptions', keywords: ['subscription', 'recurring', 'membership', 'renew', 'streaming'] },
  'film-slate': { glyph: FilmSlate, label: 'Film slate', keywords: ['entertainment', 'movie', 'film', 'cinema', 'show'] },
  'airplane-tilt': { glyph: AirplaneTilt, label: 'Airplane', keywords: ['travel', 'flight', 'vacation', 'trip', 'plane'] },
  'first-aid-kit': { glyph: FirstAidKit, label: 'First-aid kit', keywords: ['health', 'medical', 'doctor', 'pharmacy', 'care'] },
  barbell: { glyph: Barbell, label: 'Barbell', keywords: ['fitness', 'gym', 'workout', 'exercise', 'sport'] },
  scissors: { glyph: Scissors, label: 'Scissors', keywords: ['personal care', 'haircut', 'salon', 'beauty', 'grooming'] },
  'shield-check': { glyph: ShieldCheck, label: 'Shield', keywords: ['insurance', 'protection', 'coverage', 'security', 'safety'] },
  'receipt-x': { glyph: ReceiptX, label: 'Receipt', keywords: ['fees', 'charge', 'penalty', 'fine', 'service charge'] },
  percent: { glyph: Percent, label: 'Percent', keywords: ['taxes', 'tax', 'interest', 'rate', 'discount'] },
  gift: { glyph: Gift, label: 'Gift', keywords: ['gifts', 'donation', 'charity', 'present', 'giving'] },
  'paw-print': { glyph: PawPrint, label: 'Paw print', keywords: ['pets', 'pet', 'dog', 'cat', 'vet', 'animal'] },
  'graduation-cap': { glyph: GraduationCap, label: 'Graduation cap', keywords: ['education', 'school', 'tuition', 'course', 'study'] },
  'credit-card': { glyph: CreditCard, label: 'Credit card', keywords: ['credit card', 'payment', 'card', 'debt', 'statement'] },
  'arrows-left-right': { glyph: ArrowsLeftRight, label: 'Transfer', keywords: ['transfer', 'move', 'between accounts', 'exchange'] },
  shapes: { glyph: Shapes, label: 'Shapes', keywords: ['miscellaneous', 'misc', 'other', 'general', 'uncategorized'] },
  baby: { glyph: Baby, label: 'Baby', keywords: ['kids', 'child', 'children', 'baby', 'childcare', 'family'] },
  'chart-line-up': { glyph: ChartLineUp, label: 'Chart up', keywords: ['savings', 'investing', 'investment', 'growth', 'stocks'] },
  'music-notes': { glyph: MusicNotes, label: 'Music', keywords: ['music', 'song', 'concert', 'audio', 'streaming'] },
  wrench: { glyph: Wrench, label: 'Wrench', keywords: ['repairs', 'maintenance', 'fix', 'tools', 'handyman'] },
  'circle-dashed': { glyph: CircleDashed, label: 'Uncategorized', keywords: ['uncategorized', 'none', 'unassigned', 'blank'] },
  tag: { glyph: Tag, label: 'Tag', keywords: ['generic', 'label', 'default', 'category', 'misc'] },
  heart: { glyph: Heart, label: 'Heart', keywords: ['health', 'love', 'relationship', 'charity', 'wellness', 'favorite'] },
  book: { glyph: Book, label: 'Book', keywords: ['books', 'reading', 'education', 'study', 'library'] },
  'game-controller': { glyph: GameController, label: 'Game controller', keywords: ['gaming', 'games', 'video games', 'console', 'play'] },
  phone: { glyph: Phone, label: 'Phone', keywords: ['phone', 'mobile', 'call', 'cell', 'telephone'] },
  leaf: { glyph: Leaf, label: 'Leaf', keywords: ['nature', 'garden', 'yard', 'plants', 'sustainability', 'eco'] },
  ticket: { glyph: Ticket, label: 'Ticket', keywords: ['events', 'ticket', 'concert', 'show', 'admission'] },
  'piggy-bank': { glyph: PiggyBank, label: 'Piggy bank', keywords: ['savings', 'goal', 'save', 'fund', 'nest egg'] },
  cake: { glyph: Cake, label: 'Cake', keywords: ['celebration', 'birthday', 'party', 'dessert', 'anniversary'] },
  hamburger: { glyph: Hamburger, label: 'Burger', keywords: ['fast food', 'burger', 'takeout', 'lunch', 'snack'] },
  wine: { glyph: Wine, label: 'Wine', keywords: ['drinks', 'bar', 'alcohol', 'wine', 'happy hour'] },
};

/**
 * Load-time CONTRACT ASSERTION (P10-2): the curated map's runtime key set MUST
 * equal the shared `GLYPH_KEYS` array exactly — no missing keys (a validated
 * `iconKey` that renders blank) and no extra keys (a glyph the API would reject
 * as a 400). The `Record<GlyphKey, …>` type already forbids both at compile
 * time; this guards against a drift the type system cannot see (e.g. a key
 * cast or a future refactor), failing fast at module load instead of on a
 * silent blank well. This is the ONLY place the two sides are pinned in the
 * app; the shared package's own parity test pins the API side.
 */
const mapKeys = Object.keys(GLYPH_MAP);
const missing = GLYPH_KEYS.filter((key) => !(key in GLYPH_MAP));
const extra = mapKeys.filter((key) => !(GLYPH_KEYS as readonly string[]).includes(key));
if (missing.length > 0 || extra.length > 0) {
  throw new Error(
    `glyphs.ts GLYPH_MAP drifted from shared GLYPH_KEYS — ` +
      `missing: [${missing.join(', ')}], extra: [${extra.join(', ')}]`,
  );
}
