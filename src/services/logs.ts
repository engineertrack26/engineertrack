import { supabase } from './supabase';
import { LogStatus } from '@/types/log';

interface CreateLogParams {
  studentId: string;
  date: string;
  title: string;
  content: string;
  activitiesPerformed?: string;
  skillsLearned?: string;
  challengesFaced?: string;
}

interface UpdateLogParams {
  title?: string;
  content?: string;
  activitiesPerformed?: string;
  skillsLearned?: string;
  challengesFaced?: string;
  status?: LogStatus;
}

export const logService = {
  async createLog(params: CreateLogParams) {
    const { data, error } = await supabase
      .from('daily_logs')
      .insert({
        student_id: params.studentId,
        date: params.date,
        title: params.title,
        content: params.content,
        activities_performed: params.activitiesPerformed,
        skills_learned: params.skillsLearned,
        challenges_faced: params.challengesFaced,
        status: 'draft',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateLog(logId: string, updates: UpdateLogParams) {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.content !== undefined) dbUpdates.content = updates.content;
    if (updates.activitiesPerformed !== undefined) dbUpdates.activities_performed = updates.activitiesPerformed;
    if (updates.skillsLearned !== undefined) dbUpdates.skills_learned = updates.skillsLearned;
    if (updates.challengesFaced !== undefined) dbUpdates.challenges_faced = updates.challengesFaced;
    if (updates.status !== undefined) dbUpdates.status = updates.status;

    const { data, error } = await supabase
      .from('daily_logs')
      .update(dbUpdates)
      .eq('id', logId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async submitLog(logId: string) {
    return this.updateLog(logId, { status: 'submitted' });
  },

  async getLogsByStudent(studentId: string) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('student_id', studentId)
      .order('date', { ascending: false });
    if (error) throw error;
    return data;
  },

  async getLogByDate(studentId: string, date: string) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('student_id', studentId)
      .eq('date', date)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async getLogWithDetails(logId: string) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select(`
        *,
        log_photos (*),
        log_documents (*),
        self_assessments (*),
        mentor_feedbacks (*),
        revision_history (*)
      `)
      .eq('id', logId)
      .single();
    if (error) throw error;
    return data;
  },

  async getPendingReviewLogs(mentorId: string) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('*, profiles!daily_logs_student_id_fkey(first_name, last_name)')
      .eq('status', 'submitted')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  },

  // Photo attachments
  async uploadPhoto(logId: string, userId: string, uri: string, caption?: string) {
    const fileName = `${userId}/${logId}/${Date.now()}.jpg`;
    const response = await fetch(uri);
    const blob = await response.blob();

    const { error: uploadError } = await supabase.storage
      .from('log-photos')
      .upload(fileName, blob, { contentType: 'image/jpeg' });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('log-photos')
      .getPublicUrl(fileName);

    const { data, error } = await supabase
      .from('log_photos')
      .insert({ log_id: logId, uri: urlData.publicUrl, caption })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Document attachments
  async uploadDocument(
    logId: string,
    userId: string,
    uri: string,
    fileName: string,
    fileType: string,
    fileSize: number,
  ) {
    const storagePath = `${userId}/${logId}/${Date.now()}_${fileName}`;
    const response = await fetch(uri);
    const blob = await response.blob();

    const { error: uploadError } = await supabase.storage
      .from('log-documents')
      .upload(storagePath, blob, { contentType: fileType });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('log-documents')
      .getPublicUrl(storagePath);

    const { data, error } = await supabase
      .from('log_documents')
      .insert({
        log_id: logId,
        uri: urlData.publicUrl,
        file_name: fileName,
        file_type: fileType,
        file_size: fileSize,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Self assessment
  async saveSelfAssessment(
    logId: string,
    competencyRatings: Record<string, number>,
    reflectionNotes: string,
  ) {
    const { data, error } = await supabase
      .from('self_assessments')
      .upsert(
        {
          log_id: logId,
          competency_ratings: competencyRatings,
          reflection_notes: reflectionNotes,
        },
        { onConflict: 'log_id' },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // Mentor feedback
  async submitFeedback(
    logId: string,
    mentorId: string,
    rating: number,
    comments: string,
    competencyRatings: Record<string, number>,
    isApproved: boolean,
    revisionNotes?: string,
  ) {
    const { data, error } = await supabase
      .from('mentor_feedbacks')
      .insert({
        log_id: logId,
        mentor_id: mentorId,
        rating,
        comments,
        competency_ratings: competencyRatings,
        is_approved: isApproved,
        revision_required: !isApproved,
        revision_notes: revisionNotes,
      })
      .select()
      .single();
    if (error) throw error;

    // Update log status
    const newStatus = isApproved ? 'approved' : 'needs_revision';
    await this.updateLog(logId, { status: newStatus });

    return data;
  },
};
