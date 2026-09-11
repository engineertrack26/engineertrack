import { supabase } from './supabase';
// One implementation, shared with the assignment evidence paths. Two copies
// of this would drift the moment a bucket or a URL shape changed.
import { uploadToBucket } from './evidenceUrls';

// What is left of the daily-log service after the log was retired. The
// write path (create / update / submit / self-assessment / feedback) and
// the per-log attachment rows are gone with the screens that called them;
// git has them. What remains has live callers: the student's log history
// still reads old logs, and the two uploaders are the ONE upload
// implementation the task evidence picker uses -- they are here because the
// buckets are still named log-photos and log-documents.
export const logService = {
  async getLogsByStudent(studentId: string) {
    const { data, error } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('student_id', studentId)
      .order('date', { ascending: false });
    if (error) throw error;
    return data;
  },
  /** POST a photo to the log-photos bucket and return its public URL.
   *
   *  The storage policy keys on (storage.foldername(name))[1] = auth.uid()::text
   *  -- only the FIRST path segment matters, so `scopeId` is free. The daily-log
   *  path passes a log id; the task path passes an assignment id, because the
   *  submission id does not exist until submit_assignment runs. */
  async uploadPhotoFile(userId: string, scopeId: string, uri: string): Promise<string> {
    const fileName = `${userId}/${scopeId}/${Date.now()}.jpg`;
    await uploadToBucket('log-photos', fileName, uri, 'photo.jpg', 'image/jpeg');

    const { data: urlData } = supabase.storage.from('log-photos').getPublicUrl(fileName);
    return urlData.publicUrl;
  },
  /** POST a document to the log-documents bucket and return its public URL.
   *  Same shape as uploadPhotoFile; see that comment for the scopeId note.
   *  Takes no fileSize -- that is metadata the caller already has, and the
   *  bucket does not need it. */
  async uploadDocumentFile(
    userId: string,
    scopeId: string,
    uri: string,
    fileName: string,
    fileType: string,
  ): Promise<string> {
    const storagePath = `${userId}/${scopeId}/${Date.now()}_${fileName}`;
    await uploadToBucket('log-documents', storagePath, uri, fileName, fileType);

    const { data: urlData } = supabase.storage.from('log-documents').getPublicUrl(storagePath);
    return urlData.publicUrl;
  },
};
