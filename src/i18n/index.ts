import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import en from './locales/en.json';
import tr from './locales/tr.json';
import sr from './locales/sr.json';
import el from './locales/el.json';
import it from './locales/it.json';
import ro from './locales/ro.json';
import de from './locales/de.json';
import { avatarCopy } from './avatarCopy';

const supportedLanguages = ['en', 'tr', 'sr', 'el', 'it', 'ro', 'de'];
// Start with the device language when supported; the user's saved
// preference (profiles.language) is applied after login in the root layout.
const deviceLanguage = getLocales()[0]?.languageCode ?? 'en';
const defaultLanguage = supportedLanguages.includes(deviceLanguage) ? deviceLanguage : 'en';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: { ...en, avatarUi: avatarCopy.en } },
    tr: { translation: { ...tr, avatarUi: avatarCopy.tr } },
    sr: { translation: { ...sr, avatarUi: avatarCopy.sr } },
    el: { translation: { ...el, avatarUi: avatarCopy.el } },
    it: { translation: { ...it, avatarUi: avatarCopy.it } },
    ro: { translation: { ...ro, avatarUi: avatarCopy.ro } },
    de: { translation: { ...de, avatarUi: avatarCopy.de } },
  },
  lng: defaultLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
