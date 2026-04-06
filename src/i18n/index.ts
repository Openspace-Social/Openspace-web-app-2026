import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
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

const deviceLocale = Localization.getLocales()[0]?.languageTag ?? 'en';

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
    lng: resolveLocale(deviceLocale),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
  });

export default i18n;
