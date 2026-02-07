import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme';

interface ScreenWrapperProps {
  children: React.ReactNode;
  scroll?: boolean;
  padding?: boolean;
}

export function ScreenWrapper({
  children,
  scroll = true,
  padding = true,
}: ScreenWrapperProps) {
  const content = (
    <View style={[styles.inner, padding && styles.padding]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
  },
  inner: {
    flex: 1,
  },
  padding: {
    paddingHorizontal: 24,
  },
});
