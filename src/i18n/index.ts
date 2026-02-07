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

const deviceLanguage = getLocales()[0]?.languageCode ?? 'en';
const supportedLanguages = ['en', 'tr', 'sr', 'el', 'it', 'ro', 'de'];
const defaultLanguage = supportedLanguages.includes(deviceLanguage)
  ? deviceLanguage
  : 'en';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tr: { translation: tr },
    sr: { translation: sr },
    el: { translation: el },
    it: { translation: it },
    ro: { translation: ro },
    de: { translation: de },
  },
  lng: defaultLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
