const axios = require('axios');

const wordCloudCache = new Map();

/**
 * Helper to call OpenAI Chat Completion API
 */
async function getChatCompletion(messages, options = {}) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('[OpenAI] OPENAI_API_KEY not configured');
        return null;
    }

    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: options.model || 'gpt-4o-mini',
            messages,
            response_format: options.response_format || { type: 'text' },
            temperature: options.temperature ?? 0.7,
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content;
    } catch (err) {
        console.error('[OpenAI] Completion error:', err.response?.data || err.message);
        return null;
    }
}

/**
 * Extract common questions and topics for a word cloud from transcripts
 */
async function generateWordCloud(transcripts) {
    if (!transcripts || transcripts.length === 0) return [];

    const combinedText = transcripts.join('\n---\n');
    
    // Simple in-memory cache based on transcript content and length
    const cacheKey = 'v2-' + combinedText.length + '-' + combinedText.slice(0, 40) + combinedText.slice(-40);
    const cached = wordCloudCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 10 * 60 * 1000)) { 
        console.log('[OpenAI] Returning cached word cloud');
        return cached.data;
    }

    const prompt = `
You will be given multiple call transcripts between a parent and a school's AI assistant.

Purpose:
- Surface **specific, high-signal parent questions** and concerns from the transcripts.
- Discover unique topics that actual parents are asking about (e.g. "Security Cameras", "Vegetarian Options", "Summer Camp Dates").

Critical requirements:
- **NO GENERIC FILLER**: Do NOT output topics that apply to every call like "Tour Scheduling" or "Phone Number".
- **ORGANIC DISCOVERY**: Focus on what makes these specific transcripts unique. Use the "Allowed topic areas" below only as a guide for category types, but prioritize the actual words used by parents.
- **VERBATIM QUOTES**: For the "examples" field, provide **actual anonymized snippets** of what the parent said. Do not paraphrase into generic "Assistant-style" questions.
- EXCLUDE: Greetings, names, metadata (caller, agent), and generic enrollment verbs.

Return JSON with this exact shape:
{
  "topics": [
    { "word": "Teacher Ratios", "count": 3, "examples": ["What is the ratio for the toddler room?", "I'm concerned about how many kids per teacher."] },
    { "word": "Daily Schedule", "count": 2, "examples": ["Do they have a nap time?", "What time is lunch served?"] }
  ]
}

Where:
- "word": the specific topic (1-3 words). Title Case.
- "count": number of DISTINCT transcripts where this specific concern appears.
- "examples": 1-2 actual short quotes from the parent (anonymized, no names).
- Limit to 15-20 highest-signal topics.
- Include topics with count >= 2 to ensure they are "Common" as requested by user.

Transcripts:
${combinedText}
`;

    const result = await getChatCompletion([
        { role: 'system', content: 'You extract important parent questions from childcare inquiry transcripts for analytics. Focus on high-signal topics only.' },
        { role: 'user', content: prompt }
    ], { response_format: { type: 'json_object' }, temperature: 0.1 });

    if (!result) return [];
    
    try {
        const parsed = JSON.parse(result);
        const rawItems = parsed.topics || parsed.wordCloud || parsed.data || Object.values(parsed)[0] || [];
        
        if (!Array.isArray(rawItems)) return [];

        const banned = new Set([
            'hello', 'hi', 'thanks', 'thank you', 'yes', 'no', 'okay', 'ok',
            'tour', 'tours', 'call', 'calls', 'schedule', 'scheduled',
            'school', 'parent', 'child', 'children', 'caller', 'agent', 'system',
            'benny', 'sid', 'amandeep', 'nora', 'april',
            'hoping', 'enroll', 'enrollment', 'months', 'month', 'two', 'three', 'four', 'five',
            'asked', 'requested', 'confirmed', 'indicated', 'naming', 'named', 'collected',
            'information', 'user', 'timeline', 'arrangements', 'proceeded', 'acknowledged'
        ]);

        const cleaned = rawItems
            .map(item => {
                const wordRaw = String(item.word || item.text || item.topic || '').trim();
                const word = wordRaw
                    .replace(/\s+/g, ' ')
                    .replace(/[^\w\s\-&]/g, '')
                    .trim();
                const count = Number(item.count || item.value || item.importance || 1);
                const examples = Array.isArray(item.examples)
                    ? item.examples.map(x => String(x || '').trim()).filter(Boolean).slice(0, 2)
                    : [];
                return { word, count: Number.isFinite(count) ? count : 1, examples };
            })
            .filter(item => item.word)
            .filter(item => item.word.length >= 3 && item.word.length <= 40)
            .filter(item => !/\d/.test(item.word)) // drop anything with digits
            .filter(item => !item.word.includes('@')) // drop emails
            .filter(item => !banned.has(item.word.toLowerCase()))
            .sort((a, b) => b.count - a.count)
            .slice(0, 25);

        // Update cache
        wordCloudCache.set(cacheKey, { data: cleaned, timestamp: Date.now() });

        return cleaned;
    } catch (err) {
        console.error('[OpenAI] Failed to parse word cloud JSON:', err);
        return [];
    }
}

/**
 * Extract structured details from a call transcript
 */
async function extractTourDetails(transcriptText, existingDetails = {}) {
    // Check if transcript is too short to extract meaningful insights
    const wordCount = (transcriptText || '').split(/\s+/).filter(word => word.length > 0).length;
    const transcriptLength = (transcriptText || '').length;
    
    // If transcript is very short, return minimal information
    if (transcriptLength < 50 || wordCount < 10) {
        return {
            childName: existingDetails.childName || '',
            childAge: existingDetails.childAge || '',
            purpose: existingDetails.purpose || 'Brief inquiry - insufficient details captured',
            questionsAsked: [],
            notes: 'Call was too short to extract meaningful insights. Primarily consisted of greetings and basic inquiries.'
        };
    }

    const prompt = `
        Analyze the following childcare inquiry call transcript and extract ALL important insights and details.
        Be thorough and capture every significant piece of information the parent shares.
        
        The current details we have are: ${JSON.stringify(existingDetails)}
        
        IMPORTANT SAFEGUARDS:
        - ONLY extract insights that are EXPLICITLY mentioned in the transcript
        - DO NOT hallucinate or invent details that aren't clearly stated
        - If the conversation is brief or consists mainly of greetings, acknowledge this limitation
        - Be conservative in your interpretation - if unsure, don't include the insight
        - Focus on concrete facts, not assumptions about what the parent "might" want
        
        Extract the following COMPREHENSIVE information:
        
        1. Child Name (string - only if explicitly mentioned)
        2. Child Age (string - only if explicitly mentioned)
        3. Purpose of Visit (detailed summary of parent's specific needs, motivations, and circumstances)
        
        4. Important Insights/Topics Discussed (array of strings - ONLY topics explicitly mentioned):
           - School preferences (specific schools mentioned, districts, etc.)
           - Program needs (after-school care, pickup service, summer programs, etc.)
           - Schedule requirements (start dates, timing needs, etc.)
           - Financial concerns (tuition, fees, payment plans, etc.)
           - Special requirements (dietary needs, medical needs, learning accommodations, etc.)
           - Transportation needs (pickup/drop-off requirements, bus routes, etc.)
           - Curriculum interests (STEM focus, language programs, arts, etc.)
           - Safety concerns (security, supervision, protocols, etc.)
           - Any other specific topics or questions raised
        
        5. Key Questions Asked (array of strings - capture ACTUAL verbatim questions, anonymized)
        6. Additional Notes (string - any other important details, context, or concerns)
        
        CRITICAL INSTRUCTIONS:
        - Be exhaustive BUT ACCURATE - don't miss any important topics, but don't invent them
        - Extract specific details like school names, program types, fee concerns, etc. ONLY if mentioned
        - Use the parent's actual language and terminology where possible
        - Include both explicit questions and implied needs/concerns ONLY if clearly stated
        - If parent mentions specific schools, programs, or services, capture them exactly
        - For financial topics, capture specific concerns (tuition amount, payment timing, etc.) ONLY if discussed
        - If the conversation is primarily greetings with minimal substance, indicate this clearly
        
        Return the result as a JSON object.
        
        Transcript:
        ${transcriptText}
    `;

    const result = await getChatCompletion([
        { role: 'system', content: 'You are an expert at analyzing childcare inquiry transcripts. Your job is to extract ALL important insights, topics, and details comprehensively. Be thorough but ACCURATE - only extract what is explicitly stated in the transcript. Do not hallucinate details that aren\'t present.' },
        { role: 'user', content: prompt }
    ], { response_format: { type: 'json_object' }, temperature: 0.1 });

    if (!result) return existingDetails;

    try {
        const extracted = JSON.parse(result);
        
        // Additional validation to prevent hallucination
        const questionsAsked = Array.isArray(extracted.questionsAsked) 
            ? extracted.questionsAsked.filter(q => q && q.trim().length > 0)
            : [];
        
        // Map the extracted data to match expected format
        return {
            childName: extracted.childName || extracted['Child Name'] || existingDetails.childName || '',
            childAge: extracted.childAge || extracted['Child Age'] || existingDetails.childAge || '',
            purpose: extracted.purpose || extracted['Purpose of Visit'] || existingDetails.purpose || 'Brief inquiry',
            questionsAsked: questionsAsked,
            notes: extracted.additionalNotes || extracted['Additional Notes'] || ''
        };
    } catch (err) {
        console.error('[OpenAI] Failed to parse tour details JSON:', err);
        return existingDetails;
    }
}

/**
 * Batch extract structured details for multiple tour bookings at once
 */
async function batchExtractTourDetails(tourBatch) {
    if (!tourBatch || tourBatch.length === 0) return []

    // Filter out very short transcripts and handle them separately
    const validTours = [];
    const shortTourResults = {};
    
    tourBatch.forEach(tour => {
        const wordCount = (tour.transcript || '').split(/\s+/).filter(word => word.length > 0).length;
        const transcriptLength = (tour.transcript || '').length;
        
        if (transcriptLength < 50 || wordCount < 10) {
            // Handle very short transcripts
            shortTourResults[tour.id] = {
                childName: tour.existingDetails?.childName || '',
                childAge: tour.existingDetails?.childAge || '',
                purpose: tour.existingDetails?.purpose || 'Brief inquiry - insufficient details captured',
                questionsAsked: [],
                notes: 'Call was too short to extract meaningful insights. Primarily consisted of greetings and basic inquiries.'
            };
        } else {
            validTours.push(tour);
        }
    });

    const prompt = `
        You will be given multiple childcare inquiry call transcripts. For EACH transcript, extract COMPREHENSIVE details.
        Be thorough and capture ALL important insights, topics, and questions discussed.
        
        IMPORTANT SAFEGUARDS:
        - ONLY extract insights that are EXPLICITLY mentioned in each transcript
        - DO NOT hallucinate or invent details that aren't clearly stated
        - If a conversation is brief or consists mainly of greetings, acknowledge this limitation
        - Be conservative in your interpretation - if unsure, don't include the insight
        - Focus on concrete facts, not assumptions about what the parent "might" want
        
        Tours to process:
        ${validTours.map((t, i) => `--- TOUR #${i} (ID: ${t.id}) ---\nExisting Info: ${JSON.stringify(t.existingDetails)}\nTranscript:\n${t.transcript}`).join('\n\n')}
        
        For EACH tour, extract COMPREHENSIVE information:
        
        1. Child Name (string - only if explicitly mentioned)
        2. Child Age (string - only if explicitly mentioned)
        3. Purpose of Visit (detailed summary of parent's needs, motivations, circumstances)
        
        4. Important Insights/Topics Discussed (array of strings - ONLY topics explicitly mentioned):
           - School preferences (specific schools mentioned, districts, etc.)
           - Program needs (after-school care, pickup service, summer programs, etc.)
           - Schedule requirements (start dates, timing needs, etc.)
           - Financial concerns (tuition, fees, payment plans, etc.)
           - Special requirements (dietary needs, medical needs, learning accommodations, etc.)
           - Transportation needs (pickup/drop-off requirements, bus routes, etc.)
           - Curriculum interests (STEM focus, language programs, arts, etc.)
           - Safety concerns (security, supervision, protocols, etc.)
           - Any other specific topics or questions raised
        
        5. Key Questions Asked (array of strings - capture ACTUAL verbatim questions, anonymized)
        6. Additional Notes (string - any other important details, context, or concerns)
        
        CRITICAL INSTRUCTIONS:
        - Be exhaustive BUT ACCURATE - don't miss any important topics, but don't invent them
        - Extract specific details like school names, program types, fee concerns, etc. ONLY if mentioned
        - Use the parent's actual language and terminology where possible
        - Include both explicit questions and implied needs/concerns ONLY if clearly stated
        - If parent mentions specific schools, programs, or services, capture them exactly
        - For financial topics, capture specific concerns (tuition amount, payment timing, etc.) ONLY if discussed
        - If the conversation is primarily greetings with minimal substance, indicate this clearly
        
        Return result as a JSON object where keys are the TOUR IDs provided:
        {
          "tour_id_1": { "childName": "...", "childAge": "...", "purpose": "...", "questionsAsked": [...], "notes": "..." },
          "tour_id_2": { ... }
        }
    `;

    const result = await getChatCompletion([
        { role: 'system', content: 'You are an expert at analyzing childcare inquiry transcripts in batch. Your job is to extract ALL important insights, topics, and details comprehensively for each transcript. Be thorough but ACCURATE - only extract what is explicitly stated in each transcript. Do not hallucinate details that aren\'t present.' },
        { role: 'user', content: prompt }
    ], { response_format: { type: 'json_object' }, temperature: 0.1 });

    let batchResults = {};
    if (result) {
        try {
            batchResults = JSON.parse(result);
            
            // Additional validation to prevent hallucination
            Object.keys(batchResults).forEach(tourId => {
                const tourData = batchResults[tourId];
                if (tourData && tourData.questionsAsked) {
                    tourData.questionsAsked = Array.isArray(tourData.questionsAsked) 
                        ? tourData.questionsAsked.filter(q => q && q.trim().length > 0)
                        : [];
                }
            });
        } catch (err) {
            console.error('[OpenAI] Failed to parse batch tour details JSON:', err);
            batchResults = {};
        }
    }

    // Combine results from short transcripts and valid ones
    return { ...shortTourResults, ...batchResults };
}

module.exports = {
    getChatCompletion,
    generateWordCloud,
    extractTourDetails,
    batchExtractTourDetails
};
