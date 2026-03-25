const axios = require('axios');

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
    
    const prompt = `
        Analyze the following call transcripts between parents and a school's AI assistant.
        Extract the most common questions and topics that parents are asking about.
        Return a JSON array of objects with "word" (the topic/question) and "count" (importance/frequency score 1-10).
        Limit to the top 20 items.
        
        Transcripts:
        ${combinedText}
    `;

    const result = await getChatCompletion([
        { role: 'system', content: 'You are an AI assistant that analyzes childcare inquiry transcripts to identify trends.' },
        { role: 'user', content: prompt }
    ], { response_format: { type: 'json_object' } });

    if (!result) return [];
    
    try {
        const parsed = JSON.parse(result);
        const rawItems = parsed.topics || parsed.wordCloud || parsed.data || Object.values(parsed)[0] || [];
        
        if (!Array.isArray(rawItems)) return [];
        
        return rawItems.map(item => ({
            word: String(item.word || item.text || item.topic || '').trim(),
            count: Number(item.count || item.value || item.importance || 1)
        })).filter(item => item.word);
    } catch (err) {
        console.error('[OpenAI] Failed to parse word cloud JSON:', err);
        return [];
    }
}

/**
 * Extract structured details from a call transcript
 */
async function extractTourDetails(transcriptText, existingDetails = {}) {
    const prompt = `
        Analyze the following call transcript and extract structured details for a tour booking.
        The current details we have are: ${JSON.stringify(existingDetails)}
        
        Extract:
        - Child Name (string)
        - Child Age/Grade (string)
        - Purpose of Visit (string, specific concerns or programs they are interested in)
        - Key Questions Asked (array of strings)
        - Additional Notes (string, any other relevant info like schedule preferences, siblings, etc.)
        
        Return the result as a JSON object.
        
        Transcript:
        ${transcriptText}
    `;

    const result = await getChatCompletion([
        { role: 'system', content: 'You are an AI assistant specialized in extracting childcare inquiry details from transcripts.' },
        { role: 'user', content: prompt }
    ], { response_format: { type: 'json_object' } });

    if (!result) return existingDetails;

    try {
        return JSON.parse(result);
    } catch (err) {
        console.error('[OpenAI] Failed to parse tour details JSON:', err);
        return existingDetails;
    }
}

module.exports = {
    getChatCompletion,
    generateWordCloud,
    extractTourDetails
};
