import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/theme';

export default function ValidationScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Validation</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
});
