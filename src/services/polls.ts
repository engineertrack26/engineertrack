import { supabase } from './supabase';
import { Poll, PollQuestion, PollOption } from '@/types/poll';

interface CreateQuestionInput {
  questionText: string;
  questionType: PollQuestion['questionType'];
  sortOrder: number;
  correctOptionIndex?: number;
  options: { optionText: string; sortOrder: number }[];
}

interface CreatePollInput {
  creatorId: string;
  institutionId?: string;
  title: string;
  description?: string;
  pollType: Poll['pollType'];
  targetRole: Poll['targetRole'];
  endsAt?: string;
}

function mapPoll(row: Record<string, unknown>): Poll {
  return {
    id: row.id as string,
    creatorId: (row.creator_id as string) || '',
    institutionId: (row.institution_id as string) || undefined,
    title: (row.title as string) || '',
    description: (row.description as string) || undefined,
    pollType: (row.poll_type as Poll['pollType']) || 'survey',
    targetRole: (row.target_role as Poll['targetRole']) || 'student',
    isActive: (row.is_active as boolean) ?? true,
    startsAt: (row.starts_at as string) || '',
    endsAt: (row.ends_at as string) || undefined,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

function mapQuestion(row: Record<string, unknown>): PollQuestion {
  const rawOptions = Array.isArray(row.poll_options) ? row.poll_options : [];
  return {
    id: row.id as string,
    pollId: (row.poll_id as string) || '',
    questionText: (row.question_text as string) || '',
    questionType: (row.question_type as PollQuestion['questionType']) || 'single_choice',
    sortOrder: (row.sort_order as number) || 0,
    correctOptionId: (row.correct_option_id as string) || undefined,
    options: rawOptions.map((o: Record<string, unknown>) => ({
      id: (o.id as string) || '',
      questionId: (o.question_id as string) || '',
      optionText: (o.option_text as string) || '',
      sortOrder: (o.sort_order as number) || 0,
    })),
  };
}

export const pollService = {
  async createPoll(
    poll: CreatePollInput,
    questions: CreateQuestionInput[],
  ): Promise<Poll> {
    // Insert poll
    const { data: pollData, error: pollError } = await supabase
      .from('polls')
      .insert({
        creator_id: poll.creatorId,
        institution_id: poll.institutionId || null,
        title: poll.title,
        description: poll.description || null,
        poll_type: poll.pollType,
        target_role: poll.targetRole,
        ends_at: poll.endsAt || null,
      })
      .select()
      .single();
    if (pollError) throw pollError;

    const pollId = pollData.id as string;

    // Insert questions + options
    for (const q of questions) {
      const { data: qData, error: qError } = await supabase
        .from('poll_questions')
        .insert({
          poll_id: pollId,
          question_text: q.questionText,
          question_type: q.questionType,
          sort_order: q.sortOrder,
        })
        .select()
        .single();
      if (qError) throw qError;

      const questionId = qData.id as string;

      if (q.options.length > 0) {
        const optionRows = q.options.map((o) => ({
          question_id: questionId,
          option_text: o.optionText,
          sort_order: o.sortOrder,
        }));

        const { data: optData, error: oError } = await supabase
          .from('poll_options')
          .insert(optionRows)
          .select();
        if (oError) throw oError;

        // Set correct option if quiz
        if (q.correctOptionIndex !== undefined && optData && optData[q.correctOptionIndex]) {
          await supabase
            .from('poll_questions')
            .update({ correct_option_id: (optData[q.correctOptionIndex] as Record<string, unknown>).id })
            .eq('id', questionId);
        }
      }
    }

    return mapPoll(pollData as Record<string, unknown>);
  },

  async getActivePolls(userId: string, role: string): Promise<Poll[]> {
    const { data, error } = await supabase
      .from('polls')
      .select('*')
      .eq('is_active', true)
      .or(`target_role.eq.${role},target_role.eq.all`)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Check which polls user has responded to
    const pollIds = (data || []).map((p: Record<string, unknown>) => p.id as string);
    let respondedSet = new Set<string>();

    if (pollIds.length > 0) {
      const { data: responses } = await supabase
        .from('poll_responses')
        .select('poll_id')
        .eq('user_id', userId)
        .in('poll_id', pollIds);
      respondedSet = new Set((responses || []).map((r: Record<string, unknown>) => r.poll_id as string));
    }

    return (data || []).map((row: Record<string, unknown>) => ({
      ...mapPoll(row),
      hasResponded: respondedSet.has(row.id as string),
    }));
  },

  async getMyPolls(creatorId: string): Promise<Poll[]> {
    const { data, error } = await supabase
      .from('polls')
      .select('*')
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Get response counts
    const polls = (data || []).map((row: Record<string, unknown>) => mapPoll(row));

    for (const poll of polls) {
      const { count } = await supabase
        .from('poll_responses')
        .select('id', { count: 'exact', head: true })
        .eq('poll_id', poll.id);
      poll.responseCount = count || 0;
    }

    return polls;
  },

  async getPollById(pollId: string, userId?: string): Promise<Poll> {
    const { data, error } = await supabase
      .from('polls')
      .select('*')
      .eq('id', pollId)
      .single();
    if (error) throw error;

    const poll = mapPoll(data as Record<string, unknown>);

    // Get questions with options
    const { data: qData, error: qError } = await supabase
      .from('poll_questions')
      .select('*, poll_options(*)')
      .eq('poll_id', pollId)
      .order('sort_order', { ascending: true });
    if (qError) throw qError;

    poll.questions = (qData || []).map((q: Record<string, unknown>) => mapQuestion(q));

    // Check if user responded
    if (userId) {
      const { data: resp } = await supabase
        .from('poll_responses')
        .select('id')
        .eq('poll_id', pollId)
        .eq('user_id', userId)
        .maybeSingle();
      poll.hasResponded = !!resp;
    }

    return poll;
  },

  async submitResponse(
    pollId: string,
    userId: string,
    answers: Record<string, unknown>,
  ): Promise<{ score?: number }> {
    // Get poll to check if quiz
    const { data: pollData } = await supabase
      .from('polls')
      .select('poll_type')
      .eq('id', pollId)
      .single();

    let score: number | undefined;

    if (pollData && (pollData as Record<string, unknown>).poll_type === 'quiz') {
      // Calculate score
      const { data: questions } = await supabase
        .from('poll_questions')
        .select('id, correct_option_id')
        .eq('poll_id', pollId);

      if (questions) {
        let correct = 0;
        let total = 0;
        for (const q of questions) {
          const qr = q as Record<string, unknown>;
          if (qr.correct_option_id) {
            total++;
            const userAnswer = answers[qr.id as string];
            if (userAnswer === qr.correct_option_id) {
              correct++;
            }
          }
        }
        score = total > 0 ? Math.round((correct / total) * 100) : undefined;
      }
    }

    const { error } = await supabase
      .from('poll_responses')
      .insert({
        poll_id: pollId,
        user_id: userId,
        answers,
        score: score ?? null,
      });
    if (error) throw error;

    return { score };
  },

  async getPollResults(pollId: string): Promise<{
    totalResponses: number;
    avgScore?: number;
    questionResults: {
      questionId: string;
      questionText: string;
      questionType: string;
      optionCounts: Record<string, number>;
      textAnswers: string[];
      avgRating?: number;
    }[];
  }> {
    // Get responses
    const { data: responses, error } = await supabase
      .from('poll_responses')
      .select('*')
      .eq('poll_id', pollId);
    if (error) throw error;

    const totalResponses = (responses || []).length;

    // Calculate average score for quizzes
    const scores = (responses || [])
      .map((r: Record<string, unknown>) => r.score as number | null)
      .filter((s): s is number => s !== null);
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : undefined;

    // Get questions with options
    const { data: questions } = await supabase
      .from('poll_questions')
      .select('*, poll_options(*)')
      .eq('poll_id', pollId)
      .order('sort_order', { ascending: true });

    const questionResults = (questions || []).map((q: Record<string, unknown>) => {
      const qId = q.id as string;
      const qType = q.question_type as string;
      const options = Array.isArray(q.poll_options) ? q.poll_options : [];
      const optionCounts: Record<string, number> = {};
      const textAnswers: string[] = [];
      let ratingSum = 0;
      let ratingCount = 0;

      // Initialize option counts
      for (const opt of options) {
        optionCounts[(opt as Record<string, unknown>).id as string] = 0;
      }

      // Count answers
      for (const resp of (responses || [])) {
        const answers = (resp as Record<string, unknown>).answers as Record<string, unknown>;
        const answer = answers[qId];
        if (answer === undefined || answer === null) continue;

        if (qType === 'text') {
          textAnswers.push(String(answer));
        } else if (qType === 'rating') {
          const val = Number(answer);
          if (!isNaN(val)) {
            ratingSum += val;
            ratingCount++;
          }
        } else if (qType === 'multiple_choice' && Array.isArray(answer)) {
          for (const optId of answer) {
            if (optionCounts[optId as string] !== undefined) {
              optionCounts[optId as string]++;
            }
          }
        } else {
          if (optionCounts[answer as string] !== undefined) {
            optionCounts[answer as string]++;
          }
        }
      }

      return {
        questionId: qId,
        questionText: (q.question_text as string) || '',
        questionType: qType,
        optionCounts,
        textAnswers,
        avgRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : undefined,
      };
    });

    return { totalResponses, avgScore, questionResults };
  },

  async closePoll(pollId: string): Promise<void> {
    const { error } = await supabase
      .from('polls')
      .update({ is_active: false })
      .eq('id', pollId);
    if (error) throw error;
  },

  async getUserResponses(userId: string): Promise<Poll[]> {
    const { data, error } = await supabase
      .from('poll_responses')
      .select('poll_id, score, submitted_at, polls(*)')
      .eq('user_id', userId)
      .order('submitted_at', { ascending: false });
    if (error) throw error;

    return (data || []).map((row: Record<string, unknown>) => {
      const pollData = row.polls as Record<string, unknown>;
      return {
        ...mapPoll(pollData),
        hasResponded: true,
      };
    });
  },

  async getResponseCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('poll_responses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error) throw error;
    return count || 0;
  },
};
