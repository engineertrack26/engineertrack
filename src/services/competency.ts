import { supabase } from './supabase';
import { RpcError } from './rpcError';
import type {
  Competency, CompetencyKpi, CompetencyProgress, WorkingKpi, GroupCompetencyTarget,
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

  async recordObservations(studentId: string, logId: string | null, kpiIds: string[]): Promise<void> {
    const { error } = await supabase.rpc('record_kpi_observations', {
      p_student_id: studentId,
      p_log_id: logId,
      p_kpi_ids: kpiIds,
    });
    if (error) throw new RpcError(error.message);
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
