import { supabase } from './supabase';
import { RpcError } from './rpcError';
import type {
  Competency, CompetencyKpi, CompetencyProgress, WorkingKpi, GroupCompetencyTarget,
  SelfVsMentorRow,
} from '@/types/competency';

function mapCompetency(row: Record<string, unknown>): Competency {
  return {
    id: row.id as string,
    code: (row.code as string) || '',
    name: (row.name as string) || '',
    displayOrder: (row.display_order as number) ?? 0,
  };
}

function mapKpi(row: Record<string, unknown>): CompetencyKpi {
  return {
    id: row.id as string,
    competencyId: (row.competency_id as string) || '',
    level: (row.level as number) ?? 0,
    kpiIndex: (row.kpi_index as number) ?? 0,
    statement: (row.statement as string) || '',
  };
}

export const competencyService = {
  async listFramework(): Promise<{ competencies: Competency[]; kpis: CompetencyKpi[] }> {
    const [{ data: cs, error: cErr }, { data: ks, error: kErr }] = await Promise.all([
      supabase.from('competencies').select('*').order('display_order'),
      supabase.from('competency_kpis').select('*').order('level').order('kpi_index'),
    ]);
    if (cErr) throw cErr;
    if (kErr) throw kErr;
    return {
      competencies: (cs || []).map((r) => mapCompetency(r as Record<string, unknown>)),
      kpis: (ks || []).map((r) => mapKpi(r as Record<string, unknown>)),
    };
  },

  async getGroupTargets(groupId: string): Promise<GroupCompetencyTarget[]> {
    const { data, error } = await supabase
      .from('group_competency_targets')
      .select('competency_id, target_level')
      .eq('group_id', groupId);
    if (error) throw error;
    return (data || []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        competencyId: (row.competency_id as string) || '',
        targetLevel: (row.target_level as number) ?? 1,
      };
    });
  },

  /**
   * Replaces the group's whole selection. Deleting first is what makes
   * unticking a competency actually remove it — an upsert alone would leave
   * the old row in place and the competency would silently stay in scope.
   */
  async setGroupTargets(groupId: string, targets: GroupCompetencyTarget[]): Promise<void> {
    const { error: delErr } = await supabase
      .from('group_competency_targets')
      .delete()
      .eq('group_id', groupId);
    if (delErr) throw delErr;

    if (targets.length === 0) return;

    const { error } = await supabase.from('group_competency_targets').insert(
      targets.map((t) => ({
        group_id: groupId,
        competency_id: t.competencyId,
        target_level: t.targetLevel,
      })),
    );
    if (error) throw error;
  },

  async getProgress(studentId: string): Promise<CompetencyProgress[]> {
    const { data, error } = await supabase.rpc('get_competency_progress', {
      p_student_id: studentId,
    });
    if (error) throw new RpcError(error.message);
    return (data || []).map((r: Record<string, unknown>) => ({
      competencyId: (r.competency_id as string) || '',
      code: (r.competency_code as string) || '',
      name: (r.competency_name as string) || '',
      currentLevel: (r.current_level as number) ?? 0,
      targetLevel: (r.target_level as number) ?? 1,
    }));
  },

  async getWorkingKpis(studentId: string): Promise<WorkingKpi[]> {
    const { data, error } = await supabase.rpc('get_working_kpis', {
      p_student_id: studentId,
    });
    if (error) throw new RpcError(error.message);
    return (data || []).map((r: Record<string, unknown>) => ({
      kpiId: (r.kpi_id as string) || '',
      competencyId: (r.competency_id as string) || '',
      competencyName: (r.competency_name as string) || '',
      level: (r.level as number) ?? 0,
      kpiIndex: (r.kpi_index as number) ?? 0,
      statement: (r.statement as string) || '',
    }));
  },

  /** Per-competency self-vs-mentor comparison, visible to the student (own),
   *  their mentor and their group's advisor -- SELF_ASSESSMENT_FORBIDDEN for
   *  anyone else. Only competencies with at least one submission carrying
   *  both ratings get a row. See competency_self_vs_mentor and decision 4 in
   *  docs/superpowers/specs/2026-09-15-self-assessment-design.md. */
  async selfVsMentor(studentId: string): Promise<SelfVsMentorRow[]> {
    const { data, error } = await supabase.rpc('competency_self_vs_mentor', {
      p_student_id: studentId,
    });
    if (error) throw new RpcError(error.message);
    return ((data as Record<string, unknown>[]) || []).map((r) => ({
      competencyId: (r.competencyId as string) || '',
      code: (r.code as string) || '',
      name: (r.name as string) || '',
      tasks: Number(r.tasks) || 0,
      avgSelf: Number(r.avgSelf) || 0,
      avgMentor: Number(r.avgMentor) || 0,
      gap: Number(r.gap) || 0,
      overRated: Number(r.overRated) || 0,
      underRated: Number(r.underRated) || 0,
    }));
  },

  /** This observer's existing ticks on one log, so the checklist opens pre-filled. */
  async getObservedKpiIds(studentId: string, logId: string, observerId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('kpi_observations')
      .select('kpi_id')
      .eq('student_id', studentId)
      .eq('log_id', logId)
      .eq('observed_by', observerId);
    if (error) throw error;
    return (data || []).map((r) => ((r as Record<string, unknown>).kpi_id as string));
  },
};
