import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity, Platform, TextInput, ScrollView, KeyboardAvoidingView, ActivityIndicator, BackHandler, Keyboard } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router, useFocusEffect, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadFailedBanner } from '@/components/common';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';
import { ui } from '@/components/common/workflowStyles';
import { colors, fonts } from '@/theme';
import { showToast } from '@/components/common/Toast';
import { internshipFields, requiredInternshipFields, readInternshipForm, parseInternshipDate,
  internshipDateString, validateInternshipForm, internshipPayload, sameInternshipForm, internshipReturnPath,
  type InternshipField, type InternshipForm } from '@/utils/internshipForm';

const labels: Record<InternshipField, string> = {
  university: 'student.universityName', faculty: 'student.facultyName', department: 'student.departmentName',
  department_branch: 'student.departmentBranch', student_id: 'student.studentId', company_name: 'student.companyName',
  company_address: 'student.companyAddress', company_sector: 'student.companySector',
  internship_start_date: 'student.internshipStartDate', internship_end_date: 'student.internshipEndDate',
};
const sections: Array<{ title: string; hint: string; fields: InternshipField[] }> = [
  { title: 'student.schoolInfo', hint: 'internshipUi.schoolHint', fields: ['university', 'faculty', 'department', 'department_branch', 'student_id'] },
  { title: 'student.internshipWorkplace', hint: 'internshipUi.workHint', fields: ['company_name', 'company_address', 'company_sector'] },
  { title: 'internshipUi.dates', hint: 'internshipUi.dateHint', fields: ['internship_start_date', 'internship_end_date'] },
];

export default function InternshipFormScreen() {
  const params = useLocalSearchParams<{ return?: string }>();
  const userId = useAuthStore((s) => s.user?.id);
  return userId ? <InternshipContent key={userId} userId={userId} returnTo={params.return} /> : null;
}
function InternshipContent({ userId, returnTo }: { userId: string; returnTo?: string }) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const [form, setForm] = useState<InternshipForm>(() => readInternshipForm(null));
  const [baseline, setBaseline] = useState<InternshipForm>(() => readInternshipForm(null));
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<ReturnType<typeof validateInternshipForm>>({});
  const [pickerFor, setPickerFor] = useState<InternshipField | null>(null);
  const scroll = useRef<ScrollView>(null);
  const inputs = useRef<Partial<Record<InternshipField, TextInput | null>>>({});
  const offsets = useRef<Record<number, number>>({});
  const lock = useRef(false);
  const allowExit = useRef(false);
  const dirtyRef = useRef(false);
  const sequence = useRef(0);
  const dirty = !sameInternshipForm(form, baseline);
  dirtyRef.current = dirty;
  const destination = internshipReturnPath(returnTo);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const row = await authService.getStudentProfile(userId);
      if (request !== sequence.current || useAuthStore.getState().user?.id !== userId) return;
      const values = readInternshipForm(row);
      setForm(values); setBaseline(values); setErrors({}); setFailed(false);
    } catch {
      if (request === sequence.current) setFailed(true);
    } finally { if (request === sequence.current) setLoading(false); }
  }, [userId]);
  useEffect(() => { void load(); return () => { sequence.current += 1; }; }, [load]);

  function requestLeave(action = () => router.replace(destination)) {
    if (lock.current) return;
    const leave = () => { allowExit.current = true; action(); };
    if (!dirtyRef.current) { leave(); return; }
    Alert.alert(t('internshipUi.unsaved'), t('internshipUi.leave'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('internshipUi.discard'), style: 'destructive', onPress: leave },
    ]);
  }
  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (allowExit.current) return;
    if (lock.current || dirtyRef.current) {
      event.preventDefault();
      if (!lock.current) requestLeave(() => navigation.dispatch(event.data.action));
    }
  }), [navigation, destination, t]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { requestLeave(); return true; });
    return () => subscription.remove();
  }, [destination, t]));

  function change(field: InternshipField, value: string) {
    if (lock.current) return;
    setForm((old) => ({ ...old, [field]: value }));
    setErrors((old) => {
      const next = { ...old }; delete next[field];
      if (field === 'internship_start_date') delete next.internship_end_date;
      return next;
    });
  }
  const message = (reason: 'required' | 'date' | 'order') => t(reason === 'required' ? 'common.required' :
    reason === 'order' ? 'student.endDateBeforeStart' : 'internshipUi.invalidDate');
  async function save() {
    if (lock.current || loading || failed || useAuthStore.getState().user?.id !== userId) return;
    const issues = validateInternshipForm(form);
    setErrors(issues);
    const first = internshipFields.find((field) => issues[field]);
    if (first) {
      const section = sections.findIndex((s) => s.fields.includes(first));
      scroll.current?.scrollTo({ y: Math.max(0, (offsets.current[section] || 0) - 12), animated: true });
      inputs.current[first]?.focus();
      return;
    }
    Keyboard.dismiss(); setPickerFor(null);
    lock.current = true; setSaving(true);
    try {
      await authService.upsertStudentProfile(userId, internshipPayload(form));
      if (useAuthStore.getState().user?.id !== userId) return;
      allowExit.current = true; dirtyRef.current = false;
      showToast(t('student.internshipInfoSaved'));
      router.replace(destination);
    } catch {
      if (useAuthStore.getState().user?.id === userId)
        Alert.alert(t('common.error'), t('internshipUi.saveFailed'));
    } finally { lock.current = false; setSaving(false); }
  }
  const completed = requiredInternshipFields.filter((field) => form[field].trim() && !validateInternshipForm(form)[field]).length;
  const errorFields = internshipFields.filter((field) => errors[field]);
  return <SafeAreaView style={ui.safe}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <TouchableOpacity accessibilityRole="button" style={styles.back} disabled={saving} onPress={() => requestLeave()}>
          <Ionicons name="arrow-back" size={24} color={colors.primaryDark} /><Text style={ui.link}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={ui.title} accessibilityRole="header">{t('student.internshipFormTitle')}</Text>
        <Text style={ui.secondary}>{t('student.internshipFormSubtitle')}</Text>
        {loading ? <ActivityIndicator size="large" color={colors.primaryDark} /> : failed ?
          <LoadFailedBanner onRetry={() => void load()} /> : <>
          <View style={ui.note}><Text style={ui.secondary}>{t('internshipUi.requiredHint')}</Text></View>
          {!!errorFields.length && <View style={ui.note} accessibilityRole="alert">
            <Text style={ui.label}>{t('internshipUi.checkFields')}</Text>
            {errorFields.map((field) => <Text key={field} style={ui.body}>{t(labels[field])}: {message(errors[field]!)}</Text>)}
          </View>}
          {sections.map((section, index) => <View key={section.title} style={ui.card}
            onLayout={(event) => { offsets.current[index] = event.nativeEvent.layout.y; }}>
            <Text style={ui.section} accessibilityRole="header">{index + 1}. {t(section.title)}</Text>
            <Text style={ui.secondary}>{t(section.hint)}</Text>
            {section.fields.map((field) => {
              const dateField = field === 'internship_start_date' || field === 'internship_end_date';
              const required = requiredInternshipFields.includes(field);
              const label = t(labels[field]);
              return <View key={field} style={{ gap: 8 }}>
                <Text style={ui.label}>{label}{required ? ' *' : ''}</Text>
                {dateField ? <TouchableOpacity style={[ui.input, styles.date, errors[field] && styles.error]}
                  disabled={saving} accessibilityRole="button" accessibilityLabel={label}
                  onPress={() => { Keyboard.dismiss(); setPickerFor(field); }}>
                  <Text style={[ui.body, { flex: 1 }]}>{parseInternshipDate(form[field])?.toLocaleDateString(i18n.language) || t('student.selectDate')}</Text>
                  <Ionicons name="calendar-outline" size={22} color={colors.primaryDark} />
                </TouchableOpacity> : <TextInput ref={(ref) => { inputs.current[field] = ref; }}
                  style={[ui.input, errors[field] && styles.error, field === 'company_address' && { minHeight: 88, textAlignVertical: 'top' }]}
                  accessibilityLabel={label + (required ? ', ' + t('common.required') : '')}
                  editable={!saving} value={form[field]} onChangeText={(value) => change(field, value)}
                  autoCorrect={field !== 'student_id'} autoCapitalize={field === 'student_id' ? 'none' : 'words'}
                  multiline={field === 'company_address'} returnKeyType={field === 'company_address' ? 'default' : 'next'}
                  onSubmitEditing={() => {
                    if (field === 'company_address') return;
                    const next = internshipFields[internshipFields.indexOf(field) + 1];
                    if (next === 'internship_start_date') { Keyboard.dismiss(); setPickerFor(next); }
                    else inputs.current[next]?.focus();
                  }} />}
                {!!errors[field] && <Text style={styles.errorText} accessibilityRole="alert">{message(errors[field]!)}</Text>}
                {pickerFor === field && <View>
                  <DateTimePicker value={parseInternshipDate(form[field]) ||
                    (field === 'internship_end_date' ? parseInternshipDate(form.internship_start_date) : null) || new Date()}
                    mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={(event, value) => {
                      if (Platform.OS !== 'ios') setPickerFor(null);
                      if (event.type !== 'dismissed' && value) change(field, internshipDateString(value));
                    }} />
                  {Platform.OS === 'ios' && <TouchableOpacity accessibilityRole="button" onPress={() => setPickerFor(null)}>
                    <Text style={ui.link}>{t('common.done')}</Text>
                  </TouchableOpacity>}
                </View>}
              </View>;
            })}
          </View>)}
        </>}
      </ScrollView>
      {!loading && !failed && <View style={styles.footer}>
        <Text style={ui.secondary} accessibilityLiveRegion="polite">{t('internshipUi.progress', { completed, total: requiredInternshipFields.length })}
          {dirty ? ' · ' + t('internshipUi.unsaved') : ''}</Text>
        <TouchableOpacity accessibilityRole="button" style={ui.primary} disabled={saving}
          accessibilityState={{ disabled: saving, busy: saving }} onPress={() => void save()}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={ui.primaryText}>{t('student.saveInternshipInfo')}</Text>}
        </TouchableOpacity>
      </View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  back: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  date: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  error: { borderColor: colors.error, borderWidth: 2 },
  errorText: { color: colors.error, fontSize: 14, fontFamily: fonts.regular, lineHeight: 21 },
  footer: { padding: 16, gap: 8, borderTopWidth: 1, borderTopColor: colors.divider, width: '100%', maxWidth: 720, alignSelf: 'center' },
});
