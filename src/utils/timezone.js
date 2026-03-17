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

module.exports = { getTimezoneFromAddress };
