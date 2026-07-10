import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { ErrorBoundaryProps } from 'expo-router';
import { colors } from '@/theme';
import { Button } from './Button';

export function ErrorFallback({ error, retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
      <Text style={styles.title}>
        {t('common.somethingWentWrong', 'Something went wrong')}
      </Text>
      <Text style={styles.description}>
        {t('common.somethingWentWrongDesc', 'An unexpected error occurred. Please try again.')}
      </Text>
      {__DEV__ && <Text style={styles.devError}>{error.message}</Text>}
      <Button
        title={t('common.retry', 'Retry')}
        onPress={() => {
          retry();
        }}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginTop: 16,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  devError: {
    fontSize: 12,
    color: colors.error,
    marginTop: 12,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  button: {
    marginTop: 24,
    alignSelf: 'stretch',
  },
});
