export type Theme = typeof lightTheme;

export const lightTheme = {
  dark: false,
  colors: {
    background: '#F8FAFC',
    surface: '#FFFFFF',
    border: '#E2E8F0',
    inputBackground: '#F1F5F9',
    inputBorder: '#CBD5E1',
    primary: '#6366F1',
    primaryShadow: '#6366F1',
    textPrimary: '#0F172A',
    textSecondary: '#64748B',
    textMuted: '#94A3B8',
    textOnPrimary: '#FFFFFF',
    textLink: '#6366F1',
    placeholder: '#94A3B8',
    errorBackground: '#FEF2F2',
    errorBorder: '#FECACA',
    errorText: '#DC2626',
    logoutBorder: '#E2E8F0',
    logoutText: '#64748B',
  },
};

export const darkTheme: Theme = {
  dark: true,
  colors: {
    background: '#0F172A',
    surface: '#1E293B',
    border: '#334155',
    inputBackground: '#0F172A',
    inputBorder: '#334155',
    primary: '#6366F1',
    primaryShadow: '#6366F1',
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    textOnPrimary: '#FFFFFF',
    textLink: '#818CF8',
    placeholder: '#475569',
    errorBackground: '#450A0A',
    errorBorder: '#7F1D1D',
    errorText: '#FCA5A5',
    logoutBorder: '#334155',
    logoutText: '#94A3B8',
  },
};
