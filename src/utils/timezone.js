const axios = require('axios');

/**
 * Fast offline lookup: US state abbreviation → IANA timezone.
 * Used as the first-pass fallback when APIs are unavailable.
 */
const US_STATE_TO_TIMEZONE = {
    AL: 'America/Chicago',
    AK: 'America/Anchorage',
    AZ: 'America/Phoenix',
    AR: 'America/Chicago',
    CA: 'America/Los_Angeles',
    CO: 'America/Denver',
    CT: 'America/New_York',
    DE: 'America/New_York',
    FL: 'America/New_York',
    GA: 'America/New_York',
    HI: 'Pacific/Honolulu',
    ID: 'America/Boise',
    IL: 'America/Chicago',
    IN: 'America/Indiana/Indianapolis',
    IA: 'America/Chicago',
    KS: 'America/Chicago',
    KY: 'America/New_York',
    LA: 'America/Chicago',
    ME: 'America/New_York',
    MD: 'America/New_York',
    MA: 'America/New_York',
    MI: 'America/Detroit',
    MN: 'America/Chicago',
    MS: 'America/Chicago',
    MO: 'America/Chicago',
    MT: 'America/Denver',
    NE: 'America/Chicago',
    NV: 'America/Los_Angeles',
    NH: 'America/New_York',
    NJ: 'America/New_York',
    NM: 'America/Denver',
    NY: 'America/New_York',
    NC: 'America/New_York',
    ND: 'America/Chicago',
    OH: 'America/New_York',
    OK: 'America/Chicago',
    OR: 'America/Los_Angeles',
    PA: 'America/New_York',
    RI: 'America/New_York',
    SC: 'America/New_York',
    SD: 'America/Chicago',
    TN: 'America/Chicago',
    TX: 'America/Chicago',
    UT: 'America/Denver',
    VT: 'America/New_York',
    VA: 'America/New_York',
    WA: 'America/Los_Angeles',
    WV: 'America/New_York',
    WI: 'America/Chicago',
    WY: 'America/Denver',
    DC: 'America/New_York',
    PR: 'America/Puerto_Rico',
    VI: 'America/St_Thomas',
};

/**
 * Try to extract timezone from a US state abbreviation in the address string.
 * e.g. "123 Main St, Dallas, TX 75201" → "America/Chicago"
 */
function guessTimezoneFromStateAbbreviation(address) {
    if (!address) return null;
    // Match ", ST " or ", ST" at end or followed by a zip
    const match = address.toUpperCase().match(/,\s*([A-Z]{2})(?:\s+\d{5})?(?:[^A-Z]|$)/);
    if (match) {
        const state = match[1];
        if (US_STATE_TO_TIMEZONE[state]) {
            console.log(`[Timezone] Fast state-lookup: ${state} → ${US_STATE_TO_TIMEZONE[state]}`);
            return US_STATE_TO_TIMEZONE[state];
        }
    }
    return null;
}

/**
 * Attempt to find a timezone for a given address using free public APIs.
 * Order of attempts:
 *  1. Fast offline US-state abbreviation lookup
 *  2. Nominatim (OpenStreetMap) geocoding → GeoPlugin timezone API
 *  3. Nominatim geocoding → WorldTimeAPI by lat/lon (secondary fallback)
 *
 * @param {string} address
 * @returns {Promise<string|null>} IANA timezone string (e.g. 'America/New_York') or null
 */
async function getTimezoneFromAddress(address) {
    if (!address || address.length < 5) return null;

    // --- Pass 1: Fast offline state-code lookup ---
    const fastTz = guessTimezoneFromStateAbbreviation(address);
    if (fastTz) return fastTz;

    console.log(`[Timezone] Geocoding address: ${address}`);

    // --- Pass 2: Geocode via Nominatim → then resolve timezone from lat/lon ---
    try {
        const geoRes = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: { q: address, format: 'json', addressdetails: 1, limit: 1 },
            headers: { 'User-Agent': 'SchoolAI-Enrollment-Platform/1.0' },
            timeout: 8000,
        });

        if (geoRes.data && geoRes.data.length > 0) {
            const place = geoRes.data[0];
            const lat = place.lat;
            const lon = place.lon;
            console.log(`[Timezone] Geocoded → lat: ${lat}, lon: ${lon}`);

            // --- Pass 2a: timeapi.io (free, no key, reliable lat/lon support) ---
            try {
                const tzRes = await axios.get('https://timeapi.io/api/TimeZone/coordinate', {
                    params: { latitude: lat, longitude: lon },
                    timeout: 7000,
                });
                if (tzRes.data && tzRes.data.timeZone) {
                    const tz = tzRes.data.timeZone;
                    console.log(`[Timezone] timeapi.io detected: ${tz}`);
                    return tz;
                }
            } catch (e) {
                console.warn('[Timezone] timeapi.io failed:', e.message);
            }

            // --- Pass 2b: GeoPlugin fallback ---
            try {
                const gpRes = await axios.get('http://www.geoplugin.net/extras/location.gp', {
                    params: { lat, long: lon, format: 'json' },
                    timeout: 6000,
                });
                if (gpRes.data && gpRes.data.geoplugin_timezone) {
                    const tz = gpRes.data.geoplugin_timezone;
                    console.log(`[Timezone] GeoPlugin detected: ${tz}`);
                    return tz;
                }
            } catch (e) {
                console.warn('[Timezone] GeoPlugin also failed:', e.message);
            }

            // --- Pass 2c: Country-code heuristic from Nominatim address details ---
            const countryCode = (place.address?.country_code || '').toUpperCase();
            const COUNTRY_TZ = {
                US: 'America/Chicago', CA: 'America/Toronto', GB: 'Europe/London',
                AU: 'Australia/Sydney', IN: 'Asia/Kolkata', DE: 'Europe/Berlin',
                FR: 'Europe/Paris', MX: 'America/Mexico_City', BR: 'America/Sao_Paulo',
                JP: 'Asia/Tokyo', CN: 'Asia/Shanghai', AE: 'Asia/Dubai',
                SG: 'Asia/Singapore', NZ: 'Pacific/Auckland', ZA: 'Africa/Johannesburg',
                NG: 'Africa/Lagos', EG: 'Africa/Cairo', KE: 'Africa/Nairobi',
            };
            if (countryCode && COUNTRY_TZ[countryCode]) {
                console.log(`[Timezone] Country-code heuristic: ${countryCode} → ${COUNTRY_TZ[countryCode]}`);
                return COUNTRY_TZ[countryCode];
            }
        }
    } catch (err) {
        console.warn('[Timezone] Nominatim geocoding failed:', err.message);
    }

    console.warn('[Timezone] All detection methods exhausted, returning null');
    return null;
}

/**
 * Parse a datetime string that is in a specific timezone (e.g. school local) and return a Date (UTC instant).
 * Use when the AI or client sends "4 PM" as "2025-03-18T16:00:00" without Z — that is meant to be 4 PM in the school's timezone, not UTC.
 * - If the string has 'Z' or ends with +/-HH:MM, it is parsed as-is (already an absolute instant).
 * - Otherwise the string is interpreted as local time in the given IANA timezone.
 *
 * @param {string|Date} dateTimeInput - ISO-like string (e.g. "2025-03-18T16:00:00") or Date
 * @param {string} timezone - IANA timezone (e.g. 'Asia/Kolkata', 'America/Chicago')
 * @returns {Date|null} UTC instant or null if invalid
 */
function parseLocalDateTimeToUTC(dateTimeInput, timezone) {
    if (!dateTimeInput || !timezone) return null;
    if (dateTimeInput instanceof Date) {
        return isNaN(dateTimeInput.getTime()) ? null : dateTimeInput;
    }
    const str = String(dateTimeInput).trim();
    // Already has timezone info → parse as absolute instant
    if (/Z$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str)) {
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
    }
    // Match YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss[.sss]
    const match = str.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
    if (!match) return null;
    const [, datePart, h, m, s] = match;
    const targetHours = parseInt(h, 10);
    const targetMinutes = parseInt(m, 10);
    const targetSeconds = parseInt(s || '0', 10);
    const ss = (s != null && s !== '') ? String(s).padStart(2, '0') : '00';
    const localStr = `${datePart}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:${ss}`;
    const guessUtc = new Date(localStr + 'Z');
    if (isNaN(guessUtc.getTime())) return null;
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    });
    const parts = formatter.formatToParts(guessUtc);
    const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    const actualH = get('hour');
    const actualM = get('minute');
    const actualS = get('second');
    const diffMinutes = (targetHours - actualH) * 60 + (targetMinutes - actualM) + (targetSeconds - actualS) / 60;
    return new Date(guessUtc.getTime() + diffMinutes * 60 * 1000);
}

/**
 * Format a Date (UTC instant) as a local dateTime string in the given timezone, for calendar APIs.
 * Returns e.g. "2025-03-18T16:00:00" (no Z) so Google/Outlook interpret it as that time in the given timezone.
 *
 * @param {Date} date - UTC instant
 * @param {string} timezone - IANA timezone (e.g. 'Asia/Kolkata')
 * @returns {string} RFC3339-like local time string (YYYY-MM-DDTHH:mm:ss)
 */
function formatInTimezone(date, timezone) {
    if (!(date instanceof Date) || isNaN(date.getTime()) || !timezone) return '';
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const get = (type) => parts.find(p => p.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

module.exports = { getTimezoneFromAddress, parseLocalDateTimeToUTC, formatInTimezone };
