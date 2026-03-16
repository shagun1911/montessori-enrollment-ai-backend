const axios = require('axios');

/**
 * Attempt to find a timezone for a given address using free public APIs.
 * This is a progressive lookup: 
 * 1. Nominatim (OpenStreetMap) for address -> lat/lng
 * 2. GeoNames or similar for lat/lng -> timezone
 * 
 * @param {string} address 
 * @returns {Promise<string|null>} Timezone string (e.g. 'America/New_York') or null
 */
async function getTimezoneFromAddress(address) {
    if (!address || address.length < 5) return null;

    try {
        console.log(`[Timezone] Attempting to find timezone for: ${address}`);
        
        // Step 1: Geocode address to Lat/Lng using OSM Nominatim
        const geoRes = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                q: address,
                format: 'json',
                limit: 1
            },
            headers: {
                'User-Agent': 'SchoolAI-Enrollment-Platform' // Required by Nominatim policy
            }
        });

        if (!geoRes.data || geoRes.data.length === 0) {
            console.warn('[Timezone] No geocoding results found for address');
            return null;
        }

        const { lat, lon } = geoRes.data[0];
        console.log(`[Timezone] Found Lat: ${lat}, Lng: ${lon}`);

        // Step 2: Get Timezone from Lat/Lng using GeoPlugin
        const tzRes = await axios.get(`http://www.geoplugin.net/extras/location.gp`, {
            params: {
                lat,
                long: lon,
                format: 'json'
            }
        });

        if (tzRes.data && tzRes.data.geoplugin_timezone) {
            const tz = tzRes.data.geoplugin_timezone;
            console.log(`[Timezone] Detected timezone: ${tz}`);
            return tz;
        }

        return null;
    } catch (err) {
        console.error('[Timezone] Error fetching timezone:', err.message);
        return null;
    }
}

module.exports = { getTimezoneFromAddress };
