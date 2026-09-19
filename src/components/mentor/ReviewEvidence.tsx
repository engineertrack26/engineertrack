import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ui } from '@/components/common/workflowStyles';
import { colors } from '@/theme';
import type { DocumentEvidence, PhotoEvidence } from '@/types/assignment';
import { signEvidence } from '@/services/evidenceUrls';

export function ReviewEvidence({ photos = [], documents = [], onRetry }: {
  photos?: PhotoEvidence[]; documents?: DocumentEvidence[]; onRetry: () => void;
}) {
  const { t } = useTranslation();
  const [lightbox, setLightbox] = useState<PhotoEvidence | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});
  const [openingDoc, setOpeningDoc] = useState<number | null>(null);
  async function openDocument(doc: DocumentEvidence, index: number) {
    setOpeningDoc(index);
    try {
      const signed = await signEvidence([], [doc]);
      const uri = signed.documents[0]?.uri;
      if (!uri || !/^https?:\/\//.test(uri)) throw new Error('Unavailable document');
      await Linking.openURL(uri);
    } catch { Alert.alert(t('common.error'), t('common.tryAgain')); }
    finally { setOpeningDoc(null); }
  }
  return <View style={{ gap: 12 }}>
    <Text style={ui.section}>{t('mentor.evidence')}</Text>
    {!!photos.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {photos.map((photo, index) => <View key={index} style={{ flexBasis: '46%', flexGrow: 1, gap: 8 }}>
        {failedPhotos[photo.uri] ? <Pressable onPress={onRetry} accessibilityRole="button" style={ui.card}>
          <Text style={ui.secondary}>{t('common.loadFailed')}</Text><Text style={ui.link}>{t('common.retry')}</Text>
        </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={t('mentorFlow.enlargePhoto', { number: index + 1 }) + (photo.caption ? ': ' + photo.caption : '')}
          onPress={() => setLightbox(photo)}>
          <Image source={{ uri: photo.uri }} onError={() => setFailedPhotos(s => ({ ...s, [photo.uri]: true }))}
            style={{ width: '100%', aspectRatio: 1.2, borderRadius: 6, backgroundColor: colors.divider }} />
          <View style={{ position: 'absolute', right: 8, bottom: 8, padding: 6, backgroundColor: '#202124bb', borderRadius: 16 }}>
            <Ionicons name="expand-outline" color="#fff" size={18} />
          </View>
        </Pressable>}
        {!!photo.caption && <Text style={ui.secondary}>{photo.caption}</Text>}
      </View>)}
    </View>}
    {documents.map((doc, index) => <Pressable key={index} accessibilityRole="button" accessibilityLabel={doc.fileName}
      disabled={openingDoc !== null} accessibilityState={{ disabled: openingDoc !== null, busy: openingDoc === index }}
      onPress={() => openDocument(doc, index)} style={[ui.card, ui.header, { padding: 16 }]}>
      <Ionicons name="document-text-outline" size={26} color={colors.primaryDark} />
      <View style={{ flex: 1, gap: 4 }}><Text style={ui.label}>{doc.fileName}</Text>
        <Text style={ui.secondary}>{doc.fileSize >= 1048576 ? t('common.fileSizeMB', { size: (doc.fileSize / 1048576).toFixed(1) }) : t('common.fileSizeKB', { size: Math.max(1, Math.round(doc.fileSize / 1024)) })}</Text>
      </View>
      {openingDoc === index ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="open-outline" size={22} color={colors.primaryDark} />}
    </Pressable>)}
    {!photos.length && !documents.length && <Text style={ui.secondary}>{t('studentFlow.noEvidence')}</Text>}
    <Modal visible={lightbox !== null} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#151515' }} accessibilityViewIsModal>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => setLightbox(null)}
          style={[ui.iconButton, { alignSelf: 'flex-end', marginHorizontal: 16 }]}>
          <Ionicons name="close" color="#fff" size={28} />
        </Pressable>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} minimumZoomScale={1} maximumZoomScale={3}>
          {lightbox && <Image source={{ uri: lightbox.uri }} resizeMode="contain" style={{ width: '100%', aspectRatio: 0.85 }} />}
        </ScrollView>
        {!!lightbox?.caption && <ScrollView style={{ maxHeight: '25%' }} contentContainerStyle={{ padding: 20 }}>
          <Text style={[ui.body, { color: '#fff' }]}>{lightbox.caption}</Text>
        </ScrollView>}
      </SafeAreaView>
    </Modal>
  </View>;
}
