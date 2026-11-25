function parseVersion(v) {
  const clean = String(v || '0').trim().replace(/^v/i, '').split('+')[0];
  const dashIdx = clean.indexOf('-');
  const coreStr = dashIdx === -1 ? clean : clean.slice(0, dashIdx);
  const preStr = dashIdx === -1 ? '' : clean.slice(dashIdx + 1);

  const coreParts = coreStr.split('.').map((p) => parseInt(p, 10) || 0);
  const pre = preStr
    ? preStr.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p.toLowerCase()))
    : [];

  return {
    core: [coreParts[0] || 0, coreParts[1] || 0, coreParts[2] || 0],
    pre,
  };
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);

  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }

  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length > 0 && pb.pre.length === 0) return -1;
  if (pa.pre.length === 0 && pb.pre.length > 0) return 1;

  const len = Math.min(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const sa = pa.pre[i];
    const sb = pb.pre[i];
    if (sa === sb) continue;
    const na = typeof sa === 'number';
    const nb = typeof sb === 'number';
    if (na && nb) return sa - sb;
    if (na !== nb) return na ? -1 : 1;
    return sa < sb ? -1 : 1;
  }

  return pa.pre.length - pb.pre.length;
}

export function satisfies(appVersion, minVersion, maxVersion) {
  if (minVersion && compareVersions(appVersion, minVersion) < 0) return false;
  if (maxVersion && compareVersions(appVersion, maxVersion) > 0) return false;
  return true;
}

export function isNewer(a, b) {
  return compareVersions(a, b) > 0;
}
