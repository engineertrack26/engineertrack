import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { feedService } from '@/services/feed';
import { mapRpcError } from '@/utils/rpcErrors';
import { isValidLink, attachmentsPayload, type AttachmentDraft } from '@/utils/feedAttachments';
import { postableGroups, summarisePost, type PostOutcome, type TargetGroup } from '@/utils/feedTargets';
import { colors, spacing, borderRadius, fonts } from '@/theme';

interface Props {
  visible: boolean;
  kind: 'announcement' | 'poll';
  /** The group open in the stream: always a target, cannot be deselected. */
  groupId: string;
  /** Every group the advisor has; archived ones are offered only when
   *  they are the current group. */
  groups: TargetGroup[];
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

export function FeedComposer({ visible, kind, groupId, groups, onClose, onPosted }: Props) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [posting, setPosting] = useState(false);
  const max = kind === 'poll' ? QUESTION_MAX : BODY_MAX;

  // Which groups receive the post. The current group is always in; other
  // postable groups are added by tapping their chip. Each group gets its
  // own post (own comments, own votes).
  const [targets, setTargets] = useState<string[]>([groupId]);
  useEffect(() => { setTargets([groupId]); }, [groupId]);
  const postable = postableGroups(groups, groupId);
  const currentName = groups.find((g) => g.id === groupId)?.name ?? '';

  // Announcement attachments: one slot per kind. `draft` holds only what
  // has finished uploading (a storage path) or the link as typed; `pending`
  // holds a picked file while its upload is in flight or after it failed.
  const [draft, setDraft] = useState<AttachmentDraft>({});
  const [pending, setPending] = useState<Partial<Record<FileSlot, PickedFile>>>({});
  const [uploading, setUploading] = useState<Partial<Record<FileSlot, boolean>>>({});
  const [failed, setFailed] = useState<Partial<Record<FileSlot, string>>>({});
  const [linkOpen, setLinkOpen] = useState(false);
  // One counter per slot: a pick bumps it and captures the value, a clear
  // bumps it again, and a completion that no longer holds the current value
  // was cleared (or re-picked) mid-flight and must not touch state -- else
  // a late success re-fills the slot and a late failure sets a flag with no
  // chip left to clear it.
  const uploadToken = useRef<{ photo: number; document: number }>({ photo: 0, document: 0 });

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
    uploadToken.current.photo += 1;
    uploadToken.current.document += 1;
    setBody('');
    setOptions(['', '']);
    setTargets([groupId]);
    setDraft({});
    setPending({});
    setUploading({});
    setFailed({});
    setLinkOpen(false);
  }

  function toggleTarget(id: string) {
    if (id === groupId) return;
    setTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** The current group's attachments were uploaded into its folder; another
   *  group needs its own copies, so re-upload the picked files there and
   *  swap the storage paths. The link needs nothing. */
  async function draftFor(targetGroupId: string, base: AttachmentDraft): Promise<AttachmentDraft> {
    const next: AttachmentDraft = { ...base };
    const photo = pending.photo;
    if (photo && base.photo) {
      const path = await feedService.uploadFeedAttachment(targetGroupId, photo.uri, photo.name, photo.mime);
      next.photo = { ...base.photo, path };
    }
    const document = pending.document;
    if (document && base.document) {
      const path = await feedService.uploadFeedAttachment(targetGroupId, document.uri, document.name, document.mime);
      next.document = { ...base.document, path };
    }
    return next;
  }

  /** Post now (asDraft = false) or save a draft (asDraft = true) to EVERY
   *  target group; a draft goes through the same loop because each group
   *  gets its own row either way, and the same canPost gate because a
   *  draft still needs a body, valid options and finished attachments.
   *  (`draft` the state is the attachment draft; hence `asDraft`.) */
  async function post(asDraft = false) {
    if (!canPost || posting) return;
    setPosting(true);
    try {
      // An empty link row (opened but never typed in) is not an attachment.
      const baseDraft = linkUrl.trim() ? draft : { ...draft, link: undefined };
      // Current group first, then the other selected ones in postable order.
      const list: TargetGroup[] = [
        { id: groupId, name: currentName },
        ...postable.filter((g) => g.id !== groupId && targets.includes(g.id)),
      ];
      const outcomes: PostOutcome[] = [];
      let lastError: unknown;
      for (const g of list) {
        try {
          let payload: ReturnType<typeof attachmentsPayload> | undefined;
          if (kind === 'announcement') {
            const groupDraft = g.id === groupId ? baseDraft : await draftFor(g.id, baseDraft);
            payload = attachmentsPayload(groupDraft);
          }
          await feedService.createPost(
            g.id,
            kind,
            body.trim(),
            kind === 'poll' ? filled : undefined,
            payload,
            asDraft,
          );
          outcomes.push({ groupId: g.id, name: g.name, ok: true });
        } catch (err) {
          console.warn(`Feed post to group ${g.id} failed:`, err instanceof Error ? err.message : err);
          lastError = err;
          outcomes.push({ groupId: g.id, name: g.name, ok: false });
        }
      }

      const s = summarisePost(outcomes);
      if (s.failed.length === 0) {
        // A single-group post succeeds silently, as it always has; only a
        // multi-group post confirms how many groups received it. The one
        // exception is a single-group DRAFT: nothing appears in the stream,
        // so the user needs to be told where it went.
        if (outcomes.length === 1 && asDraft) {
          Alert.alert(
            t('common.done', 'Done'),
            t('feed.draftSaved', 'Saved as a draft. Publish it from the top of the stream when you are ready.'),
          );
        } else if (outcomes.length > 1) {
          Alert.alert(
            t('common.done', 'Done'),
            t('feed.postedToAll', {
              count: s.ok,
              defaultValue_one: 'Posted to {{count}} group.',
              defaultValue_other: 'Posted to {{count}} groups.',
            }),
          );
        }
        reset();
        onPosted();
      } else if (s.ok > 0) {
        Alert.alert(
          t('common.done', 'Done'),
          t('feed.postedToSome', {
            ok: s.ok,
            total: outcomes.length,
            failed: s.failed.join(', '),
            defaultValue: 'Posted to {{ok}} of {{total}} groups. Failed: {{failed}}',
          }),
        );
        reset();
        onPosted();
      } else if (outcomes.length === 1) {
        // A single-group post that failed reads exactly as before: the
        // mapped RPC reason, not a list of one group name.
        const { key } = mapRpcError(lastError instanceof Error ? lastError.message : '');
        Alert.alert(t('common.error'), t(key));
      } else {
        Alert.alert(
          t('common.error', 'An error occurred'),
          t('feed.postedToNone', {
            failed: s.failed.join(', '),
            defaultValue: 'Could not post to any group. Failed: {{failed}}',
          }),
        );
      }
    } finally {
      setPosting(false);
    }
  }

  async function upload(slot: FileSlot, file: PickedFile) {
    const token = ++uploadToken.current[slot];
    setPending((prev) => ({ ...prev, [slot]: file }));
    setUploading((prev) => ({ ...prev, [slot]: true }));
    setFailed((prev) => ({ ...prev, [slot]: undefined }));
    try {
      const path = await feedService.uploadFeedAttachment(groupId, file.uri, file.name, file.mime);
      if (token !== uploadToken.current[slot]) return;
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
      if (token !== uploadToken.current[slot]) return;
      setFailed((prev) => ({ ...prev, [slot]: file.uri }));
    } finally {
      if (token === uploadToken.current[slot]) {
        setUploading((prev) => ({ ...prev, [slot]: false }));
      }
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
    // Invalidate any upload still in flight for this slot before clearing.
    uploadToken.current[slot] += 1;
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
          <View style={styles.actions}>
            {posting ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <TouchableOpacity onPress={() => post(true)} disabled={!canPost} hitSlop={8}>
                  <Text style={[styles.draftBtn, !canPost && styles.postBtnDisabled]}>{t('feed.saveDraft', 'Save draft')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => post(false)} disabled={!canPost} hitSlop={8}>
                  <Text style={[styles.postBtn, !canPost && styles.postBtnDisabled]}>{t('feed.post')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {postable.length > 1 && (
            <View style={styles.targetsRow}>
              <Text style={styles.targetsLabel}>{t('feed.postTo', 'Post to')}</Text>
              {postable.map((g) => {
                const selected = g.id === groupId || targets.includes(g.id);
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.targetChip, selected && styles.targetChipActive]}
                    onPress={() => toggleTarget(g.id)}
                    disabled={g.id === groupId}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.targetChipText, selected && styles.targetChipTextActive]} numberOfLines={1}>{g.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
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
  title: { fontSize: 16, fontWeight: '600', fontFamily: fonts.semibold, color: colors.text },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  postBtn: { fontSize: 16, fontWeight: '600', fontFamily: fonts.semibold, color: colors.primary },
  draftBtn: { fontSize: 15, fontWeight: '500', fontFamily: fonts.medium, color: colors.textSecondary },
  postBtnDisabled: { color: colors.textDisabled },
  content: { paddingHorizontal: spacing.lg, gap: spacing.sm },

  // Post-to targets (chip styles mirror FeedScreen's group selector)
  targetsRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  targetsLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '500', fontFamily: fonts.medium },
  targetChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: borderRadius.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider },
  targetChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  targetChipText: { fontSize: 13, fontFamily: fonts.regular, color: colors.text, maxWidth: 160 },
  targetChipTextActive: { color: '#fff', fontWeight: '600', fontFamily: fonts.semibold },
  body: { minHeight: 120, fontSize: 16, fontFamily: fonts.regular, color: colors.text, textAlignVertical: 'top' },
  counter: { fontSize: 12, fontFamily: fonts.regular, color: colors.textSecondary, textAlign: 'right' },
  options: { gap: spacing.sm, marginTop: spacing.md },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionInput: { flex: 1, fontSize: 15, fontFamily: fonts.regular, color: colors.text, borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  addOptionText: { fontSize: 14, color: colors.primary, fontWeight: '500', fontFamily: fonts.medium },

  // Attachments
  attachments: { gap: spacing.sm, marginTop: spacing.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.divider, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipBody: { flex: 1, gap: spacing.xs },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '500', fontFamily: fonts.medium },
  thumbWrap: { position: 'relative' },
  thumb: { width: 48, height: 48, borderRadius: borderRadius.sm },
  thumbOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: borderRadius.sm, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  failedText: { fontSize: 12, fontFamily: fonts.regular, color: colors.error },
  retryText: { fontSize: 12, color: colors.primary, fontWeight: '600', fontFamily: fonts.semibold },
  linkInput: { fontSize: 14, fontFamily: fonts.regular, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.primary + '40', borderStyle: 'dashed', borderRadius: borderRadius.sm, backgroundColor: colors.primary + '06' },
  addBtnText: { fontSize: 13, color: colors.primary, fontWeight: '500', fontFamily: fonts.medium },
});
