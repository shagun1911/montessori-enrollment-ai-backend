/**
 * Comprehensive prompt for extracting all information from phone call transcripts
 * This replaces multiple separate prompts with a single, unified approach
 */

/**
 * Get the comprehensive prompt for extracting all call information
 * @param {string} transcriptText - The transcript text to analyze
 * @returns {string} - The complete prompt
 */
function getComprehensivePrompt(transcriptText) {
    return `You are processing a phone call transcript between a school enrollment AI agent (Nora) at Kids R Kids on Franz Road and a caller (usually a parent or guardian).

Your job is to extract ALL information in a single pass and return ONE structured JSON object.

Always respond in English, even if the conversation was in Spanish.

Do NOT invent, assume, or hallucinate any details not explicitly stated in the transcript.

Determine the call state:

- "complete": All 5 required fields collected (caller name, phone, email, child name, child age) AND call ended normally
- "partial": Some fields collected but call ended early, parent hung up, or booking was not completed
- "no_interaction": Caller said nothing meaningful (only greetings, silence, background noise, or misdial)

Required fields to extract (set to null if not mentioned):

1. parent_name

2. parent_phone

3. parent_email

4. child_name (array - supports siblings, e.g. ["Sid", "Maya"])

5. child_age (array - parallel to child_name, e.g. ["3 years old", "5 years old"])

Tour booking:

- tour_booked: true/false
- tour_date: "YYYY-MM-DD" or null
- tour_time: "HH:MM" or null
- tour_datetime_iso: ISO 8601 or null

Parent questions and interests (ONLY what was explicitly asked or stated):

- questions_asked: array of short plain-English strings of actual questions the parent raised
- topics_of_interest: array of short plain-English strings of topics/concerns the parent showed interest in

(e.g. "school hours", "meal/food provided", "teacher-to-student ratio", "after-school care", "cameras/security", "pickup service", "nap time", "start date")

- enrollment_urgency: "immediate" | "within weeks" | "specific month" | "unknown" - based on what parent said
- enrollment_target_date: string or null (e.g. "June", "as soon as possible", "next month")
- language_spoken: "English" | "Spanish" | "Both"

Generate three outputs from this data:

1. summary (string, 3-5 sentences, past tense, professional English):

- Complete call: what parent wanted, details collected, what was booked or offered

- Partial call: what was collected, note that the call ended before completion

- No interaction: state clearly "No meaningful interaction. The call was interrupted or the caller did not engage."

2. email (object):

{

"subject": string,

"body": string

}

- Subject format:

- Complete + tour booked: "New Tour Scheduled - [Parent Name] | [Child Name], Age [X] | [Date] at [Time]"

- Complete + no tour: "Attention Needed - [Parent Name] | Tour Not Booked"

- Partial: "Incomplete Call - [Parent Name or 'Unknown Caller']"

- No interaction: "No Interaction - Call Interrupted"

- Body tone: short, director-friendly, scannable. Use short paragraphs or minimal bullets.

- Always include: call state, what was collected, what parent asked/cares about, tour info or attention flag

- End with: "- Nora, Kids R Kids Virtual Assistant"

3. one_pager (object):

{

"header": {

"parent_name": string or "Not provided",

"phone": string or "Not provided",

"email": string or "Not provided",

"children": [{ "name": string, "age": string }]  // supports siblings

},

"tour_info": {

"scheduled": boolean,

"date_display": string or "Not scheduled",  // e.g. "Tuesday, April 8 at 9:30 AM"

"attention_flag": string or null  // e.g. "Tour not booked - follow-up needed"

},

"what_they_asked_about": [string],  // short bullet-ready phrases, max 8

"tour_talking_points": [string]     // 2-4 suggestions for staff based on what parent cares about

}

Return ONLY a valid JSON object with this exact top-level structure:

{

"call_state": "complete" | "partial" | "no_interaction",

"parent_name": string or null,

"parent_phone": string or null,

"parent_email": string or null,

"child_name": [string] or null,

"child_age": [string] or null,

"tour_booked": boolean,

"tour_date": string or null,

"tour_time": string or null,

"tour_datetime_iso": string or null,

"questions_asked": [string],

"topics_of_interest": [string],

"enrollment_urgency": string,

"enrollment_target_date": string or null,

"language_spoken": string,

"summary": string,

"email": { "subject": string, "body": string },

"one_pager": {

"header": {

"parent_name": string,

"phone": string,

"email": string,

"children": [{ "name": string, "age": string }]

},

"tour_info": {

"scheduled": boolean,

"date_display": string,

"attention_flag": string or null

},

"what_they_asked_about": [string],

"tour_talking_points": [string]

}

}

Transcript:
${transcriptText}`;
}

module.exports = {
    getComprehensivePrompt
};
