import type { ImageSourcePropType } from 'react-native';
import type { AvatarStage, StudentAvatarId } from '@/utils/studentAvatar';

/** Static requires are necessary for Metro to bundle every offline avatar. */
export const STUDENT_AVATAR_IMAGES: Record<StudentAvatarId, Record<AvatarStage, ImageSourcePropType>> = {
  '01': {
    1: require('../../assets/avatars/mobile/01-1.webp'),
    5: require('../../assets/avatars/mobile/01-5.webp'),
    10: require('../../assets/avatars/mobile/01-10.webp'),
  },
  '02': {
    1: require('../../assets/avatars/mobile/02-1.webp'),
    5: require('../../assets/avatars/mobile/02-5.webp'),
    10: require('../../assets/avatars/mobile/02-10.webp'),
  },
  '03': {
    1: require('../../assets/avatars/mobile/03-1.webp'),
    5: require('../../assets/avatars/mobile/03-5.webp'),
    10: require('../../assets/avatars/mobile/03-10.webp'),
  },
  '04': {
    1: require('../../assets/avatars/mobile/04-1.webp'),
    5: require('../../assets/avatars/mobile/04-5.webp'),
    10: require('../../assets/avatars/mobile/04-10.webp'),
  },
  '05': {
    1: require('../../assets/avatars/mobile/05-1.webp'),
    5: require('../../assets/avatars/mobile/05-5.webp'),
    10: require('../../assets/avatars/mobile/05-10.webp'),
  },
  '06': {
    1: require('../../assets/avatars/mobile/06-1.webp'),
    5: require('../../assets/avatars/mobile/06-5.webp'),
    10: require('../../assets/avatars/mobile/06-10.webp'),
  },
  '07': {
    1: require('../../assets/avatars/mobile/07-1.webp'),
    5: require('../../assets/avatars/mobile/07-5.webp'),
    10: require('../../assets/avatars/mobile/07-10.webp'),
  },
  '08': {
    1: require('../../assets/avatars/mobile/08-1.webp'),
    5: require('../../assets/avatars/mobile/08-5.webp'),
    10: require('../../assets/avatars/mobile/08-10.webp'),
  },
  '09': {
    1: require('../../assets/avatars/mobile/09-1.webp'),
    5: require('../../assets/avatars/mobile/09-5.webp'),
    10: require('../../assets/avatars/mobile/09-10.webp'),
  },
};
