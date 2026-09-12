import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ui } from '@/components/common/workflowStyles';
import { reviewInitials } from '@/utils/mentorReviews';
import { internshipDates, MentorStudent } from '@/utils/mentorStudents';
import { colors } from '@/theme';

export function StudentIdentity({ student }: { student: MentorStudent }) {
  const { t } = useTranslation();
  return <View style={ui.header}>
    <View accessible={false} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#eaf2fe', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={[ui.section, { color: colors.primaryDark }]}>{reviewInitials(student.name)}</Text>
    </View>
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={ui.section}>{student.name || t('mentorFlow.unknownStudent')}</Text>
      <Text style={ui.secondary}>{student.company || t('mentorStudents.noCompany')}</Text>
    </View>
  </View>;
}

export function StudentDates({ student }: { student: MentorStudent }) {
  const { t, i18n } = useTranslation();
  return <View style={ui.header}>
    <Ionicons name="calendar-outline" size={22} color={colors.textSecondary} />
    <Text style={[ui.secondary, { flex: 1 }]}>{internshipDates(student.start, student.end, i18n.language) || t('mentorStudents.noDates')}</Text>
  </View>;
}
