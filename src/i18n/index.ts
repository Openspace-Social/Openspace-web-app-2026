import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveLocale } from './languages';

import da    from './locales/da.json';
import de    from './locales/de.json';
import en    from './locales/en.json';
import esES  from './locales/es-ES.json';
import fr    from './locales/fr.json';
import hu    from './locales/hu.json';
import it    from './locales/it.json';
import nl    from './locales/nl.json';
import no    from './locales/no.json';
import ptBR  from './locales/pt-BR.json';
import svSE  from './locales/sv-SE.json';
import tr    from './locales/tr.json';

const LANGUAGE_KEY = '@openspace/language';
const deviceLocale = Localization.getLocales()[0]?.languageTag ?? 'en';

// On web, localStorage is synchronous — read the saved preference before
// i18n initialises so the very first render uses the correct language.
// On native, we fall back to the async restore below.
let initialLng = resolveLocale(deviceLocale);
if (typeof localStorage !== 'undefined') {
  const saved = localStorage.getItem(LANGUAGE_KEY);
  if (saved) initialLng = saved;
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      da:    { translation: da },
      de:    { translation: de },
      en:    { translation: en },
      'es-ES': { translation: esES },
      fr:    { translation: fr },
      hu:    { translation: hu },
      it:    { translation: it },
      nl:    { translation: nl },
      no:    { translation: no },
      'pt-BR': { translation: ptBR },
      'sv-SE': { translation: svSE },
      tr:    { translation: tr },
    },
    lng: initialLng,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

// On native (iOS/Android), AsyncStorage is async — restore saved preference
// after init so it overrides the device locale if the user has chosen one.
if (typeof localStorage === 'undefined') {
  AsyncStorage.getItem(LANGUAGE_KEY).then((saved) => {
    if (saved && saved !== i18n.language) {
      i18n.changeLanguage(saved);
    }
  });
}

export default i18n;
