'use strict';

const HTTPS_PROTOCOL = 'https:';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function normalizeHttpsUrl(value, base = null) {
  try {
    const url = base ? new URL(String(value || ''), String(base)) : new URL(String(value || ''));
    if (url.protocol !== HTTPS_PROTOCOL) return null;
    url.username = '';
    url.password = '';
    return url.href;
  } catch {
    return null;
  }
}

function isHttpsUrl(value) {
  return Boolean(normalizeHttpsUrl(value));
}

function resolveHttpsRedirect(location, currentUrl) {
  return normalizeHttpsUrl(location, currentUrl);
}

function isRedirectStatus(status) {
  return REDIRECT_STATUSES.has(Number(status));
}

module.exports = { normalizeHttpsUrl, isHttpsUrl, resolveHttpsRedirect, isRedirectStatus };
