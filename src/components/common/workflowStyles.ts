import { StyleSheet } from 'react-native';
import { colors } from '@/theme';

export const ui = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 20, width: '100%', maxWidth: 720, alignSelf: 'center', paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  section: { fontSize: 20, fontWeight: '700', color: colors.text },
  cardTitle: { fontSize: 20, fontWeight: '700', color: colors.text, lineHeight: 28 },
  body: { fontSize: 16, lineHeight: 24, color: colors.text },
  secondary: { fontSize: 14, lineHeight: 21, color: colors.textSecondary },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  card: { padding: 20, gap: 12, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: colors.divider },
  featured: { borderColor: '#cadcf7' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, fontSize: 13, fontWeight: '600' },
  note: { backgroundColor: '#fff7e8', borderRadius: 12, padding: 16, gap: 8 },
  primary: { backgroundColor: colors.primaryDark, borderRadius: 12, minHeight: 52, padding: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  link: { color: colors.primaryDark, fontSize: 16, fontWeight: '600', paddingVertical: 12 },
  iconButton: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 9, height: 9, borderRadius: 5, right: 10, top: 9, backgroundColor: colors.error },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#9aa0a6', borderRadius: 12, padding: 14, fontSize: 16, color: colors.text, minHeight: 52 },
});
