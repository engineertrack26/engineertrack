import { StyleSheet } from 'react-native';
import { colors, fonts } from '@/theme';

export const ui = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 20, width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 26, fontWeight: '600', fontFamily: fonts.semibold, color: colors.ink },
  section: { fontSize: 14, fontWeight: '600', fontFamily: fonts.semibold, color: colors.inkSoft },
  cardTitle: { fontSize: 20, fontWeight: '600', fontFamily: fonts.semibold, color: colors.text, lineHeight: 28 },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fonts.regular, color: colors.text },
  secondary: { fontSize: 14, lineHeight: 21, fontFamily: fonts.regular, color: colors.textSecondary },
  label: { fontSize: 16, fontWeight: '500', fontFamily: fonts.medium, color: colors.text },
  card: { padding: 16, gap: 12, backgroundColor: colors.paper, borderRadius: 6, borderWidth: 1, borderColor: colors.divider },
  featured: { borderColor: colors.ink, borderWidth: 1.5 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, fontSize: 13, fontWeight: '600', fontFamily: fonts.semibold },
  note: { backgroundColor: colors.warnBg, borderRadius: 6, padding: 16, gap: 8 },
  primary: { backgroundColor: colors.ink, borderRadius: 6, minHeight: 52, padding: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600', fontFamily: fonts.semibold, flexShrink: 1, textAlign: 'center' },
  link: { color: colors.ink, fontSize: 16, fontWeight: '500', fontFamily: fonts.medium, paddingVertical: 12 },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 9, height: 9, borderRadius: 5, right: 10, top: 9, backgroundColor: colors.error },
  input: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.ruleStrong, borderRadius: 6, padding: 14, fontSize: 16, fontFamily: fonts.regular, color: colors.text, minHeight: 52 },
});
