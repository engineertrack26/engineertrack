/** Display names only; database names/codes and competence levels never change. */
export const TURKISH_COMPETENCY_NAMES: Readonly<Record<string, string>> = {
  'Engineering Problem Solving': 'Mühendislikte Problem Çözme',
  'Technical Documentation': 'Teknik Dokümantasyon',
  'Professional Communication': 'Mesleki İletişim',
  'Digital Tool Proficiency': 'Dijital Araç Kullanımı',
  'Responsibility & Ethics': 'Sorumluluk ve Etik',
  'Collaboration & Teamwork': 'İş Birliği ve Takım Çalışması',
};

export function competencyContent(name: string | null | undefined, language: string): string {
  if (!name) return '';
  if (language.toLowerCase().split(/[-_]/)[0] !== 'tr') return name;
  return Object.hasOwn(TURKISH_COMPETENCY_NAMES, name.trim()) ? TURKISH_COMPETENCY_NAMES[name.trim()] : name;
}
