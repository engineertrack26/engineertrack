import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LoadFailedBanner } from '@/components/common';
import { assignmentService } from '@/services/assignments';
import { sortByLevel, type StudentLevel } from '@/utils/assignmentTargets';
import { colors, fonts, spacing } from '@/theme';

export interface TargetCandidate {
  id: string;
  name: string;
}

export function TargetPicker({ visible, groupId, competencyId, students, selected, onToggle, onSubmit, onClose }: {
  visible: boolean;
  groupId: string;
  /** null when the batch spans more than one competency: no single level to
   *  show, so the badges are omitted rather than taken from the wrong one. */
  competencyId: string | null;
  students: TargetCandidate[];
  selected: string[];
  onToggle: (id: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [levels, setLevels] = useState<StudentLevel[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible || !competencyId) { setLevels(null); return; }
    let alive = true;
    setFailed(false);
    assignmentService.listGroupLevels(groupId, competencyId)
      .then((rows) => { if (alive) setLevels(rows); })
      // The badges are an aid, not the point of the screen. A failed read
      // leaves the list usable and unsorted rather than blocking the send.
      .catch((err) => { console.warn('levels failed:', err); if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [visible, groupId, competencyId]);

  const ordered = sortByLevel(students, levels);
  const allPicked = students.length > 0 && students.every((s) => selected.includes(s.id));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('taskFlow.pickStudents', 'Who gets this task?')}</Text>
          {students.length > 0 ? (
            <TouchableOpacity hitSlop={8} accessibilityRole="button"
              onPress={() => students.forEach((s) => {
                if (allPicked ? selected.includes(s.id) : !selected.includes(s.id)) onToggle(s.id);
              })}>
              <Text style={styles.action}>
                {allPicked ? t('messages.clearAll') : t('messages.selectAll')}
              </Text>
            </TouchableOpacity>
          ) : <View style={{ width: 24 }} />}
        </View>
        <Text style={styles.hint}>{t('taskFlow.pickStudentsHint',
          'Only the students you choose will see this task.')}</Text>
        {failed && <LoadFailedBanner onRetry={() => setFailed(false)} />}
        {visible && competencyId && levels === null && !failed
          ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
          : (
          <FlatList
            data={ordered}
            keyExtractor={(s) => s.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>{t('taskFlow.noMembers')}</Text>}
            renderItem={({ item }) => {
              const picked = selected.includes(item.id);
              const level = levels?.find((l) => l.studentId === item.id)?.currentLevel;
              return (
                <TouchableOpacity style={styles.row} onPress={() => onToggle(item.id)} activeOpacity={0.7}
                  accessibilityRole="checkbox" accessibilityState={{ checked: picked }}>
                  <Ionicons name={picked ? 'checkbox' : 'square-outline'} size={22}
                    color={picked ? colors.ink : colors.textSecondary} style={styles.check} />
                  <Text style={styles.name}>{item.name}</Text>
                  {level !== undefined && (
                    <Text style={styles.level}>{t('taskFlow.levelBadge', 'L{{level}}', { level })}</Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}
        <View style={styles.footer}>
          <TouchableOpacity style={[styles.send, selected.length === 0 && styles.sendOff]}
            disabled={selected.length === 0} onPress={onSubmit} activeOpacity={0.8}
            accessibilityRole="button">
            <Text style={styles.sendText}>
              {t('messages.continueWith', { count: selected.length })}
            </Text>
          </TouchableOpacity>
        </View>
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
  name: { flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.text },
  level: { fontSize: 12, fontFamily: fonts.medium, color: colors.stamp, marginLeft: spacing.sm },
  empty: { textAlign: 'center', color: colors.textSecondary, marginTop: 40 },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  send: { minHeight: 52, borderRadius: 6, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
  sendText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '600', fontFamily: fonts.semibold },
});
