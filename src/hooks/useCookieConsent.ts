import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@openspace/cookie_consent';

export type ConsentStatus = 'accepted' | 'declined' | null;

export function useCookieConsent() {
  const [status, setStatus] = useState<ConsentStatus>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (value === 'accepted' || value === 'declined') {
          setStatus(value);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function accept() {
    await AsyncStorage.setItem(STORAGE_KEY, 'accepted');
    setStatus('accepted');
  }

  async function decline() {
    await AsyncStorage.setItem(STORAGE_KEY, 'declined');
    setStatus('declined');
  }

  return { status, loading, accept, decline };
}
