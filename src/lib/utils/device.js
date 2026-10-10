export const generateDevice = () => {
  const [ appVersion, buildNumber ] = pick(APP_VERSION);
  const [ deviceName, osVersion, screen, arch ] = pick(ANDROID_DEVICES);
  const [ locale, timezone ] = pick(LOCALE_TIMEZONES);

  return {
    clientSessionId: 1,
    mtInstance: crypto.randomUUID(),
    userAgent: {
      deviceType: "ANDROID",
      appVersion,
      osVersion,
      timezone,
      screen,
      pushDeviceType: "GCM",
      arch,
      locale,
      buildNumber,
      deviceName,
      deviceLocale: locale,
      //release: "",
    },
    deviceId: crypto.randomUUID().replace(/-/g,''),
  }
}

const pick = a => a[Math.floor(Math.random() * a.length)];

/**
 * Source: https://github.com/MaxApiTeam/PyMax/blob/main/src/pymax/config.py
 * MIT License: https://github.com/MaxApiTeam/PyMax/blob/main/LICENSE
 */

const APP_VERSION = [
  ["26.25.0", 6790],
  ["26.26.0", 6797],
  ["26.26.1", 6798],
  ["26.27.0", 6800],
  ["26.27.1", 6802],
  ["26.28.0", 6804],
  ["26.29.0", 6807],
  ["26.29.1", 6808],
  ["26.30.0", 6810],
  ["26.30.1", 6819],
  ["26.31.0", 6822],
];

const ANDROID_DEVICES = [
  ["Samsung SM-A525F", "Android 13", "405dpi 405dpi 1080x2400", "arm64-v8a"],
  ["Samsung SM-A536B", "Android 14", "405dpi 405dpi 1080x2400", "arm64-v8a"],
  ["Samsung SM-A546E", "Android 14", "405dpi 405dpi 1080x2340", "arm64-v8a"],
  ["Samsung SM-G991B", "Android 14", "421dpi 421dpi 1080x2400", "arm64-v8a"],
  ["Samsung SM-G998B", "Android 13", "515dpi 515dpi 1440x3200", "arm64-v8a"],
  ["Samsung SM-S901B", "Android 14", "425dpi 425dpi 1080x2340", "arm64-v8a"],
  ["Samsung SM-S911B", "Android 14", "425dpi 425dpi 1080x2340", "arm64-v8a"],
  ["Xiaomi 2109119DG", "Android 13", "395dpi 395dpi 1080x2400", "arm64-v8a"],
  ["Xiaomi 2201117TG", "Android 13", "395dpi 395dpi 1080x2400", "arm64-v8a"],
  ["Xiaomi 2201123G", "Android 14", "526dpi 526dpi 1440x3200", "arm64-v8a"],
  ["Xiaomi 2210132G", "Android 14", "446dpi 446dpi 1220x2712", "arm64-v8a"],
  ["Xiaomi 23049PCD8G", "Android 14", "446dpi 446dpi 1220x2712", "arm64-v8a"],
  ["Redmi 2201116TG", "Android 13", "395dpi 395dpi 1080x2400", "arm64-v8a"],
  ["Redmi 22101316G", "Android 13", "395dpi 395dpi 1080x2400", "arm64-v8a"],
  ["Redmi 23021RAA2Y", "Android 14", "395dpi 395dpi 1080x2400", "arm64-v8a"],
  ["POCO 22011211G", "Android 13", "395dpi 395dpi 1080x2400", "arm64-v8a"],
  ["POCO 23049PCD8G", "Android 14", "446dpi 446dpi 1220x2712", "arm64-v8a"],
  ["Pixel 6", "Android 14", "411dpi 411dpi 1080x2400", "arm64-v8a"],
  ["Pixel 6a", "Android 14", "429dpi 429dpi 1080x2400", "arm64-v8a"],
  ["Pixel 7", "Android 14", "416dpi 416dpi 1080x2400", "arm64-v8a"],
  ["Pixel 7 Pro", "Android 14", "512dpi 512dpi 1440x3120", "arm64-v8a"],
  ["Pixel 8", "Android 14", "428dpi 428dpi 1080x2400", "arm64-v8a"],
  ["OnePlus NE2213", "Android 14", "525dpi 525dpi 1440x3216", "arm64-v8a"],
  ["OnePlus CPH2449", "Android 14", "451dpi 451dpi 1240x2772", "arm64-v8a"],
  ["realme RMX3085", "Android 13", "409dpi 409dpi 1080x2400", "arm64-v8a"],
  ["realme RMX3370", "Android 13", "409dpi 409dpi 1080x2400", "arm64-v8a"],
  ["realme RMX3630", "Android 13", "400dpi 400dpi 1080x2412", "arm64-v8a"],
  ["HUAWEI ELS-NX9", "Android 12", "441dpi 441dpi 1080x2340", "arm64-v8a"],
  ["HUAWEI VOG-L29", "Android 12", "398dpi 398dpi 1080x2340", "arm64-v8a"],
  ["HONOR RMO-NX1", "Android 13", "391dpi 391dpi 1080x2388", "arm64-v8a"],
  ["HONOR REA-NX9", "Android 13", "435dpi 435dpi 1200x2664", "arm64-v8a"],
];

const LOCALE_TIMEZONES = [
  ["ru", "Europe/Moscow"],
  ["ru", "Europe/Kaliningrad"],
  ["ru", "Europe/Samara"],
  ["ru", "Asia/Yekaterinburg"],
  ["ru", "Asia/Omsk"],
  ["ru", "Asia/Novosibirsk"],
  ["ru", "Asia/Krasnoyarsk"],
  ["ru", "Asia/Irkutsk"],
  ["ru", "Asia/Yakutsk"],
  ["ru", "Asia/Vladivostok"],
];

export const generateWebDevice = () => {
  const [ locale, timezone ] = pick(LOCALE_TIMEZONES);
  return {
    mtInstance: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    userAgent: {
      deviceType: "WEB", appVersion: "26.8.4", osVersion: "Linux",
      timezone, screen: "1080x1920 1.0x", locale, deviceLocale: locale,
      deviceName: "Chrome", buildNumber: 0,
      headerUserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
  };
};
