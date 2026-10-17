'use strict';

function normalizeHttpsOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function getAllowedRenderedOrigins(baseUrl, extraOrigins = []) {
  const allowed = new Set();
  const baseOrigin = normalizeHttpsOrigin(baseUrl);
  if (baseOrigin) allowed.add(baseOrigin);
  for (const value of Array.isArray(extraOrigins) ? extraOrigins : []) {
    const origin = normalizeHttpsOrigin(value);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

function isAllowedRenderedNavigation(targetUrl, baseUrl, extraOrigins = []) {
  const targetOrigin = normalizeHttpsOrigin(targetUrl);
  if (!targetOrigin) return false;
  return getAllowedRenderedOrigins(baseUrl, extraOrigins).has(targetOrigin);
}

function denyAllSessionPermissions(targetSession) {
  if (!targetSession || typeof targetSession !== 'object') return false;
  let configured = false;
  if (typeof targetSession.setPermissionRequestHandler === 'function') {
    targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    configured = true;
  }
  if (typeof targetSession.setPermissionCheckHandler === 'function') {
    targetSession.setPermissionCheckHandler(() => false);
    configured = true;
  }
  return configured;
}

function limitRenderedText(value, maxChars = 1024 * 1024) {
  const limit = Math.max(1024, Math.floor(Number(maxChars) || 1024 * 1024));
  const text = String(value || '');
  return text.length > limit ? text.slice(0, limit) : text;
}

module.exports = {
  normalizeHttpsOrigin,
  getAllowedRenderedOrigins,
  isAllowedRenderedNavigation,
  denyAllSessionPermissions,
  limitRenderedText
};
