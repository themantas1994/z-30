/**
 * Time & Timezone Management Utilities for Amateur Radio Digital Modes
 * ===================================================================
 * Digital modes (z-30, FT8, WSPR) synchronize slots strictly against UTC (Coordinated Universal Time).
 * This module provides timezone conversion for operator UI/logging while ensuring all RF demodulation,
 * time sync offsets (Delta t), and slot triggers remain anchored strictly to true UTC.
 */

export interface TimezoneOption {
  id: string; // IANA identifier or special key ('UTC', 'SYSTEM_LOCAL')
  label: string; // Human-friendly display label
  region: 'Standard' | 'North America' | 'South America' | 'Europe' | 'Asia & Middle East' | 'Oceania & Pacific' | 'Africa';
  baseUtcOffset: string; // e.g. 'UTC+00:00', 'UTC-05:00'
}

export const TIMEZONE_CATALOG: TimezoneOption[] = [
  // Primary Amateur Radio Standards
  { id: 'UTC', label: 'UTC (Coordinated Universal Time / GMT)', region: 'Standard', baseUtcOffset: 'UTC+00:00' },
  { id: 'SYSTEM_LOCAL', label: 'System Local Time (Auto-Detect Browser Timezone)', region: 'Standard', baseUtcOffset: 'Auto' },

  // North America
  { id: 'America/New_York', label: 'Eastern Time (US & Canada) - New York, Toronto, Miami', region: 'North America', baseUtcOffset: 'UTC-05:00 / -04:00' },
  { id: 'America/Chicago', label: 'Central Time (US & Canada) - Chicago, Dallas, Winnipeg', region: 'North America', baseUtcOffset: 'UTC-06:00 / -05:00' },
  { id: 'America/Denver', label: 'Mountain Time (US & Canada) - Denver, Calgary, Phoenix', region: 'North America', baseUtcOffset: 'UTC-07:00 / -06:00' },
  { id: 'America/Los_Angeles', label: 'Pacific Time (US & Canada) - Los Angeles, Seattle, Vancouver', region: 'North America', baseUtcOffset: 'UTC-08:00 / -07:00' },
  { id: 'America/Anchorage', label: 'Alaska Time - Anchorage, Fairbanks, Juneau', region: 'North America', baseUtcOffset: 'UTC-09:00 / -08:00' },
  { id: 'Pacific/Honolulu', label: 'Hawaii Standard Time (HST) - Honolulu', region: 'North America', baseUtcOffset: 'UTC-10:00' },
  { id: 'America/Halifax', label: 'Atlantic Time - Halifax, Moncton', region: 'North America', baseUtcOffset: 'UTC-04:00 / -03:00' },
  { id: 'America/St_Johns', label: 'Newfoundland Time - St. John\'s', region: 'North America', baseUtcOffset: 'UTC-03:30 / -02:30' },
  { id: 'America/Mexico_City', label: 'Central Mexico - Mexico City, Guadalajara', region: 'North America', baseUtcOffset: 'UTC-06:00' },

  // South America
  { id: 'America/Sao_Paulo', label: 'Brasilia Time (BRT) - São Paulo, Rio de Janeiro', region: 'South America', baseUtcOffset: 'UTC-03:00' },
  { id: 'America/Argentina/Buenos_Aires', label: 'Argentina Standard Time - Buenos Aires', region: 'South America', baseUtcOffset: 'UTC-03:00' },
  { id: 'America/Santiago', label: 'Chile Time - Santiago', region: 'South America', baseUtcOffset: 'UTC-04:00 / -03:00' },
  { id: 'America/Bogota', label: 'Colombia Time - Bogotá, Medellín', region: 'South America', baseUtcOffset: 'UTC-05:00' },
  { id: 'America/Lima', label: 'Peru Time - Lima', region: 'South America', baseUtcOffset: 'UTC-05:00' },

  // Europe
  { id: 'Europe/London', label: 'United Kingdom / Ireland (GMT / BST) - London, Dublin', region: 'Europe', baseUtcOffset: 'UTC+00:00 / +01:00' },
  { id: 'Europe/Paris', label: 'Central European Time (CET / CEST) - Paris, Brussels, Amsterdam', region: 'Europe', baseUtcOffset: 'UTC+01:00 / +02:00' },
  { id: 'Europe/Berlin', label: 'Central European Time (CET / CEST) - Berlin, Frankfurt, Vienna, Zurich', region: 'Europe', baseUtcOffset: 'UTC+01:00 / +02:00' },
  { id: 'Europe/Rome', label: 'Central European Time (CET / CEST) - Rome, Milan', region: 'Europe', baseUtcOffset: 'UTC+01:00 / +02:00' },
  { id: 'Europe/Madrid', label: 'Central European Time (CET / CEST) - Madrid, Barcelona', region: 'Europe', baseUtcOffset: 'UTC+01:00 / +02:00' },
  { id: 'Europe/Athens', label: 'Eastern European Time (EET / EEST) - Athens, Bucharest', region: 'Europe', baseUtcOffset: 'UTC+02:00 / +03:00' },
  { id: 'Europe/Helsinki', label: 'Eastern European Time (EET / EEST) - Helsinki, Tallinn, Riga, Vilnius', region: 'Europe', baseUtcOffset: 'UTC+02:00 / +03:00' },
  { id: 'Europe/Kyiv', label: 'Eastern European Time (EET / EEST) - Kyiv', region: 'Europe', baseUtcOffset: 'UTC+02:00 / +03:00' },
  { id: 'Europe/Moscow', label: 'Moscow Standard Time (MSK) - Moscow, Saint Petersburg', region: 'Europe', baseUtcOffset: 'UTC+03:00' },
  { id: 'Europe/Istanbul', label: 'Turkey Time (TRT) - Istanbul, Ankara', region: 'Europe', baseUtcOffset: 'UTC+03:00' },

  // Asia & Middle East
  { id: 'Asia/Dubai', label: 'Gulf Standard Time (GST) - Dubai, Abu Dhabi, Muscat', region: 'Asia & Middle East', baseUtcOffset: 'UTC+04:00' },
  { id: 'Asia/Karachi', label: 'Pakistan Standard Time (PKT) - Karachi, Islamabad', region: 'Asia & Middle East', baseUtcOffset: 'UTC+05:00' },
  { id: 'Asia/Kolkata', label: 'India Standard Time (IST) - New Delhi, Mumbai, Bengaluru', region: 'Asia & Middle East', baseUtcOffset: 'UTC+05:30' },
  { id: 'Asia/Bangkok', label: 'Indochina Time (ICT) - Bangkok, Hanoi, Jakarta', region: 'Asia & Middle East', baseUtcOffset: 'UTC+07:00' },
  { id: 'Asia/Singapore', label: 'Singapore Standard Time (SGT) - Singapore', region: 'Asia & Middle East', baseUtcOffset: 'UTC+08:00' },
  { id: 'Asia/Hong_Kong', label: 'Hong Kong Time (HKT) - Hong Kong', region: 'Asia & Middle East', baseUtcOffset: 'UTC+08:00' },
  { id: 'Asia/Shanghai', label: 'China Standard Time (CST) - Beijing, Shanghai', region: 'Asia & Middle East', baseUtcOffset: 'UTC+08:00' },
  { id: 'Asia/Taipei', label: 'Taipei Time (CST) - Taipei', region: 'Asia & Middle East', baseUtcOffset: 'UTC+08:00' },
  { id: 'Asia/Tokyo', label: 'Japan Standard Time (JST) - Tokyo, Osaka', region: 'Asia & Middle East', baseUtcOffset: 'UTC+09:00' },
  { id: 'Asia/Seoul', label: 'Korea Standard Time (KST) - Seoul', region: 'Asia & Middle East', baseUtcOffset: 'UTC+09:00' },

  // Oceania & Pacific
  { id: 'Australia/Perth', label: 'Australian Western Time (AWST) - Perth', region: 'Oceania & Pacific', baseUtcOffset: 'UTC+08:00' },
  { id: 'Australia/Adelaide', label: 'Australian Central Time (ACST / ACDT) - Adelaide, Darwin', region: 'Oceania & Pacific', baseUtcOffset: 'UTC+09:30 / +10:30' },
  { id: 'Australia/Sydney', label: 'Australian Eastern Time (AEST / AEDT) - Sydney, Melbourne, Brisbane', region: 'Oceania & Pacific', baseUtcOffset: 'UTC+10:00 / +11:00' },
  { id: 'Pacific/Auckland', label: 'New Zealand Time (NZST / NZDT) - Auckland, Wellington', region: 'Oceania & Pacific', baseUtcOffset: 'UTC+12:00 / +13:00' },
  { id: 'Pacific/Fiji', label: 'Fiji Time (FJT) - Suva', region: 'Oceania & Pacific', baseUtcOffset: 'UTC+12:00' },

  // Africa
  { id: 'Africa/Cairo', label: 'Eastern European / Egypt Time - Cairo', region: 'Africa', baseUtcOffset: 'UTC+02:00 / +03:00' },
  { id: 'Africa/Johannesburg', label: 'South Africa Standard Time (SAST) - Johannesburg, Cape Town', region: 'Africa', baseUtcOffset: 'UTC+02:00' },
  { id: 'Africa/Nairobi', label: 'East Africa Time (EAT) - Nairobi, Addis Ababa', region: 'Africa', baseUtcOffset: 'UTC+03:00' },
  { id: 'Africa/Lagos', label: 'West Africa Time (WAT) - Lagos, Accra', region: 'Africa', baseUtcOffset: 'UTC+01:00' },
];

/**
 * Get the system's browser/OS timezone string (e.g. "America/Los_Angeles")
 */
export function getSystemLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Resolve effective IANA timezone from config string
 */
export function resolveEffectiveTimezone(timezoneSetting?: string): string {
  if (!timezoneSetting || timezoneSetting === 'UTC') {
    return 'UTC';
  }
  if (timezoneSetting === 'SYSTEM_LOCAL') {
    return getSystemLocalTimezone();
  }
  return timezoneSetting;
}

/**
 * Format true UTC time string (HH:MM:SS)
 */
export function formatUtcTime(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Format true UTC timestamp with milliseconds (HH:MM:SS.mmm)
 */
export function formatUtcTimestampWithMs(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

/**
 * Format date in UTC (YYYY-MM-DD)
 */
export function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get current UTC offset string for a given timezone (e.g. "UTC-07:00" or "UTC+02:00")
 */
export function getTimezoneOffsetString(timezone: string, date: Date = new Date()): string {
  const resolvedTz = resolveEffectiveTimezone(timezone);
  if (resolvedTz === 'UTC') {
    return 'UTC+00:00';
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: resolvedTz,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    if (tzPart?.value) {
      // e.g. "GMT-7", "GMT+2", "GMT"
      return tzPart.value.replace('GMT', 'UTC');
    }
  } catch {
    // Fallback calculation using Date math
  }

  try {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: resolvedTz }));
    const diffMinutes = Math.round((tzDate.getTime() - utcDate.getTime()) / 60000);
    const sign = diffMinutes >= 0 ? '+' : '-';
    const absMin = Math.abs(diffMinutes);
    const hours = String(Math.floor(absMin / 60)).padStart(2, '0');
    const mins = String(absMin % 60).padStart(2, '0');
    return `UTC${sign}${hours}:${mins}`;
  } catch {
    return 'UTC+00:00';
  }
}

/**
 * Format time and date according to target timezone
 */
export function formatTimeInTimezone(
  date: Date,
  timezoneSetting: string = 'UTC'
): {
  timeStr: string;
  timeWithMsStr: string;
  dateStr: string;
  fullStr: string;
  offsetStr: string;
  tzAbbr: string;
  resolvedTz: string;
} {
  const resolvedTz = resolveEffectiveTimezone(timezoneSetting);

  if (resolvedTz === 'UTC') {
    const timeStr = formatUtcTime(date);
    const timeWithMsStr = formatUtcTimestampWithMs(date);
    const dateStr = formatUtcDate(date);
    return {
      timeStr,
      timeWithMsStr,
      dateStr,
      fullStr: `${dateStr} ${timeStr} UTC`,
      offsetStr: 'UTC+00:00',
      tzAbbr: 'UTC',
      resolvedTz: 'UTC',
    };
  }

  try {
    const timeFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: resolvedTz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const timeStr = timeFormatter.format(date);

    const dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: resolvedTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const dateStr = dateFormatter.format(date);

    const abbrFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: resolvedTz,
      timeZoneName: 'short',
    });
    const abbrParts = abbrFormatter.formatToParts(date);
    const tzAbbr = abbrParts.find(p => p.type === 'timeZoneName')?.value || resolvedTz.split('/').pop() || 'LOC';

    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    const timeWithMsStr = `${timeStr}.${ms}`;
    const offsetStr = getTimezoneOffsetString(resolvedTz, date);

    return {
      timeStr,
      timeWithMsStr,
      dateStr,
      fullStr: `${dateStr} ${timeStr} ${tzAbbr}`,
      offsetStr,
      tzAbbr,
      resolvedTz,
    };
  } catch (e) {
    // Fallback to UTC
    const timeStr = formatUtcTime(date);
    const dateStr = formatUtcDate(date);
    return {
      timeStr,
      timeWithMsStr: formatUtcTimestampWithMs(date),
      dateStr,
      fullStr: `${dateStr} ${timeStr} UTC`,
      offsetStr: 'UTC+00:00',
      tzAbbr: 'UTC',
      resolvedTz: 'UTC',
    };
  }
}
