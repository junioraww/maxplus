export function tokenizeText(text) {
  if (!text) return [];
  const tokens = text.match(/\s+|[^\s]+/g);
  return tokens || [];
}

export function computeTextDiff(oldText, newText) {
  const oldTokens = tokenizeText(oldText);
  const newTokens = tokenizeText(newText);
  const m = oldTokens.length;
  const n = newTokens.length;

  if (m === 0 && n === 0) return [];
  if (m === 0) return [{ op: '+', text: newText }];
  if (n === 0) return [{ op: '-', text: oldText }];

  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldTokens[i] === newTokens[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = m;
  let j = n;
  const rawDiff = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      rawDiff.unshift({ op: '=', text: oldTokens[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawDiff.unshift({ op: '+', text: newTokens[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      rawDiff.unshift({ op: '-', text: oldTokens[i - 1] });
      i--;
    }
  }

  const merged = [];
  for (const item of rawDiff) {
    if (merged.length > 0 && merged[merged.length - 1].op === item.op) {
      merged[merged.length - 1].text += item.text;
    } else {
      merged.push({ op: item.op, text: item.text });
    }
  }

  return merged;
}

export function applyDiff(diff, target = 'new') {
  if (!diff || !diff.length) return '';
  let result = '';
  for (const item of diff) {
    if (target === 'new') {
      if (item.op === '=' || item.op === '+') {
        result += item.text;
      }
    } else {
      if (item.op === '=' || item.op === '-') {
        result += item.text;
      }
    }
  }
  return result;
}

function getAttachKey(att) {
  if (!att) return '';
  return String(
    att.id ||
    att.photoId ||
    att.videoId ||
    att.audioId ||
    att.fileId ||
    att.name ||
    att.path ||
    att.url ||
    att.token ||
    JSON.stringify(att)
  );
}

export function computeAttachesDiff(oldAttaches = [], newAttaches = []) {
  const oldList = Array.isArray(oldAttaches) ? oldAttaches : [];
  const newList = Array.isArray(newAttaches) ? newAttaches : [];

  const oldKeys = new Set(oldList.map(getAttachKey));
  const newKeys = new Set(newList.map(getAttachKey));

  const added = newList.filter((a) => !oldKeys.has(getAttachKey(a)));
  const removed = oldList.filter((a) => !newKeys.has(getAttachKey(a)));

  return { added, removed };
}
