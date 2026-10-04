// The "Saved searches" home and lock screen widget (WidgetKit), built by @bacons/apple-targets.
// It reads what the app writes to the shared App Group (src/lib/widget-sync.tsx).
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'RaadisoWidget',
  displayName: 'Raadiso',
  bundleIdentifier: '.widget',
  deploymentTarget: '18.0',
  colors: {
    $accent: { color: '#3b5bff', darkColor: '#7c93ff' },
    $widgetBackground: { color: '#ffffff', darkColor: '#0e1116' },
  },
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
