/**
 * Account-type identity icon (ops/design-spec/icons.md section 4): the
 * design-system icon well in the account treatment -- neutral `surfaceAlt`
 * background with the glyph in `dim` (components.md 5.x account rows),
 * duotone weight.
 *
 * P8-4: the component renders per EFFECTIVE AccountTypeId (the full
 * user-facing set incl. business/loan/cash), keyed through the shared
 * ACCOUNT_TYPES metadata's `iconKey`. The glyph map is a total Record over
 * AccountTypeIconKey, so a new type id (or icon key) without a glyph here is
 * a compile error, not a silent generic glyph. Decorative by default; the
 * owning row carries the label.
 */
import { StyleSheet, View } from 'react-native';
import {
  ACCOUNT_TYPES,
  type AccountTypeIconKey,
  type AccountTypeId,
} from '@goldfinch/shared/accountTypes';

import { useTheme } from '../ThemeProvider';
import {
  BankIcon,
  BriefcaseIcon,
  ChartLineUpIcon,
  CreditCardIcon,
  HandCoinsIcon,
  MoneyIcon,
  PiggyBankIcon,
  WalletIcon,
  type IconWeight,
  type PhosphorIcon,
} from './glyphs';

/** Glyph share of the well (matches CategoryIcon). */
const GLYPH_RATIO = 0.47;

/**
 * Phosphor glyph per shared icon key (total over AccountTypeIconKey). The
 * type id -> icon key mapping itself lives in shared ACCOUNT_TYPES -- the
 * single metadata source -- so this module never re-states per-type rules.
 */
export const ACCOUNT_TYPE_ICON_GLYPHS: Readonly<
  Record<AccountTypeIconKey, PhosphorIcon>
> = {
  bank: BankIcon,
  'piggy-bank': PiggyBankIcon,
  'credit-card': CreditCardIcon,
  'chart-line-up': ChartLineUpIcon,
  briefcase: BriefcaseIcon,
  'hand-coins': HandCoinsIcon,
  money: MoneyIcon,
  wallet: WalletIcon,
};

/** Resolved glyph for an effective account type id. */
export function accountTypeGlyph(accountTypeId: AccountTypeId): PhosphorIcon {
  return ACCOUNT_TYPE_ICON_GLYPHS[ACCOUNT_TYPES[accountTypeId].iconKey];
}

export interface AccountTypeIconProps {
  /** EFFECTIVE account type id (AccountDto.accountTypeId / shared helpers). */
  accountTypeId: AccountTypeId;
  /** Well edge length; default 38 (list-row token). */
  size?: number;
  /** Glyph size override; default round(size * 0.47). */
  iconSize?: number;
  weight?: IconWeight;
}

export function AccountTypeIcon({
  accountTypeId,
  size = 38,
  iconSize,
  weight = 'duotone',
}: AccountTypeIconProps) {
  const theme = useTheme();
  const Glyph = accountTypeGlyph(accountTypeId);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.well,
        {
          width: size,
          height: size,
          borderRadius: theme.radius.token,
          backgroundColor: theme.colors.surfaceAlt,
        },
      ]}
    >
      <Glyph
        size={iconSize ?? Math.round(size * GLYPH_RATIO)}
        color={theme.colors.dim}
        weight={weight}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  well: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
