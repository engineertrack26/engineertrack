import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { StudentAvatarId } from '@/utils/studentAvatar';
import { ProfileSheet } from '@/components/mentor/ProfileSheet';
import { AvatarPicker } from './AvatarPicker';
import { StudentAvatar } from './StudentAvatar';
import { ui } from '@/components/common/workflowStyles';

export function RegistrationAvatar({ value, onChange, disabled }: {
  value: StudentAvatarId | null; onChange: (id: StudentAvatarId | null) => void; disabled: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<StudentAvatarId | null>(value);
  return <View style={{ gap: 10, marginBottom: 20 }}>
    <Text style={ui.label}>{t('avatarUi.title')}</Text>
    <Text style={ui.secondary}>{t('avatarUi.optional')}</Text>
    {value && <StudentAvatar avatarId={value} level={1} size={100} />}
    <Pressable accessibilityRole="button" disabled={disabled} style={{ minHeight: 48, justifyContent: 'center' }}
      onPress={() => { setDraft(value); setOpen(true); }}>
      <Text style={ui.link}>{t(value ? 'avatarUi.change' : 'avatarUi.choose')}</Text>
    </Pressable>
    {open && <ProfileSheet title={t('avatarUi.choose')} busy={disabled} onClose={() => setOpen(false)}>
      <AvatarPicker value={draft} onChange={setDraft} disabled={disabled} />
      <Pressable accessibilityRole="button" disabled={!draft || disabled} style={[ui.primary, !draft && { opacity: 0.5 }]}
        onPress={() => { onChange(draft); setOpen(false); }}>
        <Text style={ui.primaryText}>{t('common.save')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={disabled} style={{ minHeight: 48, justifyContent: 'center' }}
        onPress={() => { onChange(null); setOpen(false); }}><Text style={ui.link}>{t('avatarUi.later')}</Text></Pressable>
    </ProfileSheet>}
  </View>;
}
