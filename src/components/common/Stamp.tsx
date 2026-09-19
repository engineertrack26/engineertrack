import { View, Text, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, fonts } from '@/theme';

export type StampKind = 'approved' | 'revision' | 'pending' | 'closed';

interface StampProps {
  kind: StampKind;
  /** Replaces the kind's default wording (e.g. an attendance status
   *  wearing the approved or revision tone). */
  label?: string;
  who?: string;
  date?: string;
  size?: 'sm' | 'lg';
  style?: ViewStyle;
}

const TONE: Record<StampKind, { border: string; background: string; dashed: boolean }> = {
  approved: { border: colors.stamp, background: colors.stampBg, dashed: false },
  revision: { border: colors.warnText, background: colors.warnBg, dashed: false },
  pending: { border: colors.textDisabled, background: 'transparent', dashed: true },
  closed: { border: colors.stamp, background: colors.stampBg, dashed: false },
};

const LABEL_KEY: Record<StampKind, [string, string]> = {
  approved: ['stamp.approved', 'Approved'],
  revision: ['stamp.revision', 'Revision'],
  pending: ['stamp.pending', 'Awaiting review'],
  closed: ['stamp.closed', 'Internship closed'],
};

export function Stamp({ kind, label: labelOverride, who, date, size = 'sm', style }: StampProps) {
  const { t } = useTranslation();
  const tone = TONE[kind];
  const [key, fallback] = LABEL_KEY[kind];
  const label = labelOverride ?? t(key, fallback);
  const lg = size === 'lg';
  const fontSize = lg ? 15 : 11.5;
  const metaFontSize = lg ? 13 : 11;
  const meta = [who, date].filter(Boolean).join(' · ');
  const accessibilityLabel = [label, who, date].filter(Boolean).join(', ');

  return <View
    accessible
    accessibilityLabel={accessibilityLabel}
    style={[{
      alignSelf: 'flex-start',
      transform: kind === 'pending' ? undefined : [{ rotate: '-2deg' }],
      borderWidth: lg ? 2 : 1.5,
      borderStyle: tone.dashed ? 'dashed' : 'solid',
      borderRadius: lg ? 6 : 4,
      borderColor: tone.border,
      backgroundColor: tone.background,
      paddingVertical: lg ? 8 : 3,
      paddingHorizontal: lg ? 14 : 8,
    }, style]}>
    <Text style={{
      fontFamily: fonts.semibold,
      fontSize,
      color: tone.border,
      textTransform: 'uppercase',
      letterSpacing: fontSize * 0.06,
      textAlign: 'center',
    }}>{label}</Text>
    {!!meta && <Text style={{
      fontFamily: fonts.regular,
      fontSize: metaFontSize,
      color: tone.border,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
      marginTop: 2,
    }}>{meta}</Text>}
  </View>;
}
