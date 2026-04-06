export interface Language {
  code: string;
  label: string;   // native name
  flag: string;    // emoji flag
}

export const LANGUAGES: Language[] = [
  { code: 'da',    label: 'Dansk',            flag: '🇩🇰' },
  { code: 'de',    label: 'Deutsch',           flag: '🇩🇪' },
  { code: 'en',    label: 'English',           flag: '🇬🇧' },
  { code: 'es-ES', label: 'Español',           flag: '🇪🇸' },
  { code: 'fr',    label: 'Français',          flag: '🇫🇷' },
  { code: 'hu',    label: 'Magyar',            flag: '🇭🇺' },
  { code: 'it',    label: 'Italiano',          flag: '🇮🇹' },
  { code: 'nl',    label: 'Nederlands',        flag: '🇳🇱' },
  { code: 'no',    label: 'Norsk',             flag: '🇳🇴' },
  { code: 'pt-BR', label: 'Português (BR)',    flag: '🇧🇷' },
  { code: 'sv-SE', label: 'Svenska',           flag: '🇸🇪' },
  { code: 'tr',    label: 'Türkçe',            flag: '🇹🇷' },
];

export const SUPPORTED_CODES = LANGUAGES.map((l) => l.code);

/** Map a device locale tag to the closest supported language code. */
export function resolveLocale(deviceLocale: string): string {
  // Exact match first (e.g. 'es-ES', 'pt-BR')
  if (SUPPORTED_CODES.includes(deviceLocale)) return deviceLocale;

  // Base language match (e.g. 'es' → 'es-ES', 'pt' → 'pt-BR', 'sv' → 'sv-SE')
  const base = deviceLocale.split('-')[0];
  const match = SUPPORTED_CODES.find((code) => code.startsWith(base));
  if (match) return match;

  return 'en';
}
