import { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { feedService } from '@/services/feed';
import { mapRpcError } from '@/utils/rpcErrors';
import { isValidLink, attachmentsPayload, type AttachmentDraft } from '@/utils/feedAttachments';
import { colors, spacing, borderRadius } from '@/theme';

interface Props {
  visible: boolean;
  kind: 'announcement' | 'poll';
  groupId: string;
  onClose: () => void;
  onPosted: () => void;
}

const BODY_MAX = 2000;
const QUESTION_MAX = 200;
const OPTION_MAX = 80;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

type FileSlot = 'photo' | 'document';

/** What a picked file looks like before and during its upload: the device
 *  uri is kept so a failed upload can be retried in place, as EvidencePicker
 *  does, rather than re-picked. */
interface PickedFile {
  uri: string;
  name: string;
  mime: string;
  size?: number;
}

export function FeedComposer({ visible, kind, groupId, onClose, onPosted }: Props) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [posting, setPosting] = useState(false);
  const max = kind === 'poll' ? QUESTION_MAX : BODY_MAX;

  // Announcement attachments: one slot per kind. `draft` holds only what
  // has finished uploading (a storage path) or the link as typed; `pending`
  // holds a picked file while its upload is in flight or after it failed.
  const [draft, setDraft] = useState<AttachmentDraft>({});
  const [pending, setPending] = useState<Partial<Record<FileSlot, PickedFile>>>({});
  const [uploading, setUploading] = useState<Partial<Record<FileSlot, boolean>>>({});
  const [failed, setFailed] = useState<Partial<Record<FileSlot, string>>>({});
  const [linkOpen, setLinkOpen] = useState(false);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const linkUrl = draft.link?.url ?? '';
  const linkOk = linkUrl.trim().length === 0 || isValidLink(linkUrl);
  const anyUploading = !!uploading.photo || !!uploading.document;
  const anyFailed = !!failed.photo || !!failed.document;
  const canPost =
    body.trim().length > 0
    && (kind === 'announcement' || (filled.length >= MIN_OPTIONS && filled.length <= MAX_OPTIONS))
    && !anyUploading
    && !anyFailed
    && linkOk;

  function reset() {
    setBody('');
    setOptions(['', '']);
    setDraft({});
    setPending({});
    setUploading({});
    setFailed({});
    setLinkOpen(false);
  }

  async function post() {
    if (!canPost || posting) return;
    setPosting(true);
    try {
      // An empty link row (opened but never typed in) is not an attachment.
      const payload = attachmentsPayload(linkUrl.trim() ? draft : { ...draft, link: undefined });
      await feedService.createPost(
        groupId,
        kind,
        body.trim(),
        kind === 'poll' ? filled : undefined,
        kind === 'announcement' ? payload : undefined,
      );
      reset();
      onPosted();
    } catch (err) {
      const { key } = mapRpcError(err instanceof Error ? err.message : '');
      Alert.alert(t('common.error'), t(key));
    } finally {
      setPosting(false);
    }
  }

  async function upload(slot: FileSlot, file: PickedFile) {
    setPending((prev) => ({ ...prev, [slot]: file }));
    setUploading((prev) => ({ ...prev, [slot]: true }));
    setFailed((prev) => ({ ...prev, [slot]: undefined }));
    try {
      const path = await feedService.uploadFeedAttachment(groupId, file.uri, file.name, file.mime);
      setDraft((prev) => ({
        ...prev,
        [slot]: slot === 'photo'
          ? { path, mime: file.mime, size: file.size, name: file.name }
          : { path, name: file.name, mime: file.mime, size: file.size },
      }));
    } catch (err) {
      // Never swallow this silently: the chip says "Upload failed" and
      // offers a retry, but without the reason nobody can tell a bucket
      // policy problem from a dead network.
      console.warn(`Feed ${slot} upload failed:`, err instanceof Error ? err.message : err);
      setFailed((prev) => ({ ...prev, [slot]: file.uri }));
    } finally {
      setUploading((prev) => ({ ...prev, [slot]: false }));
    }
  }

  function retry(slot: FileSlot) {
    const file = pending[slot];
    if (!file) return;
    upload(slot, file);
  }

  function clearSlot(slot: FileSlot | 'link') {
    setDraft((prev) => ({ ...prev, [slot]: undefined }));
    if (slot === 'link') {
      setLinkOpen(false);
      return;
    }
    setPending((prev) => ({ ...prev, [slot]: undefined }));
    setUploading((prev) => ({ ...prev, [slot]: false }));
    setFailed((prev) => ({ ...prev, [slot]: undefined }));
  }

  // Picker option objects mirror EvidencePicker.pickPhotos, single select.
  async function pickPhoto(source: 'camera' | 'gallery') {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t('student.permissionRequiredTitle', 'Permission Required'),
          t('student.cameraPermissionMessage', 'Camera permission is needed to take photos.'),
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (!result.canceled && result.assets.length > 0) uploadPhotoAsset(result.assets[0]);
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t('student.permissionRequiredTitle', 'Permission Required'),
          t('student.galleryPermissionMessage', 'Gallery permission is needed to select photos.'),
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsMultipleSelection: false,
        selectionLimit: 1,
      });
      if (!result.canceled && result.assets.length > 0) uploadPhotoAsset(result.assets[0]);
    }
  }

  function uploadPhotoAsset(asset: ImagePicker.ImagePickerAsset) {
    const name = asset.fileName || `photo-${Date.now()}.jpg`;
    const mime = asset.mimeType || 'image/jpeg';
    upload('photo', { uri: asset.uri, name, mime, size: asset.fileSize ?? undefined });
  }

  function showPhotoOptions() {
    Alert.alert(
      t('common.selectPhoto', 'Select Photo'),
      undefined,
      [
        { text: t('common.camera', 'Camera'), onPress: () => pickPhoto('camera') },
        { text: t('common.gallery', 'Gallery'), onPress: () => pickPhoto('gallery') },
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      ],
    );
  }

  async function pickDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];
        upload('document', {
          uri: asset.uri,
          name: asset.name,
          mime: asset.mimeType ?? 'application/octet-stream',
          size: asset.size ?? undefined,
        });
      }
    } catch (err) {
      // The picker itself failed to open; nothing was added, but the user
      // still needs to know why nothing happened.
      console.warn('Feed document picker failed:', err instanceof Error ? err.message : err);
      Alert.alert(t('common.error', 'An error occurred'), t('student.documentPickerError', 'Could not open document picker.'));
    }
  }

  function renderFileChip(slot: FileSlot) {
    const file = pending[slot];
    const done = draft[slot];
    if (!file && !done) return null;
    const isUploading = !!uploading[slot];
    const isFailed = !!failed[slot];
    const label = slot === 'photo' ? undefined : (file?.name || done?.name);
    return (
      <View style={styles.chip}>
        {slot === 'photo' && file ? (
          <View style={styles.thumbWrap}>
            <Image source={{ uri: file.uri }} style={styles.thumb} />
            {isUploading && (
              <View style={styles.thumbOverlay}>
                <ActivityIndicator size="small" color={colors.surface} />
              </View>
            )}
          </View>
        ) : isUploading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name={isFailed ? 'warning-outline' : 'document-outline'} size={18} color={isFailed ? colors.error : colors.primary} />
        )}
        <View style={styles.chipBody}>
          {!!label && <Text style={styles.chipText} numberOfLines={1}>{label}</Text>}
          {isFailed && (
            <View style={styles.failedRow}>
              <Text style={styles.failedText}>{t('student.uploadFailed', 'Upload failed')}</Text>
              <TouchableOpacity onPress={() => retry(slot)} hitSlop={8}>
                <Text style={styles.retryText}>{t('student.retry', 'Retry')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={() => clearSlot(slot)} hitSlop={8}>
          <Ionicons name="close-circle" size={20} color={colors.textDisabled} />
        </TouchableOpacity>
      </View>
    );
  }

  const photoSlotUsed = !!draft.photo || !!pending.photo;
  const documentSlotUsed = !!draft.document || !!pending.document;
  const linkSlotUsed = linkOpen || !!draft.link;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { reset(); onClose(); }} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>{kind === 'poll' ? t('feed.createPoll') : t('feed.writeAnnouncement')}</Text>
          <TouchableOpacity onPress={post} disabled={!canPost || posting} hitSlop={8}>
            {posting
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={[styles.postBtn, !canPost && styles.postBtnDisabled]}>{t('feed.post')}</Text>}
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            style={styles.body}
            placeholder={kind === 'poll' ? t('feed.composerQuestionPlaceholder') : t('feed.composerBodyPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            value={body}
            onChangeText={(v) => setBody(v.slice(0, max))}
            multiline
            autoFocus
          />
          <Text style={styles.counter}>{t('feed.charCount', { count: body.length, max })}</Text>

          {kind === 'announcement' && (
            <View style={styles.attachments}>
              {renderFileChip('photo')}
              {renderFileChip('document')}

              {linkSlotUsed && (
                <View style={styles.chip}>
                  <Ionicons name="link-outline" size={18} color={linkOk ? colors.primary : colors.error} />
                  <View style={styles.chipBody}>
                    <TextInput
                      style={styles.linkInput}
                      placeholder={t('feed.linkUrlPlaceholder', 'https://…')}
                      placeholderTextColor={colors.textSecondary}
                      value={linkUrl}
                      onChangeText={(v) => setDraft((prev) => ({ ...prev, link: { url: v, title: prev.link?.title } }))}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      autoFocus
                    />
                    <TextInput
                      style={styles.linkInput}
                      placeholder={t('feed.linkTitlePlaceholder', 'Link title (optional)')}
                      placeholderTextColor={colors.textSecondary}
                      value={draft.link?.title ?? ''}
                      onChangeText={(v) => setDraft((prev) => ({ ...prev, link: { url: prev.link?.url ?? '', title: v } }))}
                    />
                    {!linkOk && (
                      <Text style={styles.failedText}>
                        {t('feed.invalidLink', 'Enter a full address starting with http:// or https://')}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={() => clearSlot('link')} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={colors.textDisabled} />
                  </TouchableOpacity>
                </View>
              )}

              {anyFailed && (
                <Text style={styles.failedText}>
                  {t('feed.attachmentUploadFailed', 'Attachment upload failed. Remove it or try again.')}
                </Text>
              )}

              <View style={styles.addRow}>
                {!photoSlotUsed && (
                  <TouchableOpacity style={styles.addBtn} onPress={showPhotoOptions} activeOpacity={0.7}>
                    <Ionicons name="camera-outline" size={18} color={colors.primary} />
                    <Text style={styles.addBtnText}>{t('student.addPhoto', 'Add Photo')}</Text>
                  </TouchableOpacity>
                )}
                {!documentSlotUsed && (
                  <TouchableOpacity style={styles.addBtn} onPress={pickDocument} activeOpacity={0.7}>
                    <Ionicons name="document-attach-outline" size={18} color={colors.primary} />
                    <Text style={styles.addBtnText}>{t('student.addDocument', 'Add Document')}</Text>
                  </TouchableOpacity>
                )}
                {!linkSlotUsed && (
                  <TouchableOpacity style={styles.addBtn} onPress={() => setLinkOpen(true)} activeOpacity={0.7}>
                    <Ionicons name="link-outline" size={18} color={colors.primary} />
                    <Text style={styles.addBtnText}>{t('feed.addLink', 'Add link')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {kind === 'poll' && (
            <View style={styles.options}>
              {options.map((o, i) => (
                <View key={i} style={styles.optionRow}>
                  <TextInput
                    style={styles.optionInput}
                    placeholder={t('feed.optionPlaceholder', { index: i + 1 })}
                    placeholderTextColor={colors.textSecondary}
                    value={o}
                    onChangeText={(v) => setOptions((prev) => prev.map((x, j) => (j === i ? v.slice(0, OPTION_MAX) : x)))}
                  />
                  {options.length > MIN_OPTIONS && (
                    <TouchableOpacity onPress={() => setOptions((prev) => prev.filter((_, j) => j !== i))} hitSlop={8}>
                      <Ionicons name="close-circle" size={20} color={colors.textDisabled} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {options.length < MAX_OPTIONS && (
                <TouchableOpacity style={styles.addOption} onPress={() => setOptions((prev) => [...prev, ''])} activeOpacity={0.7}>
                  <Ionicons name="add" size={18} color={colors.primary} />
                  <Text style={styles.addOptionText}>{t('feed.addOption')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  postBtn: { fontSize: 16, fontWeight: '600', color: colors.primary },
  postBtnDisabled: { color: colors.textDisabled },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  body: { minHeight: 120, fontSize: 16, color: colors.text, textAlignVertical: 'top' },
  counter: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
  options: { gap: spacing.sm, marginTop: spacing.md },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionInput: { flex: 1, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  addOptionText: { fontSize: 14, color: colors.primary, fontWeight: '500' },

  // Attachments
  attachments: { gap: spacing.sm, marginTop: spacing.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipBody: { flex: 1, gap: spacing.xs },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  thumbWrap: { position: 'relative' },
  thumb: { width: 48, height: 48, borderRadius: borderRadius.sm },
  thumbOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: borderRadius.sm, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  failedText: { fontSize: 12, color: colors.error },
  retryText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  linkInput: { fontSize: 14, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.primary + '40', borderStyle: 'dashed', borderRadius: borderRadius.sm, backgroundColor: colors.primary + '06' },
  addBtnText: { fontSize: 13, color: colors.primary, fontWeight: '500' },
});
