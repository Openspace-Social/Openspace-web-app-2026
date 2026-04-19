export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 100;

type TranslateFn = (key: string, options?: any) => string;

export function passwordPolicyHint(t: TranslateFn) {
  return t('auth.passwordPolicyHint', {
    defaultValue: 'Use 10-100 characters and avoid all-numeric passwords.',
  });
}

export function validatePasswordAgainstBackendPolicy(password: string, t: TranslateFn): string | null {
  if (!password || !password.trim()) {
    return t('auth.errorPasswordRequired', {
      defaultValue: 'Please enter a password.',
    });
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return t('auth.errorPasswordTooShort', {
      min: PASSWORD_MIN_LENGTH,
      defaultValue: 'Password must be at least {{min}} characters.',
    });
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return t('auth.errorPasswordTooLong', {
      max: PASSWORD_MAX_LENGTH,
      defaultValue: 'Password must be at most {{max}} characters.',
    });
  }

  if (/^\d+$/.test(password)) {
    return t('auth.errorPasswordNumericOnly', {
      defaultValue: 'Password cannot be entirely numeric.',
    });
  }

  return null;
}
