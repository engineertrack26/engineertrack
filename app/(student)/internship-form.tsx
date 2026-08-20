import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';
import { colors, spacing, borderRadius } from '@/theme';

type FormErrors = Record<string, string>;

// The database column is DATE and the rest of the app passes these around as
// 'YYYY-MM-DD' strings, so that stays the stored shape. Only the display
// changes.
//
// Both helpers work in LOCAL time on purpose. toISOString() converts local
// midnight to UTC, which in any positive offset lands on the previous day, and
// new Date('2026-09-01') is parsed as UTC and then rendered locally, which does
// the same thing in reverse. Either one silently shifts a student's start date
// by a day.
function toIsoDate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function fromIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function InternshipFormScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ return?: string }>();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pickerFor, setPickerFor] = useState<'start' | 'end' | null>(null);

  const [university, setUniversity] = useState('');
  const [faculty, setFaculty] = useState('');
  const [department, setDepartment] = useState('');
  const [departmentBranch, setDepartmentBranch] = useState('');
  const [studentId, setStudentId] = useState('');

  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companySector, setCompanySector] = useState('');
  const [internshipStartDate, setInternshipStartDate] = useState('');
  const [internshipEndDate, setInternshipEndDate] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      if (!user) return;
      try {
        const data = await authService.getStudentProfile(user.id);
        if (!isMounted) return;
        if (data) {
          setUniversity((data.university as string) || '');
          setFaculty((data.faculty as string) || '');
          setDepartment((data.department as string) || '');
          setDepartmentBranch((data.department_branch as string) || '');
          setStudentId((data.student_id as string) || '');
          setCompanyName((data.company_name as string) || '');
          setCompanyAddress((data.company_address as string) || '');
          setCompanySector((data.company_sector as string) || '');
          setInternshipStartDate((data.internship_start_date as string) || '');
          setInternshipEndDate((data.internship_end_date as string) || '');
        }
      } catch (err) {
        console.warn('Failed to load student profile:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const validate = () => {
    const newErrors: FormErrors = {};
    const requiredMessage = t('common.required', 'Required');

    if (!university.trim()) newErrors.university = requiredMessage;
    if (!department.trim()) newErrors.department = requiredMessage;
    if (!studentId.trim()) newErrors.studentId = requiredMessage;
    if (!companyName.trim()) newErrors.companyName = requiredMessage;
    if (!internshipStartDate.trim()) newErrors.internshipStartDate = requiredMessage;
    if (!internshipEndDate.trim()) newErrors.internshipEndDate = requiredMessage;

    // An internship that ends before it starts is not a database error — both
    // columns accept it happily — so nothing downstream would ever notice.
    const start = fromIsoDate(internshipStartDate);
    const end = fromIsoDate(internshipEndDate);
    if (start && end && end < start) {
      newErrors.internshipEndDate = t(
        'student.endDateBeforeStart',
        'End date cannot be before the start date.',
      );
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!user) return;
    if (!validate()) return;

    setSaving(true);
    try {
      await authService.upsertStudentProfile(user.id, {
        university: university.trim(),
        faculty: faculty.trim() || null,
        department: department.trim(),
        department_branch: departmentBranch.trim() || null,
        student_id: studentId.trim(),
        company_name: companyName.trim(),
        company_address: companyAddress.trim() || null,
        company_sector: companySector.trim() || null,
        internship_start_date: internshipStartDate.trim(),
        internship_end_date: internshipEndDate.trim(),
      });

      Alert.alert(
        t('common.save', 'Save'),
        t('student.internshipInfoSaved', 'Internship information saved.'),
      );

      const returnTo = params.return || 'profile';
      router.replace(`/(student)/${returnTo}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.error', 'Error');
      Alert.alert(t('common.error', 'Error'), message);
    } finally {
      setSaving(false);
    }
  };

  // Stored as YYYY-MM-DD, shown in whatever the user's language writes dates
  // in — 01.09.2026 in tr and de, 01/09/2026 in it and el. Nobody types a
  // format, so there is no format to get wrong, and 03/04 is never ambiguous
  // because it was never typed.
  const renderDateField = (
    which: 'start' | 'end',
    label: string,
    value: string,
    error?: string,
  ) => {
    const parsed = fromIsoDate(value);
    return (
      <View>
        <Text style={styles.dateLabel}>{label}</Text>
        <TouchableOpacity
          style={[styles.dateField, error ? styles.dateFieldError : null]}
          onPress={() => setPickerFor(which)}
          activeOpacity={0.7}
        >
          <Text style={parsed ? styles.dateValue : styles.datePlaceholder}>
            {parsed
              ? parsed.toLocaleDateString(i18n.language)
              : t('student.selectDate', 'Select a date')}
          </Text>
          <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        {error ? <Text style={styles.dateError}>{error}</Text> : null}
      </View>
    );
  };

  if (loading) {
    return (
      <ScreenWrapper>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>{t('common.loading', 'Loading...')}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <View style={styles.header}>
        <Text style={styles.title}>
          {t('student.internshipFormTitle', 'Internship Information')}
        </Text>
        <Text style={styles.subtitle}>
          {t('student.internshipFormSubtitle', 'Complete your school and workplace details to continue.')}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('student.schoolInfo', 'School Information')}</Text>

        <Input
          label={t('student.universityName', 'University Name')}
          placeholder={t('student.universityName', 'University Name')}
          value={university}
          onChangeText={setUniversity}
          error={errors.university}
        />
        <Input
          label={t('student.facultyName', 'Faculty')}
          placeholder={t('student.facultyName', 'Faculty')}
          value={faculty}
          onChangeText={setFaculty}
        />
        <Input
          label={t('student.departmentName', 'Department')}
          placeholder={t('student.departmentName', 'Department')}
          value={department}
          onChangeText={setDepartment}
          error={errors.department}
        />
        <Input
          label={t('student.departmentBranch', 'Department Branch (Optional)')}
          placeholder={t('student.departmentBranch', 'Department Branch')}
          value={departmentBranch}
          onChangeText={setDepartmentBranch}
        />
        <Input
          label={t('student.studentId', 'Student ID')}
          placeholder={t('student.studentId', 'Student ID')}
          value={studentId}
          onChangeText={setStudentId}
          error={errors.studentId}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {t('student.internshipWorkplace', 'Internship Workplace')}
        </Text>

        <Input
          label={t('student.companyName', 'Company Name')}
          placeholder={t('student.companyName', 'Company Name')}
          value={companyName}
          onChangeText={setCompanyName}
          error={errors.companyName}
        />
        <Input
          label={t('student.companyAddress', 'Company Address')}
          placeholder={t('student.companyAddress', 'Company Address')}
          value={companyAddress}
          onChangeText={setCompanyAddress}
        />
        <Input
          label={t('student.companySector', 'Company Field / Sector')}
          placeholder={t('student.companySector', 'Company Field / Sector')}
          value={companySector}
          onChangeText={setCompanySector}
        />

        <View style={styles.row}>
          <View style={styles.col}>
            {renderDateField(
              'start',
              t('student.internshipStartDate', 'Start Date'),
              internshipStartDate,
              errors.internshipStartDate,
            )}
          </View>
          <View style={styles.col}>
            {renderDateField(
              'end',
              t('student.internshipEndDate', 'End Date'),
              internshipEndDate,
              errors.internshipEndDate,
            )}
          </View>
        </View>
      </View>

      {pickerFor && (
        <View style={Platform.OS === 'ios' ? styles.iosPickerBox : undefined}>
          <DateTimePicker
            value={
              fromIsoDate(pickerFor === 'start' ? internshipStartDate : internshipEndDate) ||
              new Date()
            }
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(event, selected) => {
              // Android shows a dialog and reports its own dismissal; iOS keeps
              // the spinner on screen until the Done button below closes it.
              if (Platform.OS === 'android') setPickerFor(null);
              if (event.type === 'dismissed' || !selected) return;
              const iso = toIsoDate(selected);
              if (pickerFor === 'start') setInternshipStartDate(iso);
              else setInternshipEndDate(iso);
            }}
          />
          {Platform.OS === 'ios' && (
            <Button
              title={t('common.done', 'Done')}
              onPress={() => setPickerFor(null)}
              style={styles.iosPickerDone}
            />
          )}
        </View>
      )}

      <Button
        title={t('student.saveInternshipInfo', 'Save Internship Info')}
        onPress={handleSave}
        loading={saving}
        style={styles.saveButton}
      />
      <View style={{ height: spacing.xl }} />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  header: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  col: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  dateFieldError: {
    borderColor: colors.error,
  },
  dateValue: {
    fontSize: 15,
    color: colors.text,
  },
  datePlaceholder: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  dateError: {
    fontSize: 12,
    color: colors.error,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  iosPickerBox: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
  },
  iosPickerDone: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  saveButton: {
    marginTop: spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});
