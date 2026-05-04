const appJson = require('./app.json');
const fs = require('fs');
const path = require('path');

function resolvePushEnvironment() {
  const profile = (process.env.EAS_BUILD_PROFILE || process.env.EXPO_PUBLIC_APP_ENV || '').toLowerCase();
  if (profile.includes('prod') || profile.includes('testflight')) return 'production';
  return 'development';
}

module.exports = () => {
  const config = JSON.parse(JSON.stringify(appJson.expo));
  const apsEnvironment = resolvePushEnvironment();
  const googleServicesPath = process.env.EXPO_ANDROID_GOOGLE_SERVICES_FILE || './google-services.json';
  const resolvedGoogleServicesPath = path.resolve(__dirname, googleServicesPath);

  config.plugins = [
    'expo-notifications',
    ...(config.plugins || []),
  ];

  config.ios = {
    ...(config.ios || {}),
    entitlements: {
      ...((config.ios || {}).entitlements || {}),
      'aps-environment': apsEnvironment,
    },
    infoPlist: {
      ...((config.ios || {}).infoPlist || {}),
      UIBackgroundModes: ['remote-notification'],
    },
  };

  if (fs.existsSync(resolvedGoogleServicesPath)) {
    config.android = {
      ...(config.android || {}),
      googleServicesFile: googleServicesPath,
    };
  }

  config.extra = {
    ...(config.extra || {}),
    push: {
      apsEnvironment,
    },
  };

  if (typeof config.version === 'string' && config.version.trim()) {
    config.runtimeVersion = config.version;
  }

  return config;
};
