import { Modal, View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadFailedBanner } from '@/components/common';
import { colors, spacing } from '@/theme';
import type { MessageContact } from '@/types/messages';

interface Props { visible: boolean; contacts: MessageContact[] | null; failed: boolean; onPick: (c: MessageContact) => void; onClose: () => void; onRetry: () => void; title?: string; hint?: string }

export function ContactPicker({ visible, contacts, failed, onPick, onClose, onRetry, title, hint }: Props) {
  const { t } = useTranslation();
  const label = (role: string) => role === 'advisor' ? t('messages.roleAdvisor', 'Advisor') : role === 'mentor' ? t('messages.roleMentor', 'Mentor') : t('messages.roleStudent', 'Student');
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
          <Text style={styles.title}>{title ?? t('messages.pickContact', 'Who do you want to message?')}</Text>
          <View style={{ width: 24 }} />
        </View>
        {!!hint && <Text style={styles.hint}>{hint}</Text>}
        {contacts === null ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={contacts}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={failed ? <LoadFailedBanner onRetry={onRetry} /> : <Text style={styles.empty}>{t('messages.noContacts', 'Nobody to message in this group yet.')}</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => onPick(item)} activeOpacity={0.7}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.role}>{item.hasCase ? t('messages.caseExists', 'Case already open') : label(item.role)}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  hint: { fontSize: 12, color: colors.textSecondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.lg },
  row: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  name: { fontSize: 15, color: colors.text },
  role: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: 40 },
});
