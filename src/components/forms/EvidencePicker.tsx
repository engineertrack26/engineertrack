import { useState } from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator, TextInput, StyleSheet, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { logService } from '@/services/logs';
import { colors, spacing, borderRadius } from '@/theme';
import type { PhotoEvidence, DocumentEvidence } from '@/types/assignment';

// Evidence is meant to be the proof, not an album. Three photos and one
// document is what a task submission needs.
//
// submit_assignment still awards 3 * LEAST(v_photos, 5), so its ceiling of five
// is now unreachable and the photo bonus tops out at 9 XP rather than 15. That
// is a defensive server-side cap, not a target, so it is left alone rather than
// requiring another migration -- but the two numbers no longer match, and this
// comment is the only thing that says so.
const MAX_PHOTOS = 3;
const MAX_DOCUMENTS = 1;

interface EvidencePickerProps {
  userId: string;
  scopeId: string;
  photos: PhotoEvidence[];
  documents: DocumentEvidence[];
  onChange: (photos: PhotoEvidence[], documents: DocumentEvidence[]) => void;
  disabled?: boolean;
}

type PendingStatus = 'uploading' | 'failed';

interface PendingPhoto {
  localId: string;
  uri: string; // device uri, kept around so a failed upload can be retried in place
  status: PendingStatus;
}

interface PendingDocument {
  localId: string;
  uri: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: PendingStatus;
}

function makeLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function EvidencePicker({
  userId, scopeId, photos, documents, onChange, disabled,
}: EvidencePickerProps) {
  const { t } = useTranslation();
  // Uploads are NOT held in the parent's arrays until they succeed -- these
  // two lists track in-flight/failed items by a local id so a failed upload
  // can be retried in place (using the device uri still held here) rather
  // than re-picked from scratch.
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [pendingDocuments, setPendingDocuments] = useState<PendingDocument[]>([]);

  const photoSlotCount = photos.length + pendingPhotos.length;
  const atPhotoLimit = photoSlotCount >= MAX_PHOTOS;
  const documentSlotCount = documents.length + pendingDocuments.length;
  const atDocumentLimit = documentSlotCount >= MAX_DOCUMENTS;

  // Sequential on purpose: each upload appends to the *result* of the
  // previous onChange call rather than to the `photos` prop captured in this
  // closure, so a multi-select gallery pick doesn't drop earlier appends to
  // a stale array when several uploads resolve close together.
  async function uploadPhotos(uris: string[]) {
    let nextPhotos = photos;
    for (const uri of uris) {
      const localId = makeLocalId();
      setPendingPhotos((prev) => [...prev, { localId, uri, status: 'uploading' }]);
      try {
        const url = await logService.uploadPhotoFile(userId, scopeId, uri);
        nextPhotos = [...nextPhotos, { uri: url }];
        onChange(nextPhotos, documents);
        setPendingPhotos((prev) => prev.filter((p) => p.localId !== localId));
      } catch (err) {
        // Never swallow this silently. The UI says "Upload failed" and offers a
        // retry, but without the reason nobody can tell a permissions problem
        // from a network one -- and a discarded catch on an upload path is the
        // exact shape of the notification bug that went unnoticed for weeks.
        console.warn("Evidence photo upload failed:", err instanceof Error ? err.message : err);
        setPendingPhotos((prev) => prev.map((p) => (
          p.localId === localId ? { ...p, status: 'failed' } : p
        )));
      }
    }
  }

  async function retryPhoto(localId: string) {
    const item = pendingPhotos.find((p) => p.localId === localId);
    if (!item) return;
    setPendingPhotos((prev) => prev.map((p) => (
      p.localId === localId ? { ...p, status: 'uploading' } : p
    )));
    try {
      const url = await logService.uploadPhotoFile(userId, scopeId, item.uri);
      onChange([...photos, { uri: url }], documents);
      setPendingPhotos((prev) => prev.filter((p) => p.localId !== localId));
    } catch (err) {
      // Never swallow this silently. The UI says "Upload failed" and offers a
      // retry, but without the reason nobody can tell a permissions problem
      // from a network one -- and a discarded catch on an upload path is the
      // exact shape of the notification bug that went unnoticed for weeks.
      console.warn("Evidence photo upload failed:", err instanceof Error ? err.message : err);
      setPendingPhotos((prev) => prev.map((p) => (
        p.localId === localId ? { ...p, status: 'failed' } : p
      )));
    }
  }

  // Picker option objects below (mediaTypes/quality/allowsMultipleSelection/
  // selectionLimit, and the permission-request calls) are copied verbatim
  // from app/(student)/create-log.tsx.
  async function pickPhotos(source: 'camera' | 'gallery') {
    const remaining = MAX_PHOTOS - photoSlotCount;
    if (remaining <= 0) return;

    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t('student.permissionRequiredTitle', 'Permission Required'),
          t('student.cameraPermissionMessage', 'Camera permission is needed to take photos.'),
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (!result.canceled && result.assets.length > 0) {
        uploadPhotos(result.assets.slice(0, remaining).map((a) => a.uri));
      }
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
        allowsMultipleSelection: true,
        selectionLimit: remaining,
      });
      if (!result.canceled && result.assets.length > 0) {
        uploadPhotos(result.assets.slice(0, remaining).map((a) => a.uri));
      }
    }
  }

  function showPhotoOptions() {
    if (disabled || atPhotoLimit) return;
    Alert.alert(
      t('common.selectPhoto', 'Select Photo'),
      undefined,
      [
        { text: t('common.camera', 'Camera'), onPress: () => pickPhotos('camera') },
        { text: t('common.gallery', 'Gallery'), onPress: () => pickPhotos('gallery') },
        { text: t('common.cancel', 'Cancel'), style: 'cancel' },
      ],
    );
  }

  function removePhoto(index: number) {
    onChange(photos.filter((_, i) => i !== index), documents);
  }

  function removePendingPhoto(localId: string) {
    setPendingPhotos((prev) => prev.filter((p) => p.localId !== localId));
  }

  function updateCaption(index: number, caption: string) {
    const next = photos.slice();
    next[index] = { ...next[index], caption };
    onChange(next, documents);
  }

  async function uploadDocumentAsset(asset: DocumentPicker.DocumentPickerAsset) {
    const localId = makeLocalId();
    const fileType = asset.mimeType ?? 'application/octet-stream';
    // fileSize comes from the picker's result asset -- uploadDocumentFile
    // does not return it and the bucket does not need it, but log_documents
    // does.
    const fileSize = asset.size ?? 0;
    setPendingDocuments((prev) => [
      ...prev,
      { localId, uri: asset.uri, fileName: asset.name, fileType, fileSize, status: 'uploading' },
    ]);
    try {
      const url = await logService.uploadDocumentFile(userId, scopeId, asset.uri, asset.name, fileType);
      onChange(photos, [...documents, { uri: url, fileName: asset.name, fileType, fileSize }]);
      setPendingDocuments((prev) => prev.filter((d) => d.localId !== localId));
    } catch (err) {
      console.warn("Evidence document upload failed:", err instanceof Error ? err.message : err);
      setPendingDocuments((prev) => prev.map((d) => (
        d.localId === localId ? { ...d, status: 'failed' } : d
      )));
    }
  }

  async function retryDocument(localId: string) {
    const item = pendingDocuments.find((d) => d.localId === localId);
    if (!item) return;
    setPendingDocuments((prev) => prev.map((d) => (
      d.localId === localId ? { ...d, status: 'uploading' } : d
    )));
    try {
      const url = await logService.uploadDocumentFile(userId, scopeId, item.uri, item.fileName, item.fileType);
      onChange(photos, [...documents, {
        uri: url, fileName: item.fileName, fileType: item.fileType, fileSize: item.fileSize,
      }]);
      setPendingDocuments((prev) => prev.filter((d) => d.localId !== localId));
    } catch (err) {
      console.warn("Evidence document upload failed:", err instanceof Error ? err.message : err);
      setPendingDocuments((prev) => prev.map((d) => (
        d.localId === localId ? { ...d, status: 'failed' } : d
      )));
    }
  }

  async function pickDocument() {
    if (disabled || atDocumentLimit) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets.length > 0) {
        uploadDocumentAsset(result.assets[0]);
      }
    } catch {
      // Picker itself failed to open; nothing was added, so there is
      // nothing to roll back -- but the user still needs to know why
      // nothing happened.
      Alert.alert(t('common.error', 'An error occurred'), t('student.documentPickerError', 'Could not open document picker.'));
    }
  }

  function removeDocument(index: number) {
    // Removing only drops it from the array -- the uploaded file stays in
    // the bucket. Deleting from storage needs the object path, and this
    // component only holds the public URL; an orphaned object is cheaper
    // than a broken reference.
    onChange(photos, documents.filter((_, i) => i !== index));
  }

  function removePendingDocument(localId: string) {
    setPendingDocuments((prev) => prev.filter((d) => d.localId !== localId));
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="attach" size={18} color={colors.text} />
        <Text style={styles.headerTitle}>{t('student.evidence', 'Evidence')}</Text>
      </View>

      {/* Photos */}
      <View style={styles.subsection}>
        <View style={styles.subsectionHeader}>
          <Ionicons name="camera-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.count}>{photoSlotCount}/{MAX_PHOTOS}</Text>
        </View>

        {photos.map((photo, index) => (
          <View key={`photo-${index}`} style={styles.photoRow}>
            <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
            <TextInput
              style={styles.captionInput}
              placeholder={t('student.caption', 'Caption (optional)')}
              placeholderTextColor={colors.textSecondary}
              value={photo.caption ?? ''}
              onChangeText={(text) => updateCaption(index, text)}
              editable={!disabled}
            />
            <TouchableOpacity onPress={() => removePhoto(index)} disabled={disabled} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        ))}

        {pendingPhotos.map((pending) => (
          <View key={pending.localId} style={styles.photoRow}>
            <View style={styles.photoThumbWrap}>
              <Image source={{ uri: pending.uri }} style={styles.photoThumb} />
              {pending.status === 'uploading' && (
                <View style={styles.thumbOverlay}>
                  <ActivityIndicator size="small" color={colors.surface} />
                </View>
              )}
            </View>
            {pending.status === 'failed' ? (
              <View style={styles.failedInfo}>
                <Text style={styles.failedText}>{t('student.uploadFailed', 'Upload failed')}</Text>
                <TouchableOpacity onPress={() => retryPhoto(pending.localId)} disabled={disabled}>
                  <Text style={styles.retryText}>{t('student.retry', 'Retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.uploadingText}>{t('common.loading', 'Loading...')}</Text>
            )}
            <TouchableOpacity onPress={() => removePendingPhoto(pending.localId)} disabled={disabled} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        ))}

        {atPhotoLimit && (
          <Text style={styles.limitText}>{t('student.photoLimit', { count: MAX_PHOTOS })}</Text>
        )}

        <TouchableOpacity
          style={[styles.addBtn, (disabled || atPhotoLimit) && styles.addBtnDisabled]}
          onPress={showPhotoOptions}
          disabled={disabled || atPhotoLimit}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={18} color={colors.primary} />
          <Text style={styles.addBtnText}>{t('student.addPhoto', 'Add Photo')}</Text>
        </TouchableOpacity>
      </View>

      {/* Documents */}
      <View style={styles.subsection}>
        <View style={styles.subsectionHeader}>
          <Ionicons name="document-attach-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.count}>{documentSlotCount}/{MAX_DOCUMENTS}</Text>
        </View>

        {documents.map((doc, index) => (
          <View key={`doc-${index}`} style={styles.docRow}>
            <Ionicons name="document-outline" size={20} color={colors.primary} />
            <Text style={styles.docName} numberOfLines={1}>{doc.fileName}</Text>
            <TouchableOpacity onPress={() => removeDocument(index)} disabled={disabled} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        ))}

        {pendingDocuments.map((pending) => (
          <View key={pending.localId} style={styles.docRow}>
            {pending.status === 'uploading' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="warning-outline" size={20} color={colors.error} />
            )}
            <Text style={styles.docName} numberOfLines={1}>{pending.fileName}</Text>
            {pending.status === 'failed' && (
              <TouchableOpacity onPress={() => retryDocument(pending.localId)} disabled={disabled}>
                <Text style={styles.retryText}>{t('student.retry', 'Retry')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => removePendingDocument(pending.localId)} disabled={disabled} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        ))}

        {atDocumentLimit && (
          <Text style={styles.limitText}>{t('student.documentLimit', { count: MAX_DOCUMENTS })}</Text>
        )}

        <TouchableOpacity
          style={[styles.addBtn, (disabled || atDocumentLimit) && styles.addBtnDisabled]}
          onPress={pickDocument}
          disabled={disabled || atDocumentLimit}
          activeOpacity={0.7}
        >
          <Ionicons name="add" size={18} color={colors.primary} />
          <Text style={styles.addBtnText}>{t('student.addDocument', 'Add Document')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  subsection: {
    gap: spacing.xs,
  },
  subsectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  count: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },

  // Photos
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  photoThumbWrap: {
    position: 'relative',
  },
  photoThumb: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.sm,
  },
  thumbOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: borderRadius.sm,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionInput: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    paddingVertical: spacing.xs,
  },
  uploadingText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  failedInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  failedText: {
    fontSize: 12,
    color: colors.error,
  },
  retryText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  limitText: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  // Documents
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  docName: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
    fontWeight: '500',
  },

  // Shared add button
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primary + '40',
    borderStyle: 'dashed',
    borderRadius: borderRadius.sm,
    justifyContent: 'center',
    backgroundColor: colors.primary + '06',
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '500',
  },
});
