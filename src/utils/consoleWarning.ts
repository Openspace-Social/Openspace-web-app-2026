/**
 * consoleWarning — production-only "self-XSS" warning printed once on
 * app launch when running on a real openspace.social host. Models the
 * Facebook / Discord pattern: anyone opening dev tools sees a giant red
 * "Stop!" the first thing, deterring the casual "paste this script
 * someone sent me" attack vector. Doesn't block dev tools (which can't
 * be blocked anyway — that's the user's browser), just adds friction.
 *
 * Skipped on:
 *   - non-web platforms (no console / window.location to gate on)
 *   - localhost / 127.0.0.1 / *.localhost (dev)
 *   - any hostname that's not one of our known production hosts
 */

import { Platform } from 'react-native';

const PRODUCTION_HOSTS = new Set([
  'openspace.social',
  'www.openspace.social',
  'staging.openspace.social',
]);

let printed = false;

export function printProductionConsoleWarning(): void {
  if (printed) return;
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined' || typeof console === 'undefined') return;
  const host = (window.location?.hostname || '').toLowerCase();
  if (!PRODUCTION_HOSTS.has(host)) return;

  printed = true;
  const titleStyle = 'color:#DC2626; font-size:42px; font-weight:900; -webkit-text-stroke:1px #fff;';
  const bodyStyle = 'color:#0F172A; font-size:15px; font-weight:600;';
  const accentStyle = 'color:#6366F1; font-size:14px; font-weight:700;';

  // Use console.log (not console.warn / error) so the formatting %c
  // directives are honored. console.warn ignores style on some browsers.
  // eslint-disable-next-line no-console
  console.log('%cStop!', titleStyle);
  // eslint-disable-next-line no-console
  console.log(
    '%cThis browser feature is intended for developers. If someone told you to copy and paste something here to "enable" a feature or "hack" an account, it is a scam and will give them control of your Openspace account.',
    bodyStyle,
  );
  // eslint-disable-next-line no-console
  console.log(
    '%cSee https://en.wikipedia.org/wiki/Self-XSS for more information.',
    accentStyle,
  );
}
