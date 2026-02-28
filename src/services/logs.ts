import { supabase } from './supabase';
import { LogStatus } from '@/types/log';

function extractStoragePath(urlOrPath: string, bucket: string): string {
  if (!urlOrPath) return '';
  if (!urlOrPath.startsWith('http')) {
    return urlOrPath.replace(new RegExp(`^${bucket}/`), '');
  }

  const markers = [
    `/object/public/${bucket}/`,
    `/object/sign/${bucket}/`,
    `/object/${bucket}/`,
  ];
  const marker = markers.find((m) => urlOrPath.includes(m));
  if (!marker) return '';

  const after = urlOrPath.split(marker)[1] || '';
  const path = after.split('?')[0] || '';
  return decodeURIComponent(path);
}

interface CreateLogParams {
  studentId: string;
  date: string;
  title: string;
  content: string;
  activitiesPerformed?: string;
  skillsLearned?: string;
  challengesFaced?: string;
  hoursSpent?: number;
}

interface UpdateLogParams {
  title?: string;
  content?: string;
  activitiesPerformed?: string;
  skillsLearned?: string;
  challengesFaced?: string;
  hoursSpent?: number;
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
        hours_spent: params.hoursSpent || 0,
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
    if (updates.hoursSpent !== undefined) dbUpdates.hours_spent = updates.hoursSpent;
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
        mentor_feedbacks (*),
        revision_history (*)
      `)
      .eq('id', logId)
      .single();
    if (error) throw error;

    // Fetch self_assessments separately to avoid PostgREST nested join RLS issues
    const { data: saData } = await supabase
      .from('self_assessments')
      .select('*')
      .eq('log_id', logId)
      .maybeSingle();

    // Buckets are private; convert stored photo URLs/paths into short-lived signed URLs.
    const row = data as Record<string, unknown>;
    row.self_assessments = saData ? [saData] : [];
    const photos = Array.isArray(row.log_photos) ? (row.log_photos as Array<Record<string, unknown>>) : [];
    if (photos.length > 0) {
      const signedPhotos = await Promise.all(
        photos.map(async (p) => {
          const originalUri = (p.uri as string) || '';
          const path = extractStoragePath(originalUri, 'log-photos');
          if (!path) return p;

          const { data: signed, error: signErr } = await supabase.storage
            .from('log-photos')
            .createSignedUrl(path, 60 * 60);
          if (signErr || !signed?.signedUrl) return p;

          return {
            ...p,
            uri: signed.signedUrl,
          };
        }),
      );
      row.log_photos = signedPhotos;
    }

    return row;
  },

  async getPendingReviewLogs(mentorId: string) {
    // Limit to mentor's assigned students
    const { data: students, error: studentsError } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('mentor_id', mentorId);
    if (studentsError) throw studentsError;

    const studentIds = (students || []).map((s) => s.id);
    if (studentIds.length === 0) return [];

    const { data, error } = await supabase
      .from('daily_logs')
      .select('*, profiles!daily_logs_student_id_fkey(first_name, last_name)')
      .eq('status', 'submitted')
      .in('student_id', studentIds)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data;
  },

  // Photo attachments
  async uploadPhoto(logId: string, userId: string, uri: string, caption?: string) {
    const fileName = `${userId}/${logId}/${Date.now()}.jpg`;

    // Use FormData REST API for reliable React Native upload
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No session');

    const formData = new FormData();
    formData.append('', {
      uri,
      name: 'photo.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);

    const uploadRes = await fetch(
      `${supabaseUrl}/storage/v1/object/log-photos/${fileName}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      },
    );
    if (!uploadRes.ok) {
      const errBody = await uploadRes.text();
      throw new Error(errBody || 'Photo upload failed');
    }

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

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No session');

    const formData = new FormData();
    formData.append('', {
      uri,
      name: fileName,
      type: fileType,
    } as unknown as Blob);

    const uploadRes = await fetch(
      `${supabaseUrl}/storage/v1/object/log-documents/${storagePath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      },
    );
    if (!uploadRes.ok) {
      const errBody = await uploadRes.text();
      throw new Error(errBody || 'Document upload failed');
    }

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
    areasOfExcellence?: string,
  ) {
    // Defense-in-depth: verify caller is the stated mentor,
    // and that mentor is actually assigned to the log's student.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== mentorId) {
      throw new Error('Unauthorized: mentor ID mismatch');
    }

    const { data: log, error: logErr } = await supabase
      .from('daily_logs')
      .select('student_id')
      .eq('id', logId)
      .single();
    if (logErr || !log) throw new Error('Log not found');

    const { data: sp, error: spErr } = await supabase
      .from('student_profiles')
      .select('mentor_id')
      .eq('id', (log as Record<string, unknown>).student_id as string)
      .single();
    if (spErr || !sp) throw new Error('Student profile not found');
    if ((sp as Record<string, unknown>).mentor_id !== user.id) {
      throw new Error('Unauthorized: not assigned to this student');
    }

    const insertData: Record<string, unknown> = {
      log_id: logId,
      mentor_id: mentorId,
      rating,
      comments,
      competency_ratings: competencyRatings,
      is_approved: isApproved,
      revision_required: !isApproved,
      revision_notes: revisionNotes,
    };
    if (areasOfExcellence) {
      insertData.areas_of_excellence = areasOfExcellence;
    }

    const { data, error } = await supabase
      .from('mentor_feedbacks')
      .insert(insertData)
      .select()
      .single();
    if (error) throw error;

    // Update log status
    const newStatus = isApproved ? 'approved' : 'needs_revision';
    await this.updateLog(logId, { status: newStatus });

    return data;
  },
};
