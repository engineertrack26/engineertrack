import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { closureService } from '@/services/closure';
import { mapRpcError } from '@/utils/rpcErrors';
import { BackButton, LoadFailedBanner, MarkdownView } from '@/components/common';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';
import type { ClosureStatus } from '@/types/closure';

type Role = 'student' | 'mentor' | 'advisor';

interface InternshipReportScreenProps {
  role: Role;
}

/** The report viewer for all three roles (design §6): reads studentId/
 *  groupId from the route (a notification, or a link from student
 *  monitor / the growth screen), loads the closure status and the
 *  Markdown report in parallel, and renders them with MarkdownView. A
 *  report that does not exist yet (NO_REPORT -- the internship was never
 *  closed) is a normal state, not a load failure. */
export function InternshipReportScreen({ role }: InternshipReportScreenProps) {
  const { t, i18n } = useTranslation();
  const { studentId, groupId } = useLocalSearchParams<{ studentId?: string; groupId?: string }>();
  const [status, setStatus] = useState<ClosureStatus | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [noReport, setNoReport] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const req = ++request.current;
    setLoadFailed(false);
    setNoReport(false);
    if (!studentId || !groupId) {
      setLoading(false);
      setLoadFailed(true);
      return;
    }
    setLoading(true);
    try {
      const [nextStatus, nextReport] = await Promise.all([
        closureService.status(studentId, groupId),
        closureService.report(studentId, groupId).catch((err) => {
          const { code } = mapRpcError(err instanceof Error ? err.message : '');
          if (code === 'NO_REPORT') return null;
          throw err;
        }),
      ]);
      if (req !== request.current) return;
      setStatus(nextStatus);
      if (nextReport === null) {
        setNoReport(true);
        setMarkdown('');
      } else {
        setMarkdown(nextReport);
      }
    } catch (err) {
      if (req !== request.current) return;
      console.error('Internship report load error:', err);
      setLoadFailed(true);
    } finally {
      if (req === request.current) setLoading(false);
    }
  }, [studentId, groupId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onShare = () => {
    if (!markdown) return;
    void Share.share({ message: markdown, title: t('closure.reportTitle', 'Internship report') });
  };

  const versionLabel = status?.reportVersion
    ? t('closure.version', 'Version {{n}} · {{date}}', {
        n: status.reportVersion,
        date: status.closedAt ? new Date(status.closedAt).toLocaleDateString(i18n.language) : '',
      })
    : null;

  return (
    <SafeAreaView style={ui.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={ui.content}>
        <BackButton
          disabled={loading}
          href={role === 'student' ? '/(student)/dashboard' : role === 'mentor' ? '/(mentor)/dashboard' : '/(advisor)/dashboard'}
        />
        <View style={[ui.header, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={ui.title} accessibilityRole="header">{t('closure.reportTitle', 'Internship report')}</Text>
            {!!versionLabel && <Text style={ui.secondary}>{versionLabel}</Text>}
          </View>
          {!!markdown && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('closure.share', 'Share')}
              onPress={onShare}
              style={ui.iconButton}
              hitSlop={8}
            >
              <Ionicons name="share-outline" size={22} color={colors.primary} />
            </Pressable>
          )}
        </View>
        {loadFailed && <LoadFailedBanner onRetry={() => void load()} />}
        {loading && <ActivityIndicator color={colors.primaryDark} />}
        {!loading && !loadFailed && noReport && <Text style={ui.body}>{t('closure.noReport', 'No report yet.')}</Text>}
        {!loading && !loadFailed && !noReport && !!markdown && <MarkdownView markdown={markdown} />}
      </ScrollView>
    </SafeAreaView>
  );
}
