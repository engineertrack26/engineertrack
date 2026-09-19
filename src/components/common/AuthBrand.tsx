import { Image, StyleSheet, View } from 'react-native';

export function AuthBrand() {
  return <View style={styles.frame}>
    <Image source={require('../../../assets/engineertrack_logo.png')}
      accessible accessibilityLabel="EngineerTrack" resizeMode="contain" style={styles.image} />
  </View>;
}

const styles = StyleSheet.create({
  // Size the frame, not the native Image: bundled images otherwise supply
  // their intrinsic height, which can push the sign-in form below the fold.
  frame: { width: '100%', maxWidth: 360, aspectRatio: 2000 / 740, marginBottom: 16, flexShrink: 0 },
  image: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
});
