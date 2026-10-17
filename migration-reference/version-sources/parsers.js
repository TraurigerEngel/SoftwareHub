'use strict';

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSourceVersion(raw, format, match = null) {
  const base = String(raw || '').trim();
  if (!format) return base;
  const formatted = String(format).replace(/\{(\d+)\}/g, (_, index) => String(match?.[Number(index)] ?? (Number(index) === 1 ? base : '')).trim());
  return formatted.replace(/(^|[.\-])0+(\d+)/g, '$1$2');
}



function parsePublishedDate(rawDate, format = 'date') {
  const raw = String(rawDate || '').trim();
  if (!raw) return { publishedAt: null, publishedAtText: null };

  const months = {
    january:1, february:2, march:3, april:4, may:5, june:6,
    july:7, august:8, september:9, october:10, november:11, december:12,
    jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12
  };

  if (format === 'month-year') {
    const m = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
    const month = m ? months[m[1].toLowerCase()] : null;
    const year = m ? Number(m[2]) : null;
    if (month && year) {
      const iso = `${year}-${String(month).padStart(2,'0')}-01T00:00:00.000Z`;
      return { publishedAt: iso, publishedAtText: `${String(month).padStart(2,'0')}.${year}` };
    }
  }

  if (format === 'day-month-year') {
    const cleaned = raw.replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+/i, '')
      .replace(/(\d{1,2})(st|nd|rd|th)\b/i, '$1');
    const m = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    const day = m ? Number(m[1]) : null;
    const month = m ? months[m[2].toLowerCase()] : null;
    const year = m ? Number(m[3]) : null;
    if (month && day && year) {
      const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00.000Z`;
      return { publishedAt: iso, publishedAtText: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}` };
    }
  }

  if (format === 'english-date') {
    const cleaned = raw.replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+/i, '')
      .replace(/(\d{1,2})(st|nd|rd|th)\b/i, '$1');
    const m = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    const month = m ? months[m[1].toLowerCase()] : null;
    const day = m ? Number(m[2]) : null;
    const year = m ? Number(m[3]) : null;
    if (month && day && year) {
      const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00.000Z`;
      return { publishedAt: iso, publishedAtText: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}` };
    }
  }

  if (format === 'month-name-day-year-dash') {
    const m = raw.match(/^([A-Za-z]{3,9})-(\d{1,2})-(\d{4})$/);
    const month = m ? months[m[1].toLowerCase()] : null;
    const day = m ? Number(m[2]) : null;
    const year = m ? Number(m[3]) : null;
    if (month && day && year) {
      const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00.000Z`;
      return { publishedAt: iso, publishedAtText: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}` };
    }
  }

  if (format === 'day-month-name-year-dash') {
    const m = raw.match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/);
    const day = m ? Number(m[1]) : null;
    const month = m ? months[m[2].toLowerCase()] : null;
    const year = m ? Number(m[3]) : null;
    if (month && day && year) {
      const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00.000Z`;
      return { publishedAt: iso, publishedAtText: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}` };
    }
  }

  if (format === 'month-name-day-year-comma') {
    const m = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/);
    const month = m ? months[m[1].toLowerCase()] : null;
    const day = m ? Number(m[2]) : null;
    const year = m ? Number(m[3]) : null;
    if (month && day && year) {
      const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00.000Z`;
      return { publishedAt: iso, publishedAtText: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}` };
    }
  }

  if (format === 'weekday-month-name-day-year-ordinal') {
    const cleaned = raw.replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+/i, '')
      .replace(/(\d{1,2})(st|nd|rd|th)\b/i, '$1');
    const m = cleaned.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
    const month = m ? months[m[1].toLowerCase()] : null;
    const day = m ? Number(m[2]) : null;
    const year = m ? Number(m[3]) : null;
    if (month && day && year) {
      const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00.000Z`;
      return { publishedAt: iso, publishedAtText: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}` };
    }
  }

  if (format === 'month-day-year') {
    const m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    const month = m ? Number(m[1]) : null;
    const day = m ? Number(m[2]) : null;
    const year = m ? Number(m[3]) : null;
    if (month && day && year) {
      const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00.000Z`;
      return { publishedAt: iso, publishedAtText: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}` };
    }
  }

  const normalized = raw.replace(/\//g, '-');
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) {
    const d = parsed.toISOString().slice(0,10).split('-');
    return { publishedAt: parsed.toISOString(), publishedAtText: `${d[2]}.${d[1]}.${d[0]}` };
  }
  return { publishedAt: null, publishedAtText: null };
}

function parsePublishedDateFromVersion(version, format) {
  const raw = String(version || '').trim();
  if (format === 'yymmdd') {
    const m = raw.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (!m) return { publishedAt: null, publishedAtText: null };
    const year = 2000 + Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
      return { publishedAt: null, publishedAtText: null };
    }
    return {
      publishedAt: `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00.000Z`,
      publishedAtText: `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}`
    };
  }
  return { publishedAt: null, publishedAtText: null };
}

function extractVersionFromFilename(value, pattern) {
  const raw = String(value || '');
  if (!pattern) return null;
  try {
    const match = raw.match(new RegExp(pattern, 'i'));
    return match ? String(match[1] || match[0]).trim() : null;
  } catch {
    return null;
  }
}

module.exports = { stripHtmlToText, formatSourceVersion, parsePublishedDate, parsePublishedDateFromVersion, extractVersionFromFilename };
