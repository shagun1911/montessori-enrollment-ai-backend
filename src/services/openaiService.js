const axios = require('axios');

/**
 * Format transcript array into readable text
 */
function formatTranscript(transcriptArray) {
    if (!Array.isArray(transcriptArray) || transcriptArray.length === 0) {
        return '';
    }
    
    return transcriptArray
        .map(entry => {
            const role = entry.role || entry.speaker || 'unknown';
            const text = entry.text || entry.content || entry.message || '';
            return `${role}: ${text}`;
        })
        .join('\n');
}

/**
 * Generate a summary of the call transcript using OpenAI
 */
async function generateTranscriptSummary(transcriptArray) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('[OpenAI] OPENAI_API_KEY not configured, skipping summary generation');
        return null;
    }

    try {
        const transcriptText = formatTranscript(transcriptArray);
        if (!transcriptText || transcriptText.trim().length === 0) {
            console.warn('[OpenAI] Empty transcript, cannot generate summary');
            return null;
        }

        const prompt = `You are summarizing a real phone call transcript between a school enrollment AI agent and a caller (usually a parent or guardian). Your summary will be used by school staff to quickly understand what happened on the call.

Rules:
- Base your summary ONLY on what is explicitly stated or clearly implied in the transcript. Do not invent names, dates, or facts.
- Identify the caller's main reason for calling and any specific requests (tour, info, enrollment, callback).
- Note concrete details mentioned: caller/child name, child age or grade, program of interest, preferred times, or contact details.
- Note what the agent offered or agreed to: information given, tour scheduled, follow-up promised, etc.
- If the transcript is short, unclear, or mostly greetings, say so briefly instead of guessing.
- Write in past tense, 3–5 clear sentences. Use neutral, professional language.

Transcript:
${transcriptText}

Summary:`;

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 350,
                temperature: 0.3
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const summary = response.data?.choices?.[0]?.message?.content?.trim();
        console.log('[OpenAI] Summary generated successfully');
        return summary || null;

    } catch (err) {
        console.error('[OpenAI] Error generating summary:', err.response?.data || err.message);
        return null;
    }
}

/**
 * Extract tour booking information from transcript using OpenAI
 */
async function extractTourBooking(transcriptArray) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('[OpenAI] OPENAI_API_KEY not configured, skipping tour booking extraction');
        return null;
    }

    try {
        const transcriptText = formatTranscript(transcriptArray);
        if (!transcriptText || transcriptText.trim().length === 0) {
            console.warn('[OpenAI] Empty transcript, cannot extract tour booking');
            return null;
        }

        const prompt = `You are analyzing a phone call transcript between a school enrollment AI agent and a parent. 

Determine if a school tour was booked during this call. If yes, extract the date and time information.

Respond ONLY with a JSON object in this exact format:
{
  "tour_booked": true or false,
  "date": "YYYY-MM-DD" or null,
  "time": "HH:MM" or null,
  "datetime": "ISO 8601 datetime string" or null,
  "notes": "any additional context about the booking"
}

If no tour was booked, set "tour_booked" to false and all other fields to null.

Transcript:
${transcriptText}

JSON Response:`;

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 300,
                temperature: 0.3,
                response_format: { type: 'json_object' }
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const content = response.data?.choices?.[0]?.message?.content?.trim();
        if (!content) {
            return null;
        }

        // Parse JSON response
        const bookingInfo = JSON.parse(content);
        console.log('[OpenAI] Tour booking extraction result:', bookingInfo);

        // Keep raw datetime string so webhook can interpret it in school's timezone (e.g. "4 PM" as 16:00 school local, not UTC)
        const datetimeRaw = bookingInfo.tour_booked && bookingInfo.datetime ? String(bookingInfo.datetime).trim() : null;
        const datetimeValid = datetimeRaw && !isNaN(new Date(datetimeRaw).getTime());

        return {
            tour_booked: bookingInfo.tour_booked === true,
            date: bookingInfo.date || null,
            time: bookingInfo.time || null,
            datetime: datetimeValid ? datetimeRaw : null,
            notes: bookingInfo.notes || null,
            raw_response: bookingInfo
        };

    } catch (err) {
        console.error('[OpenAI] Error extracting tour booking:', err.response?.data || err.message);
        if (err.response?.data) {
            console.error('[OpenAI] Full error response:', JSON.stringify(err.response.data, null, 2));
        }
        return null;
    }
}

/**
 * Process transcript with both summary and tour booking extraction
 */
async function processTranscript(transcriptArray) {
    try {
        console.log('[OpenAI] Starting transcript processing...');
        
        const [summary, tourBooking] = await Promise.all([
            generateTranscriptSummary(transcriptArray),
            extractTourBooking(transcriptArray)
        ]);

        const result = {
            summary: summary || '',
            tour_booking_detected: tourBooking?.tour_booked || false,
            tour_booking_date: tourBooking?.datetime || null,
            tour_booking_extracted: tourBooking || null
        };

        console.log('[OpenAI] Transcript processing complete:', {
            has_summary: !!result.summary,
            tour_detected: result.tour_booking_detected,
            tour_date: result.tour_booking_date
        });

        return result;

    } catch (err) {
        console.error('[OpenAI] Error processing transcript:', err);
        return {
            summary: '',
            tour_booking_detected: false,
            tour_booking_date: null,
            tour_booking_extracted: null
        };
    }
}

module.exports = {
    generateTranscriptSummary,
    extractTourBooking,
    processTranscript,
    formatTranscript
};

