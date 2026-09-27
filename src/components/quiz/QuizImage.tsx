import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { quizService } from '@/services/quizzes';
import { colors } from '@/theme';
import { ui } from '@/components/common/workflowStyles';

export function QuizImage({ path }: { path: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ path: string; url: string | null; failed: boolean }>(
    { path, url: null, failed: false });
  useEffect(() => {
    let active = true;
    quizService.imageUrl(path).then(value => {
      if (active) setState({ path, url: value, failed: !value });
    }).catch(() => { if (active) setState({ path, url: null, failed: true }); });
    return () => { active = false; };
  }, [path]);
  const url = state.path === path ? state.url : null;
  if (state.path === path && state.failed) return <Text style={ui.secondary}>{t('quiz.imageUnavailable', 'Image unavailable')}</Text>;
  if (!url) return <ActivityIndicator color={colors.primary} />;
  return <View style={{ borderRadius: 6, overflow: 'hidden', backgroundColor: colors.background }}>
    <Image source={{ uri: url }} resizeMode="contain" style={{ width: '100%', height: 220 }}
      accessibilityLabel={t('quiz.questionImage', 'Question image')}
      onError={() => setState({ path, url: null, failed: true })} />
  </View>;
}
