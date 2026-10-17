function normalizeVersion(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^version\s*/i, '')
    .replace(/^v\s*/i, '')
    .replace(/_/g, '.')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ');
}

function isPreReleaseVersion(version) {
  return /alpha|beta|preview|pre|rc|nightly|dev/i.test(String(version || ''));
}

function parseVersion(value) {
  const normalized = normalizeVersion(value);
  const match = normalized.match(/(\d+(?:\.\d+){0,4})(.*)$/);
  if (!match) return null;
  const core = match[1].split('.').map(Number);
  const suffix = match[2].replace(/^[\s._-]+/, '').trim();
  const prerelease = /alpha|beta|preview|pre|rc|nightly|dev/i.test(suffix);
  const tokens = suffix
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => /^\d+$/.test(token) ? Number(token) : token);
  return { core, prerelease, tokens };
}

function compareVersions(aValue, bValue) {
  const a = parseVersion(aValue);
  const b = parseVersion(bValue);
  if (!a || !b) return null;

  const length = Math.max(a.core.length, b.core.length);
  for (let i = 0; i < length; i += 1) {
    const av = a.core[i] ?? 0;
    const bv = b.core[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }

  if (a.prerelease !== b.prerelease) return a.prerelease ? -1 : 1;
  if (a.tokens.length === 0 && b.tokens.length === 0) return 0;

  const priority = { nightly: 0, dev: 0, alpha: 1, preview: 2, pre: 2, beta: 3, rc: 4 };
  const tokenLength = Math.max(a.tokens.length, b.tokens.length);
  for (let i = 0; i < tokenLength; i += 1) {
    const av = a.tokens[i];
    const bv = b.tokens[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (typeof av === 'number' && typeof bv === 'number') {
      if (av > bv) return 1;
      if (av < bv) return -1;
      continue;
    }
    if (typeof av === 'number' && typeof bv !== 'number') return 1;
    if (typeof av !== 'number' && typeof bv === 'number') return -1;
    const ap = priority[av] ?? 2;
    const bp = priority[bv] ?? 2;
    if (ap > bp) return 1;
    if (ap < bp) return -1;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function extractVersion(value, policy = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (policy.versionPattern) {
    try {
      const flags = String(policy.versionPatternFlags || 'i').replace(/g/g, '');
      const match = new RegExp(policy.versionPattern, flags).exec(raw);
      if (!match) return null;
      return String(match[1] ?? match[0]).trim();
    } catch {
      return null;
    }
  }
  return raw;
}

function matchesPolicy(release, policy = {}) {
  if (!release || release.draft || !release.tag_name) return false;

  if (policy.ignoreFuturePublished === true) {
    const published = Date.parse(release.published_at || release.created_at || '');
    if (Number.isFinite(published) && published > Date.now()) return false;
  }

  const includePrerelease = policy.includePrerelease === true;
  if (!includePrerelease && release.prerelease) return false;

  if (policy.excludePattern) {
    const patterns = Array.isArray(policy.excludePattern) ? policy.excludePattern : [policy.excludePattern];
    if (patterns.some((pattern) => {
      try { return new RegExp(pattern, 'i').test(String(release.tag_name || '')); } catch { return false; }
    })) return false;
  }

  if (policy.includePattern) {
    const patterns = Array.isArray(policy.includePattern) ? policy.includePattern : [policy.includePattern];
    if (!patterns.some((pattern) => {
      try { return new RegExp(pattern, 'i').test(String(release.tag_name || '')); } catch { return false; }
    })) return false;
  }

  const field = policy.versionField === 'name' ? release.name : release.tag_name;
  const version = extractVersion(field, policy);
  if (policy.requireVersion !== false && !version) return false;
  return true;
}

function pickGithubRelease(releases, policy = {}) {
  const candidates = releases
    .filter((release) => matchesPolicy(release, policy))
    .map((release) => {
      const field = policy.versionField === 'name' ? release.name : release.tag_name;
      const version = extractVersion(field, policy);
      return { release, version };
    });

  if (!candidates.length) return null;

  if (policy.selection === 'latest-published') {
    return candidates.sort((a, b) => {
      const ad = Date.parse(a.release.published_at || a.release.created_at || '') || 0;
      const bd = Date.parse(b.release.published_at || b.release.created_at || '') || 0;
      return bd - ad;
    })[0];
  }

  // Default: choose the highest comparable version, not merely the first GitHub result.
  const comparable = candidates.filter((candidate) => parseVersion(candidate.version));
  if (comparable.length) {
    comparable.sort((a, b) => compareVersions(b.version, a.version) ||
      ((Date.parse(b.release.published_at || b.release.created_at || '') || 0) -
       (Date.parse(a.release.published_at || a.release.created_at || '') || 0)));
    return comparable[0];
  }

  return candidates.sort((a, b) => {
    const ad = Date.parse(a.release.published_at || a.release.created_at || '') || 0;
    const bd = Date.parse(b.release.published_at || b.release.created_at || '') || 0;
    return bd - ad;
  })[0];
}

module.exports = {
  normalizeVersion,
  isPreReleaseVersion,
  parseVersion,
  compareVersions,
  extractVersion,
  matchesPolicy,
  pickGithubRelease
};
