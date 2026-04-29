/**
 * WebForm — wraps children in a real HTML <form> on web (so Chrome stops
 * warning that password fields aren't inside a form, and so password
 * managers / autofill work properly), and is a no-op pass-through on
 * native. Uses `display: contents` so it doesn't change layout.
 *
 * Submission still flows through the existing TextInput onSubmitEditing
 * handlers; the form's own onSubmit just prevents the browser's default
 * GET-redirect behavior when Enter is pressed.
 */

import React from 'react';
import { Platform } from 'react-native';

type Props = {
  children: React.ReactNode;
  onSubmit?: () => void;
};

export function WebForm({ children, onSubmit }: Props) {
  if (Platform.OS !== 'web') return <>{children}</>;
  return React.createElement(
    'form',
    {
      onSubmit: (e: any) => {
        e.preventDefault();
        onSubmit?.();
      },
      noValidate: true,
      style: { display: 'contents' },
    },
    children,
  );
}
