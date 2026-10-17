'use strict';

const DEFAULT_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function parseTime(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

function isConfiguredFallbackEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.configuredFallback === true || entry.verification === 'configured-fallback') return true;
  return /configured-fallback/i.test(String(entry.transport || ''));
}

function isVerifiedCacheEntry(entry) {
  return Boolean(entry && typeof entry === 'object' && entry.ok === true && parseTime(entry.checkedAt) > 0 && !isConfiguredFallbackEntry(entry));
}

function isCacheEntryFresh(entry, { now = Date.now(), ttlMs = DEFAULT_VERSION_CACHE_TTL_MS } = {}) {
  if (!isVerifiedCacheEntry(entry)) return false;
  const checkedAt = parseTime(entry.checkedAt);
  const ttl = Math.max(0, Number(ttlMs) || 0);
  return checkedAt > 0 && Number(now) - checkedAt < ttl;
}

function selectStaleProgramIds(programs = [], cache = {}, sources = {}, options = {}) {
  const entries = cache && typeof cache === 'object' ? cache : {};
  return (Array.isArray(programs) ? programs : [])
    .filter((program) => {
      const sourceId = program?.versionSource?.sourceId || program?.versionSource?.type;
      if (!sourceId || !sources?.[sourceId]?.adapter) return false;
      return !isCacheEntryFresh(entries[String(program.id)], options);
    })
    .map((program) => String(program.id));
}

function pickNewerCacheEntry(primary, alternate) {
  if (!primary || typeof primary !== 'object') return alternate && typeof alternate === 'object' ? { ...alternate } : null;
  if (!alternate || typeof alternate !== 'object') return { ...primary };

  const primaryChecked = parseTime(primary.checkedAt);
  const alternateChecked = parseTime(alternate.checkedAt);
  if (primaryChecked !== alternateChecked) return { ...(primaryChecked > alternateChecked ? primary : alternate) };

  const primaryAttempt = parseTime(primary.lastAttemptAt);
  const alternateAttempt = parseTime(alternate.lastAttemptAt);
  if (primaryAttempt !== alternateAttempt) return { ...(primaryAttempt > alternateAttempt ? primary : alternate) };

  return { ...primary };
}

function mergeVersionCacheEntries(primaryEntries = {}, alternateEntries = {}) {
  const primary = primaryEntries && typeof primaryEntries === 'object' ? primaryEntries : {};
  const alternate = alternateEntries && typeof alternateEntries === 'object' ? alternateEntries : {};
  const ids = new Set([...Object.keys(primary), ...Object.keys(alternate)]);
  const merged = {};
  for (const id of ids) {
    const chosen = pickNewerCacheEntry(primary[id], alternate[id]);
    if (chosen) merged[id] = chosen;
  }
  return merged;
}

module.exports = {
  DEFAULT_VERSION_CACHE_TTL_MS,
  parseTime,
  isConfiguredFallbackEntry,
  isVerifiedCacheEntry,
  isCacheEntryFresh,
  selectStaleProgramIds,
  pickNewerCacheEntry,
  mergeVersionCacheEntries
};
