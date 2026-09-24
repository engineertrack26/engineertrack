import { Modal, View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadFailedBanner } from '@/components/common';
import { colors, spacing, fonts } from '@/theme';
import { contactLabel } from '@/utils/contactLabel';
import type { MessageContact } from '@/types/messages';

interface Props {
  visible: boolean;
  contacts: MessageContact[] | null;
  failed: boolean;
  onPick: (c: MessageContact) => void;
  onClose: () => void;
  onRetry: () => void;
  title?: string;
  hint?: string;
  /** Several recipients instead of one. The parent owns the selection so it
   *  survives a reload of the list; `onPick` then means "toggle". */
  multi?: { selected: string[]; onSubmit: () => void };
}

export function ContactPicker({ visible, contacts, failed, onPick, onClose, onRetry, title, hint, multi }: Props) {
  const { t } = useTranslation();
  const label = (c: MessageContact) => {
    const { roleKey, pairKey, names } = contactLabel(c.role, c.pairs);
    const role = t(roleKey);
    return pairKey ? `${role} · ${t(pairKey, { names })}` : role;
  };
  const selected = multi?.selected ?? [];
  const all = contacts ?? [];
  const allPicked = all.length > 0 && all.every((c) => selected.includes(c.id));
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>{title ?? t('messages.pickContact', 'Who do you want to message?')}</Text>
          {multi && all.length > 0 ? (
            <TouchableOpacity hitSlop={8} accessibilityRole="button"
              onPress={() => all.forEach((c) => {
                // Toggling through the same callback keeps one source of truth.
                if (allPicked ? selected.includes(c.id) : !selected.includes(c.id)) onPick(c);
              })}>
              <Text style={styles.action}>{allPicked ? t('messages.clearAll', 'Clear') : t('messages.selectAll', 'Select all')}</Text>
            </TouchableOpacity>
          ) : <View style={{ width: 24 }} />}
        </View>
        {!!hint && <Text style={styles.hint}>{hint}</Text>}
        {contacts === null ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={contacts}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={failed ? <LoadFailedBanner onRetry={onRetry} /> : <Text style={styles.empty}>{t('messages.noContacts', 'Nobody to message in this group yet.')}</Text>}
            renderItem={({ item }) => {
              const picked = selected.includes(item.id);
              return (
                <TouchableOpacity style={styles.row} onPress={() => onPick(item)} activeOpacity={0.7}
                  accessibilityRole={multi ? 'checkbox' : 'button'}
                  accessibilityState={multi ? { checked: picked } : undefined}>
                  {multi && (
                    <Ionicons name={picked ? 'checkbox' : 'square-outline'} size={22}
                      color={picked ? colors.ink : colors.textSecondary} style={styles.check} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.name}</Text>
                    <Text style={styles.role}>{item.hasCase ? t('messages.caseExists', 'Case already open') : label(item)}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
        {multi && (
          <View style={styles.footer}>
            <TouchableOpacity style={[styles.send, selected.length === 0 && styles.sendOff]}
              disabled={selected.length === 0} onPress={multi.onSubmit} activeOpacity={0.8} accessibilityRole="button">
              <Text style={styles.sendText}>{t('messages.continueWith', 'Continue ({{count}})', { count: selected.length })}</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', fontFamily: fonts.semibold, color: colors.text },
  action: { fontSize: 14, fontWeight: '500', fontFamily: fonts.medium, color: colors.ink },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  check: { marginRight: spacing.md },
  name: { fontSize: 15, fontFamily: fonts.regular, color: colors.text },
  role: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: 40 },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  send: { minHeight: 52, borderRadius: 6, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
  sendText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '600', fontFamily: fonts.semibold },
});
