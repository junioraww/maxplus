function parseVersion(v) {
  const parts = String(v || '0').split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareVersions(a, b) {
  const [a0, a1, a2] = parseVersion(a);
  const [b0, b1, b2] = parseVersion(b);
  if (a0 !== b0) return a0 - b0;
  if (a1 !== b1) return a1 - b1;
  return a2 - b2;
}

export function satisfies(appVersion, minVersion, maxVersion) {
  if (minVersion && compareVersions(appVersion, minVersion) < 0) return false;
  if (maxVersion && compareVersions(appVersion, maxVersion) > 0) return false;
  return true;
}

export function isNewer(a, b) {
  return compareVersions(a, b) > 0;
}
