import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  ActionSheetIOS,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/store/authStore';
import { useLogStore } from '@/store/logStore';
import { logService } from '@/services/logs';
import { gamificationService } from '@/services/gamification';
import { Button } from '@/components/common';
import { DailyLog } from '@/types/log';
import { POINT_VALUES } from '@/types/gamification';
import { LIMITS, COMPETENCIES } from '@/utils/constants';
import { colors, spacing, borderRadius } from '@/theme';

function mapDbLog(row: Record<string, unknown>): DailyLog {
  return {
    id: row.id as string,
    studentId: (row.student_id as string) || '',
    date: row.date as string,
    title: (row.title as string) || '',
    content: (row.content as string) || '',
    activitiesPerformed: (row.activities_performed as string) || '',
    skillsLearned: (row.skills_learned as string) || '',
    challengesFaced: (row.challenges_faced as string) || '',
    status: (row.status as DailyLog['status']) || 'draft',
    photos: [],
    documents: [],
    revisionHistory: [],
    xpEarned: (row.xp_earned as number) || 0,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

const COMPETENCY_LABELS: Record<string, string> = {
  technical_skills: 'Technical Skills',
  problem_solving: 'Problem Solving',
  communication: 'Communication',
  teamwork: 'Teamwork',
  time_management: 'Time Management',
  adaptability: 'Adaptability',
  initiative: 'Initiative',
  professional_ethics: 'Professional Ethics',
};

export default function CreateLogScreen() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { addLog, updateLog: updateLogInStore } = useLogStore();

  const [existingLog, setExistingLog] = useState<DailyLog | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [activities, setActivities] = useState('');
  const [skills, setSkills] = useState('');
  const [challenges, setChallenges] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // New state for photos
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);

  // New state for self-assessment
  const [competencyRatings, setCompetencyRatings] = useState<Record<string, number>>({});
  const [reflectionNotes, setReflectionNotes] = useState('');

  const today = new Date().toISOString().split('T')[0];
  const formattedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const isEditMode = !!existingLog;
  const canEdit = !existingLog || existingLog.status === 'draft' || existingLog.status === 'needs_revision';

  // Dynamic point calculation
  const pointsPreview = useMemo(() => {
    const base = POINT_VALUES.dailyLogSubmit;
    const photoPoints = photos.length * POINT_VALUES.photoAttached;
    const allRated = COMPETENCIES.every((c) => competencyRatings[c] && competencyRatings[c] >= 1);
    const assessmentPoints = allRated ? POINT_VALUES.selfAssessment : 0;
    return { base, photoPoints, assessmentPoints, total: base + photoPoints + assessmentPoints };
  }, [photos.length, competencyRatings]);

  // Checklist state
  const checklist = useMemo(() => {
    const contentFilled = content.trim().length >= LIMITS.minLogContentLength;
    const hasPhotos = photos.length > 0;
    const allRated = COMPETENCIES.every((c) => competencyRatings[c] && competencyRatings[c] >= 1);
    const hasReflection = reflectionNotes.trim().length > 0;
    return { contentFilled, hasPhotos, allRated, hasReflection };
  }, [content, photos.length, competencyRatings, reflectionNotes]);

  const allChecklistDone = checklist.contentFilled && checklist.hasPhotos && checklist.allRated && checklist.hasReflection;

  useEffect(() => {
    loadTodayLog();
  }, []);

  const loadTodayLog = async () => {
    if (!user) return;
    try {
      const data = await logService.getLogByDate(user.id, today);
      if (data) {
        const log = mapDbLog(data);
        setExistingLog(log);
        setTitle(log.title);
        setContent(log.content);
        setActivities(log.activitiesPerformed);
        setSkills(log.skillsLearned);
        setChallenges(log.challengesFaced);
      }
    } catch (err) {
      console.error('Load today log error:', err);
    } finally {
      setLoading(false);
    }
  };

  const validate = (): string | null => {
    if (title.trim().length < LIMITS.minTitleLength) {
      return `Title must be at least ${LIMITS.minTitleLength} characters`;
    }
    if (title.trim().length > LIMITS.maxTitleLength) {
      return `Title must be less than ${LIMITS.maxTitleLength} characters`;
    }
    if (content.trim().length < LIMITS.minLogContentLength) {
      return `Content must be at least ${LIMITS.minLogContentLength} characters`;
    }
    if (content.trim().length > LIMITS.maxLogContentLength) {
      return `Content must be less than ${LIMITS.maxLogContentLength} characters`;
    }
    return null;
  };

  // Photo picker
  const pickPhotos = async (source: 'camera' | 'gallery') => {
    if (photos.length >= LIMITS.maxPhotosPerLog) {
      Alert.alert('Limit Reached', `Maximum ${LIMITS.maxPhotosPerLog} photos per log.`);
      return;
    }

    const remaining = LIMITS.maxPhotosPerLog - photos.length;

    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Camera permission is needed to take photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
      });
      if (!result.canceled && result.assets.length > 0) {
        setPhotos((prev) => [...prev, ...result.assets.slice(0, remaining)]);
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Gallery permission is needed to select photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
      });
      if (!result.canceled && result.assets.length > 0) {
        setPhotos((prev) => [...prev, ...result.assets.slice(0, remaining)]);
      }
    }
  };

  const showPhotoOptions = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Gallery'],
          cancelButtonIndex: 0,
        },
        (index) => {
          if (index === 1) pickPhotos('camera');
          if (index === 2) pickPhotos('gallery');
        },
      );
    } else {
      Alert.alert('Add Photo', 'Choose a source', [
        { text: 'Camera', onPress: () => pickPhotos('camera') },
        { text: 'Gallery', onPress: () => pickPhotos('gallery') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // Competency rating
  const setRating = (competency: string, rating: number) => {
    setCompetencyRatings((prev) => ({ ...prev, [competency]: rating }));
  };

  const handleSaveDraft = async () => {
    if (!user) return;
    const titleError = title.trim().length < LIMITS.minTitleLength
      ? `Title must be at least ${LIMITS.minTitleLength} characters`
      : null;
    if (titleError) {
      Alert.alert('Validation Error', titleError);
      return;
    }

    setSaving(true);
    try {
      if (existingLog) {
        const data = await logService.updateLog(existingLog.id, {
          title: title.trim(),
          content: content.trim(),
          activitiesPerformed: activities.trim(),
          skillsLearned: skills.trim(),
          challengesFaced: challenges.trim(),
        });
        const updated = mapDbLog(data);
        setExistingLog(updated);
        updateLogInStore(updated.id, updated);
        Alert.alert('Saved', 'Draft saved successfully');
      } else {
        const data = await logService.createLog({
          studentId: user.id,
          date: today,
          title: title.trim(),
          content: content.trim(),
          activitiesPerformed: activities.trim(),
          skillsLearned: skills.trim(),
          challengesFaced: challenges.trim(),
        });
        const newLog = mapDbLog(data);
        setExistingLog(newLog);
        addLog(newLog);
        Alert.alert('Saved', 'Draft created successfully');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save draft';
      Alert.alert('Error', message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!user) return;
    const error = validate();
    if (error) {
      Alert.alert('Validation Error', error);
      return;
    }

    setSubmitting(true);
    try {
      let logId: string;

      // 1. Create or update log
      if (existingLog) {
        await logService.updateLog(existingLog.id, {
          title: title.trim(),
          content: content.trim(),
          activitiesPerformed: activities.trim(),
          skillsLearned: skills.trim(),
          challengesFaced: challenges.trim(),
        });
        logId = existingLog.id;
      } else {
        const data = await logService.createLog({
          studentId: user.id,
          date: today,
          title: title.trim(),
          content: content.trim(),
          activitiesPerformed: activities.trim(),
          skillsLearned: skills.trim(),
          challengesFaced: challenges.trim(),
        });
        logId = data.id;
        addLog(mapDbLog(data));
      }

      // 2. Upload photos
      for (const photo of photos) {
        try {
          await logService.uploadPhoto(logId, user.id, photo.uri);
        } catch (photoErr) {
          console.warn('Photo upload failed:', photoErr);
        }
      }

      // 3. Save self-assessment if competencies are rated
      const allRated = COMPETENCIES.every((c) => competencyRatings[c] && competencyRatings[c] >= 1);
      if (allRated) {
        try {
          await logService.saveSelfAssessment(logId, competencyRatings, reflectionNotes.trim());
        } catch (assessErr) {
          console.warn('Self-assessment save failed:', assessErr);
        }
      }

      // 4. Submit log
      const submitted = await logService.submitLog(logId);
      const mappedSubmitted = mapDbLog(submitted);
      setExistingLog(mappedSubmitted);
      updateLogInStore(logId, mappedSubmitted);

      // 5. Process gamification XP
      try {
        await gamificationService.processLogSubmission(user.id, logId);
      } catch (xpErr) {
        console.warn('XP processing failed:', xpErr);
      }

      // 6. Photo XP (per photo)
      for (let i = 0; i < photos.length; i++) {
        try {
          await gamificationService.addXp(user.id, POINT_VALUES.photoAttached, 'photo_attached', logId);
        } catch (xpErr) {
          console.warn('Photo XP failed:', xpErr);
        }
      }

      // 7. Self-assessment XP
      if (allRated) {
        try {
          await gamificationService.addXp(user.id, POINT_VALUES.selfAssessment, 'self_assessment', logId);
        } catch (xpErr) {
          console.warn('Self-assessment XP failed:', xpErr);
        }
      }

      Alert.alert('Submitted', 'Your log has been submitted for review!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to submit log';
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Date Header */}
          <View style={styles.dateHeader}>
            <Text style={styles.dateText}>{formattedDate}</Text>
            {isEditMode && (
              <View style={[styles.statusChip, { backgroundColor: colors.status[existingLog.status.replace('_', '') as keyof typeof colors.status] + '18' || colors.status.draft + '18' }]}>
                <Text style={styles.statusText}>
                  {existingLog.status.replace('_', ' ').toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {/* Point Preview Card */}
          {canEdit && (
            <View style={styles.pointsCard}>
              <View style={styles.pointsHeader}>
                <Ionicons name="flash" size={20} color={colors.gamification.xp} />
                <Text style={styles.pointsTitle}>Points Preview</Text>
                <Text style={styles.pointsTotal}>{pointsPreview.total} pts</Text>
              </View>
              <View style={styles.pointsBreakdown}>
                <View style={styles.pointsRow}>
                  <Text style={styles.pointsLabel}>Log Submit</Text>
                  <Text style={styles.pointsValue}>+{pointsPreview.base}</Text>
                </View>
                {photos.length > 0 && (
                  <View style={styles.pointsRow}>
                    <Text style={styles.pointsLabel}>Photos ({photos.length}x)</Text>
                    <Text style={styles.pointsValue}>+{pointsPreview.photoPoints}</Text>
                  </View>
                )}
                {pointsPreview.assessmentPoints > 0 && (
                  <View style={styles.pointsRow}>
                    <Text style={styles.pointsLabel}>Self-Assessment</Text>
                    <Text style={styles.pointsValue}>+{pointsPreview.assessmentPoints}</Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* Title */}
          <View style={styles.field}>
            <Text style={styles.label}>
              {t('student.title')} *
            </Text>
            <TextInput
              style={styles.input}
              placeholder="What did you work on today?"
              placeholderTextColor={colors.textDisabled}
              value={title}
              onChangeText={setTitle}
              editable={canEdit}
              maxLength={LIMITS.maxTitleLength}
            />
            <Text style={styles.charCount}>
              {title.length}/{LIMITS.maxTitleLength}
            </Text>
          </View>

          {/* Content */}
          <View style={styles.field}>
            <Text style={styles.label}>
              {t('student.content')} *
            </Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Describe your work in detail (min 50 characters)..."
              placeholderTextColor={colors.textDisabled}
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              editable={canEdit}
              maxLength={LIMITS.maxLogContentLength}
            />
            <Text style={[styles.charCount, content.length < LIMITS.minLogContentLength && styles.charCountWarning]}>
              {content.length}/{LIMITS.maxLogContentLength} (min {LIMITS.minLogContentLength})
            </Text>
          </View>

          {/* Activities */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('student.activitiesPerformed')}</Text>
            <TextInput
              style={[styles.input, styles.multilineSmall]}
              placeholder="List the activities you performed..."
              placeholderTextColor={colors.textDisabled}
              value={activities}
              onChangeText={setActivities}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              editable={canEdit}
            />
          </View>

          {/* Skills */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('student.skillsLearned')}</Text>
            <TextInput
              style={[styles.input, styles.multilineSmall]}
              placeholder="What new skills did you learn?"
              placeholderTextColor={colors.textDisabled}
              value={skills}
              onChangeText={setSkills}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              editable={canEdit}
            />
          </View>

          {/* Challenges */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('student.challengesFaced')}</Text>
            <TextInput
              style={[styles.input, styles.multilineSmall]}
              placeholder="Any challenges or difficulties?"
              placeholderTextColor={colors.textDisabled}
              value={challenges}
              onChangeText={setChallenges}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              editable={canEdit}
            />
          </View>

          {/* Photo Upload Section */}
          {canEdit && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="camera" size={18} color={colors.text} />
                <Text style={styles.sectionTitle}>Photos</Text>
                <Text style={styles.sectionCount}>{photos.length}/{LIMITS.maxPhotosPerLog}</Text>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.photoScroll}
                contentContainerStyle={styles.photoScrollContent}
              >
                {photos.map((photo, index) => (
                  <View key={index} style={styles.photoThumb}>
                    <Image source={{ uri: photo.uri }} style={styles.photoImage} />
                    <TouchableOpacity
                      style={styles.photoRemove}
                      onPress={() => removePhoto(index)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="close-circle" size={22} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                ))}
                {photos.length < LIMITS.maxPhotosPerLog && (
                  <TouchableOpacity
                    style={styles.photoAdd}
                    onPress={showPhotoOptions}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="add" size={28} color={colors.primary} />
                    <Text style={styles.photoAddText}>Add</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>
          )}

          {/* Self-Assessment Section */}
          {canEdit && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="star" size={18} color={colors.text} />
                <Text style={styles.sectionTitle}>Self-Assessment</Text>
              </View>

              {COMPETENCIES.map((comp) => (
                <View key={comp} style={styles.competencyRow}>
                  <Text style={styles.competencyLabel}>
                    {COMPETENCY_LABELS[comp] || comp}
                  </Text>
                  <View style={styles.ratingRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity
                        key={star}
                        onPress={() => setRating(comp, star)}
                        activeOpacity={0.6}
                        style={styles.starButton}
                      >
                        <Ionicons
                          name={competencyRatings[comp] && competencyRatings[comp] >= star ? 'star' : 'star-outline'}
                          size={22}
                          color={competencyRatings[comp] && competencyRatings[comp] >= star ? colors.gamification.gold : colors.textDisabled}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}

              <View style={styles.reflectionField}>
                <Text style={styles.label}>Reflection Notes</Text>
                <TextInput
                  style={[styles.input, styles.multilineSmall]}
                  placeholder="Reflect on your day, your strengths, and areas to improve..."
                  placeholderTextColor={colors.textDisabled}
                  value={reflectionNotes}
                  onChangeText={setReflectionNotes}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>
            </View>
          )}

          {/* Submit Checklist */}
          {canEdit && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="checkbox" size={18} color={colors.text} />
                <Text style={styles.sectionTitle}>Submission Checklist</Text>
              </View>

              <View style={styles.checklistItem}>
                <Ionicons
                  name={checklist.contentFilled ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={checklist.contentFilled ? colors.success : colors.textDisabled}
                />
                <Text style={[styles.checklistText, checklist.contentFilled && styles.checklistDone]}>
                  Content filled (min {LIMITS.minLogContentLength} characters)
                </Text>
              </View>

              <View style={styles.checklistItem}>
                <Ionicons
                  name={checklist.hasPhotos ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={checklist.hasPhotos ? colors.success : colors.textDisabled}
                />
                <Text style={[styles.checklistText, checklist.hasPhotos && styles.checklistDone]}>
                  At least 1 photo attached
                </Text>
              </View>

              <View style={styles.checklistItem}>
                <Ionicons
                  name={checklist.allRated ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={checklist.allRated ? colors.success : colors.textDisabled}
                />
                <Text style={[styles.checklistText, checklist.allRated && styles.checklistDone]}>
                  All competencies rated
                </Text>
              </View>

              <View style={styles.checklistItem}>
                <Ionicons
                  name={checklist.hasReflection ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={checklist.hasReflection ? colors.success : colors.textDisabled}
                />
                <Text style={[styles.checklistText, checklist.hasReflection && styles.checklistDone]}>
                  Reflection notes written
                </Text>
              </View>
            </View>
          )}

          {/* Action Buttons */}
          {canEdit && (
            <View style={styles.actions}>
              <Button
                title={t('student.saveDraft')}
                onPress={handleSaveDraft}
                variant="outline"
                loading={saving}
                disabled={submitting}
                style={styles.actionButton}
              />
              <View style={{ width: spacing.sm }} />
              <Button
                title={t('student.submitLog')}
                onPress={handleSubmit}
                variant="primary"
                loading={submitting}
                disabled={saving || !allChecklistDone}
                style={styles.actionButton}
              />
            </View>
          )}

          {!canEdit && (
            <View style={styles.submittedBanner}>
              <Text style={styles.submittedText}>
                This log has been submitted and is {existingLog?.status.replace('_', ' ')}.
              </Text>
            </View>
          )}

          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  dateText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  statusChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  // Points Preview Card
  pointsCard: {
    backgroundColor: colors.gamification.xp + '12',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.gamification.xp + '30',
  },
  pointsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  pointsTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.gamification.xp,
    marginLeft: spacing.xs,
    flex: 1,
  },
  pointsTotal: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.gamification.xp,
  },
  pointsBreakdown: {
    gap: 4,
  },
  pointsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pointsLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  pointsValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gamification.xp,
  },

  // Form Fields
  field: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  multilineInput: {
    minHeight: 140,
  },
  multilineSmall: {
    minHeight: 80,
  },
  charCount: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'right',
    marginTop: 4,
  },
  charCountWarning: {
    color: colors.warning,
  },

  // Section
  section: {
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  sectionCount: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },

  // Photos
  photoScroll: {
    marginTop: spacing.xs,
  },
  photoScrollContent: {
    gap: spacing.sm,
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    position: 'relative',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
  },
  photoAdd: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.sm,
    borderWidth: 1.5,
    borderColor: colors.primary + '40',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary + '08',
  },
  photoAddText: {
    fontSize: 11,
    color: colors.primary,
    marginTop: 2,
  },

  // Self-Assessment
  competencyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  competencyLabel: {
    fontSize: 13,
    color: colors.text,
    flex: 1,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: 2,
  },
  starButton: {
    padding: 2,
  },
  reflectionField: {
    marginTop: spacing.md,
  },

  // Checklist
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  checklistText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  checklistDone: {
    color: colors.success,
  },

  // Actions
  actions: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
  submittedBanner: {
    backgroundColor: colors.info + '15',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  submittedText: {
    fontSize: 14,
    color: colors.info,
    fontWeight: '500',
    textAlign: 'center',
  },
});
