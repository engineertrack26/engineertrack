import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenWrapper } from '@/components/common/ScreenWrapper';
import { Input } from '@/components/common/Input';
import { Button } from '@/components/common/Button';
import { useAuthStore } from '@/store/authStore';
import { authService } from '@/services/auth';
import { colors, spacing, borderRadius } from '@/theme';

type FormErrors = Record<string, string>;

export default function InternshipFormScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ return?: string }>();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

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
    const requiredMessage = t('common.required') || 'Required';

    if (!university.trim()) newErrors.university = requiredMessage;
    if (!department.trim()) newErrors.department = requiredMessage;
    if (!studentId.trim()) newErrors.studentId = requiredMessage;
    if (!companyName.trim()) newErrors.companyName = requiredMessage;
    if (!internshipStartDate.trim()) newErrors.internshipStartDate = requiredMessage;
    if (!internshipEndDate.trim()) newErrors.internshipEndDate = requiredMessage;

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
        t('common.save') || 'Save',
        t('student.internshipInfoSaved') || 'Internship information saved.',
      );

      const returnTo = params.return || 'profile';
      router.replace(`/(student)/${returnTo}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.error') || 'Error';
      Alert.alert(t('common.error') || 'Error', message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ScreenWrapper>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>{t('common.loading') || 'Loading...'}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <View style={styles.header}>
        <Text style={styles.title}>
          {t('student.internshipFormTitle') || 'Internship Information'}
        </Text>
        <Text style={styles.subtitle}>
          {t('student.internshipFormSubtitle') ||
            'Complete your school and workplace details to continue.'}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('student.schoolInfo') || 'School Information'}</Text>

        <Input
          label={t('student.universityName') || 'University Name'}
          placeholder={t('student.universityName') || 'University Name'}
          value={university}
          onChangeText={setUniversity}
          error={errors.university}
        />
        <Input
          label={t('student.facultyName') || 'Faculty'}
          placeholder={t('student.facultyName') || 'Faculty'}
          value={faculty}
          onChangeText={setFaculty}
        />
        <Input
          label={t('student.departmentName') || 'Department'}
          placeholder={t('student.departmentName') || 'Department'}
          value={department}
          onChangeText={setDepartment}
          error={errors.department}
        />
        <Input
          label={t('student.departmentBranch') || 'Department Branch (Optional)'}
          placeholder={t('student.departmentBranch') || 'Department Branch'}
          value={departmentBranch}
          onChangeText={setDepartmentBranch}
        />
        <Input
          label={t('student.studentId') || 'Student ID'}
          placeholder={t('student.studentId') || 'Student ID'}
          value={studentId}
          onChangeText={setStudentId}
          error={errors.studentId}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {t('student.internshipWorkplace') || 'Internship Workplace'}
        </Text>

        <Input
          label={t('student.companyName') || 'Company Name'}
          placeholder={t('student.companyName') || 'Company Name'}
          value={companyName}
          onChangeText={setCompanyName}
          error={errors.companyName}
        />
        <Input
          label={t('student.companyAddress') || 'Company Address'}
          placeholder={t('student.companyAddress') || 'Company Address'}
          value={companyAddress}
          onChangeText={setCompanyAddress}
        />
        <Input
          label={t('student.companySector') || 'Company Field / Sector'}
          placeholder={t('student.companySector') || 'Company Field / Sector'}
          value={companySector}
          onChangeText={setCompanySector}
        />

        <View style={styles.row}>
          <View style={styles.col}>
            <Input
              label={t('student.internshipStartDate') || 'Start Date'}
              placeholder="YYYY-MM-DD"
              value={internshipStartDate}
              onChangeText={setInternshipStartDate}
              keyboardType="numbers-and-punctuation"
              error={errors.internshipStartDate}
            />
          </View>
          <View style={styles.col}>
            <Input
              label={t('student.internshipEndDate') || 'End Date'}
              placeholder="YYYY-MM-DD"
              value={internshipEndDate}
              onChangeText={setInternshipEndDate}
              keyboardType="numbers-and-punctuation"
              error={errors.internshipEndDate}
            />
          </View>
        </View>
      </View>

      <Button
        title={t('student.saveInternshipInfo') || 'Save Internship Info'}
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
