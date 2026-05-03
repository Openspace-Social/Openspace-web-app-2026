const appJson = require('./app.json');

function resolvePushEnvironment() {
  const profile = (process.env.EAS_BUILD_PROFILE || process.env.EXPO_PUBLIC_APP_ENV || '').toLowerCase();
  if (profile.includes('prod') || profile.includes('testflight')) return 'production';
  return 'development';
}

module.exports = () => {
  const config = JSON.parse(JSON.stringify(appJson.expo));
  const apsEnvironment = resolvePushEnvironment();

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

  if (process.env.EXPO_ANDROID_GOOGLE_SERVICES_FILE) {
    config.android = {
      ...(config.android || {}),
      googleServicesFile: process.env.EXPO_ANDROID_GOOGLE_SERVICES_FILE,
    };
  }

  config.extra = {
    ...(config.extra || {}),
    push: {
      apsEnvironment,
    },
  };

  return config;
};
