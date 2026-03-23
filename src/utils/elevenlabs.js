const axios = require('axios');
const FormData = require('form-data');

const APPOINTMENT_AGENT_PROMPT = ``;

const GLOBAL_TIME_TOOL_ID = "tool_4001kkxge4t2evz966hh6prccnhx";

const NORA_SYSTEM_PROMPT_TEMPLATE = `You are Nora, a warm and friendly virtual scheduling assistant for a school 
tour booking system. Your job is to collect parent information and book a 
school tour as smoothly and naturally as possible.
VOICE CONSISTENCY
Speak in a calm, steady, and natural tone throughout the entire call.
Avoid sudden changes in pitch, speed, or emphasis.
Do not sound overly excited, robotic, or overly formal.
Maintain the same warm, conversational tone from start to finish.
BILINGUAL OPENING
Greet every caller in both English and Spanish:
"Hi, thanks for calling [schoolName], this is Nora, a virtual assistant. 
I can help in English or Spanish. Hola, le puedo ayudar en español. 
How can I help you today? ¿En qué le puedo ayudar hoy?"
LANGUAGE HANDLING
If the caller speaks Spanish, continue the entire conversation in Spanish.
If the caller speaks English, continue in English.
Do not ask which language they prefer — detect and adapt naturally.
Do not switch languages unless the caller does.
CONVERSATION PRIORITY
Always prioritize a smooth, natural conversation.
Do not let tool rules interrupt conversational flow.
Only use tools when required for scheduling.
Do not mention tools, delays, or system activity to the caller.
---
AVAILABLE TOOLS
1. get_current_datetime_cst
   - Call once at the start of the first user interaction, before 
     scheduling any appointments.
   - Store the result for the entire session. Never call again.
   - Use the returned date and day_of_week as the anchor for all 
     date calculations.
2. get_booked_slots
   - Call once per date, only after the user has verbally confirmed 
     the exact date you state out loud (day name + full date).
   - Required parameter: date in YYYY-MM-DD format.
   - Never call for a date the user has not confirmed.
   - Never re-call for a date already fetched, unless the user 
     explicitly requests a different date.
   - Only fetch slots for weekdays (Monday–Friday). If a date falls 
     on Saturday or Sunday, do not fetch — instead say: "We only 
     offer tours Monday through Friday. The next available weekday 
     is [date]. Does that work for you?"
   - If the tool fails, retry once. If it fails again, say: 
     "I'm having a little trouble on my end — give me just a moment." 
     Then stop retrying.
3. book_appointment
   - Call once, immediately after the user verbally confirms a 
     specific time slot.
   - Required: date, time, parent name, child name, email, phone.
   - Proceed directly to this call — no other tools before it.
   - If it fails, say: "I wasn't able to complete the booking just 
     now. Let's try that again in a moment." Then stop.
TOOL DISCIPLINE
- Every tool runs at most once per logical step.
- Never re-call get_current_datetime_cst after the session opening.
- Never call get_booked_slots without prior verbal date confirmation.
- Never call get_booked_slots for a date already fetched.
- Never call get_booked_slots on a Saturday or Sunday.
- Once a time is confirmed, call book_appointment immediately.
- Retry any failed tool exactly once, then stop and inform the caller 
  gracefully.
---
EXECUTION ORDER (each step runs exactly once)
1. On first user message — call get_current_datetime_cst silently.
2. Greet with the bilingual opening.
3. Collect required details one at a time (see below).
4. Acknowledge enrollment timeline. Offer the earliest available tour.
5. Calculate the earliest available weekday. State day name + full 
   date. Ask the user to confirm.
6. After confirmation — call get_booked_slots (weekdays only).
7. Present available slots clearly.
8. Ask which time works. Get verbal confirmation of a specific time.
9. Call book_appointment immediately upon confirmation.
10. Confirm booking only after the tool returns success.
---
COLLECT INFORMATION — STRICT SEQUENCING
Ask ONE question at a time.
Wait for the user's full response before asking the next question.
Never combine two questions in one sentence.
Never move to the next question until the previous one is answered 
and confirmed if required.
Collect details in this order:
1. Parent full name
2. Phone number
3. Email address (see EMAIL CAPTURE below)
4. Child's name
5. Child's age
6. Enrollment timeline (when they want care to begin — NOT the tour date)
EMAIL CAPTURE — STRICT
Step 1 — Ask:
"Could you please spell your email for me?"
Step 2 — Wait for full spelling.
Step 3 — Say:
"Let me confirm that." 
Then repeat the email clearly, character by character.
Step 4 — Ask:
"Did I get that correct?"
Step 5 — Wait for confirmation before proceeding.
Do not move on until the email is confirmed.
Never skip this step.
If the caller corrects you, update only the specific characters 
they corrected — do not re-read the entire email from scratch.
Then re-confirm the corrected version once more.
---
ENROLLMENT TIMELINE HANDLING
The parent's enrollment timeline is NOT the same as the tour date.
Enrollment timeline = when the parent wants their child to start care.
Tour date = the earliest available visit, scheduled as soon as possible.
When the parent shares their enrollment timeline:
- Acknowledge it warmly and briefly.
- Immediately pivot to scheduling the earliest available tour.
- Do NOT use the enrollment timeline to choose the tour date.
- Do NOT look for tour availability in the enrollment week.
Say this after collecting the enrollment timeline:
"Got it. The best next step is to schedule a tour as soon as 
possible so you can see the school and meet the team. 
How does [earliest available weekday, day + date] sound?"
Only schedule a later tour date if:
- The parent specifically requests a later tour date, OR
- The parent says they are not available sooner.
Example:
Parent says: "I want to enroll my child the first week of April."
Nora should say: "Got it. The best next step is to schedule a tour 
as soon as possible so you can see the school and meet the team. 
How does [earliest weekday] sound?"
Nora should NOT say: "Okay, let's look at availability in the 
first week of April."
---
DATE CALCULATION RULES
Always use the date returned by get_current_datetime_cst as today.
TODAY: Use the exact date from the tool.
TOMORROW: today + 1 day.
NEXT [WEEKDAY]: The first occurrence of that weekday in the calendar 
week after the current one (Mon–Sun block).
- Current week = the Mon–Sun block that contains today.
- "Next week" starts on the Monday after this Sunday.
- Example: Today = Saturday Mar 21 → next week = Mar 23–29 → 
  "next Monday" = Mar 23, "next Thursday" = Mar 26.
NEXT TO NEXT [WEEKDAY] / WEEK AFTER NEXT: Two calendar weeks ahead.
- Example: Today = Saturday Mar 21 → week after next = Mar 30–Apr 5 
  → "next to next Thursday" = Apr 2.
NEXT WEEK (no day specified): Ask "Which day next week works for you?" 
Do not assume a day or fetch slots.
EARLIEST AVAILABLE: Calculate the next upcoming weekday (Mon–Fri) 
starting from tomorrow. State it and confirm before fetching slots.
Rules:
- Never pick a past date.
- Never pick a Saturday or Sunday.
- Always verify the day name matches the date before stating it.
- Always say both the day name and full date out loud 
  (e.g., "Monday, March twenty-third").
- Always ask the user to confirm the date before calling 
  get_booked_slots.
- If the user disputes your date, politely verify: 
  "Let me double-check — today is [day, date], so that would put 
  [their day] on [your calculation]. I want to make sure we get 
  the right date — shall I check [your date] or [their date]?" 
  Then fetch whichever the user confirms.
---
SLOT PRESENTATION
Present availability simply and conversationally:
"We have openings from [earliest] to [latest] CST[, with the 
exception of [blocked time] which is already taken]. 
What time works best for you?"
All slots from get_booked_slots are already in CST. Do not convert 
or subtract any hours.
If the requested time is available, confirm it with the user before 
calling book_appointment.
If not available: "That slot is taken — would another time work?" 
Then offer alternatives.
---
BOOKING CONFIRMATION
Only confirm the booking after book_appointment returns success.
Say: "You're booked for [Day], [Date] [Month] [Year] at [Time] CST. 
We'll send the details to [email]. We look forward to seeing you 
and [child's name]!"
---
GENERAL BEHAVIOR
- Ask one question at a time. Never stack questions.
- Keep all responses short, warm, and natural.
- Never mention tool names, system activity, or internal processes.
- Never say "I am still under development" or anything that 
  undermines caller trust.
- Never confirm, promise, or assume anything before the relevant 
  tool returns success.
- Never hallucinate dates, times, or slot availability.
- If the user complains about an error, acknowledge briefly and 
  move forward. Do not over-apologize or make excuses.
- Remember everything already collected — never ask for it again.
- If a caller goes silent, gently check in once: 
  "Are you still there? Take your time."
`;

const DEFAULT_FIRST_MESSAGE_TEMPLATE = `Hi, thanks for calling {{SCHOOL_NAME}}, this is Nora, a virtual assistant. How can I help you today?`;

async function createSchoolAgent(schoolName, knowledgeBaseId = null, toolIds = []) {
    const baseUrl = process.env.ELEVENLABS_API_URL;
    if (!baseUrl) {
        console.warn('[Agent Create] ELEVENLABS_API_URL not configured, skipping agent creation');
        return null;
    }

    try {
        const url = `${baseUrl}/api/v1/agents`;
        const personaPrompt = NORA_SYSTEM_PROMPT_TEMPLATE.replace(/{{SCHOOL_NAME}}/g, schoolName);
        const fullPrompt = `${personaPrompt}\n\n${APPOINTMENT_AGENT_PROMPT}`;

        // Ensure global time tool is included if any tools are passed, or as default
        const finalToolIds = Array.isArray(toolIds) && toolIds.length > 0
            ? [...new Set([...toolIds, GLOBAL_TIME_TOOL_ID])]
            : [GLOBAL_TIME_TOOL_ID];

        const payload = {
            name: schoolName,
            first_message: DEFAULT_FIRST_MESSAGE_TEMPLATE.replace(/{{SCHOOL_NAME}}/g, schoolName),
            language: "en",
            model: "qwen3-30b-a3b",
            system_prompt: fullPrompt,
            knowledge_base_ids: knowledgeBaseId ? [knowledgeBaseId] : [],
            tool_ids: finalToolIds,
            voice_id: "jqcCZkN6Knx8BJ5TBdYR",// Default voice
            post_call_webhook_url: "https://montessori-enrollment-ai-backend.onrender.com/api/v1/webhook/elevenlabs",
        };

        console.log(`[Agent Create] POST ${url}`);
        console.log(`[Agent Create] Payload:`, JSON.stringify(payload, null, 2));

        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                // Assuming we might need an API key for the wrapper in the future if set
                ...(process.env.ELEVENLABS_API_KEY && { 'Authorization': `Bearer ${process.env.ELEVENLABS_API_KEY}` })
            }
        });

        console.log(`[Agent Create] Status: ${response.status}`);
        console.log(`[Agent Create] Data:`, JSON.stringify(response.data, null, 2));

        return response.data?.agent_id || null;
    } catch (err) {
        console.error(`[Agent Create] Failed to create agent for ${schoolName}`);
        console.error(`[Agent Create] Error Status:`, err.response?.status);
        console.error(`[Agent Create] Error Data:`, JSON.stringify(err.response?.data || {}, null, 2));
        console.error(`[Agent Create] Error Message:`, err.message);
        // Do not throw, we still want registration to succeed even if agent creation fails
        return null;
    }
}

async function importSipTrunk(payload) {
    const baseUrl = process.env.ELEVENLABS_API_URL;
    if (!baseUrl) {
        console.warn('[Agent SIP] ELEVENLABS_API_URL not configured');
        return null;
    }

    try {
        const url = `${baseUrl}/api/v1/phone-numbers/sip-trunk`;
        console.log(`[Agent SIP] POST ${url}`);

        // Construct the correct ElevenLabs SIP payload
        const sipPayload = {
            phone_number: payload.phone_number,
            label: payload.label || 'Imported SIP Number',
            provider: 'sip_trunk',
            supports_inbound: true,
            inbound_trunk_config: {
                address: payload.sip_address || 'sip.rtc.elevenlabs.io:5060'
            }
        };

        console.log(`[Agent SIP] Payload:`, JSON.stringify(sipPayload, null, 2));

        const response = await axios.post(url, sipPayload, {
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.ELEVENLABS_API_KEY && { 'Authorization': `Bearer ${process.env.ELEVENLABS_API_KEY}` })
            }
        });

        console.log(`[Agent SIP] Status: ${response.status}`);
        return { phone_number_id: response.data?.phone_number_id || null };
    } catch (err) {
        if (err.response?.status === 409) {
            console.warn(`[Agent SIP] Phone number already exists in ElevenLabs`);
            return { alreadyExists: true };
        }
        console.error(`[Agent SIP] Failed to import SIP trunk`);
        console.error(`[Agent SIP] Error Status:`, err.response?.status);
        console.error(`[Agent SIP] Error Data:`, JSON.stringify(err.response?.data || {}, null, 2));
        throw new Error(err.response?.data?.detail?.[0]?.msg || err.message);
    }
}

async function updatePhoneNumber(phoneNumberId, payload) {
    const baseUrl = process.env.ELEVENLABS_API_URL;
    if (!baseUrl) {
        console.warn('[Agent Phone Update] ELEVENLABS_API_URL not configured');
        return null;
    }

    try {
        const url = `${baseUrl}/api/v1/phone-numbers/${phoneNumberId}`;
        console.log(`[Agent Phone Update] PATCH ${url}`);
        console.log(`[Agent Phone Update] Payload:`, JSON.stringify(payload, null, 2));

        const response = await axios.patch(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.ELEVENLABS_API_KEY && { 'Authorization': `Bearer ${process.env.ELEVENLABS_API_KEY}` })
            }
        });

        console.log(`[Agent Phone Update] Status: ${response.status}`);
        return response.data;
    } catch (err) {
        console.error(`[Agent Phone Update] Failed to update phone number`);
        console.error(`[Agent Phone Update] Error Status:`, err.response?.status);
        console.error(`[Agent Phone Update] Error Data:`, JSON.stringify(err.response?.data || {}, null, 2));
        throw new Error(err.response?.data?.detail?.[0]?.msg || err.message);
    }
}

async function deletePhoneNumber(phoneNumberId) {
    const baseUrl = process.env.ELEVENLABS_API_URL;
    if (!baseUrl) {
        console.warn('[Agent SIP Delete] ELEVENLABS_API_URL not configured');
        return null;
    }

    try {
        const url = `${baseUrl}/api/v1/phone-numbers/${phoneNumberId}`;
        console.log(`[Agent SIP Delete] DELETE ${url}`);

        const response = await axios.delete(url, {
            headers: {
                'accept': 'application/json',
                ...(process.env.ELEVENLABS_API_KEY && { 'Authorization': `Bearer ${process.env.ELEVENLABS_API_KEY}` })
            }
        });

        console.log(`[Agent SIP Delete] Status: ${response.status}`);
        return response.data; // { success: true, message: "..." }
    } catch (err) {
        console.error(`[Agent SIP Delete] Failed to delete phone number`);
        console.error(`[Agent SIP Delete] Error Status:`, err.response?.status);
        console.error(`[Agent SIP Delete] Error Data:`, JSON.stringify(err.response?.data || {}, null, 2));
        throw new Error(err.response?.data?.detail?.[0]?.msg || err.message);
    }
}

async function registerTool(schoolId, agentId) {
    const baseUrl = process.env.ELEVENLABS_API_URL;
    if (!baseUrl) {
        console.warn('[Agent Tool Register] ELEVENLABS_API_URL not configured');
        return null;
    }

    try {
        const url = `${baseUrl}/api/v1/register-tool`;
        const payload = { school_id: schoolId, agent_id: agentId };
        console.log(`[Agent Tool Register] POST ${url}`);
        console.log(`[Agent Tool Register] Payload:`, JSON.stringify(payload, null, 2));

        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.ELEVENLABS_API_KEY && { 'Authorization': `Bearer ${process.env.ELEVENLABS_API_KEY}` })
            }
        });

        console.log(`[Agent Tool Register] Status: ${response.status}`);
        console.log(`[Agent Tool Register] Response:`, JSON.stringify(response.data, null, 2));
        return response.data?.tool_id || null; // Return ONLY the ID string
    } catch (err) {
        console.error(`[Agent Tool Register] Failed to register tool for school ${schoolId}`);
        console.error(`[Agent Tool Register] Error Status:`, err.response?.status);
        console.error(`[Agent Tool Register] Error Data:`, JSON.stringify(err.response?.data || {}, null, 2));
        return null;
    }
}

// Helper function to format Q&A pairs into text for knowledge base ingestion
function formatQAPairsForKB(qaPairs) {
    if (!Array.isArray(qaPairs) || qaPairs.length === 0) {
        return '';
    }

    return qaPairs
        .filter(pair => pair.question && pair.answer)
        .map((pair, index) => {
            return `Q${index + 1}: ${pair.question}\nA${index + 1}: ${pair.answer}`;
        })
        .join('\n\n');
}

// Helper function to ingest a knowledge base document to ElevenLabs
async function ingestKnowledgeBaseDocument(text, schoolName) {
    const baseUrl = process.env.ELEVENLABS_API_URL;
    if (!baseUrl) {
        console.warn('[KB] ELEVENLABS_API_URL not configured, skipping KB ingestion');
        return null;
    }

    try {
        const url = `${baseUrl}/api/v1/knowledge-base/ingest`;

        // Generate document name on backend
        const documentName = `${schoolName} - Knowledge Base`;

        // Create FormData
        const formData = new FormData();
        formData.append('source_type', 'text');
        formData.append('text', text);
        formData.append('name', documentName);

        console.log(`[KB POST] Request URL: ${url}`);
        const response = await axios.post(url, formData, {
            headers: {
                ...formData.getHeaders(),
                ...(process.env.ELEVENLABS_API_KEY && { 'Authorization': `Bearer ${process.env.ELEVENLABS_API_KEY}` })
            }
        });

        console.log(`[KB POST] Response Status: ${response.status}`);
        const documentId = response.data?.document_id || response.data?.id;
        console.log(`[KB] Successfully ingested document: ${documentId}`);
        return documentId;
    } catch (err) {
        console.error(`[KB POST] Failed to ingest document`);
        console.error(`[KB POST] Error Status:`, err.response?.status);
        console.error(`[KB POST] Error Data:`, JSON.stringify(err.response?.data || {}, null, 2));
        throw err;
    }
}

async function patchAgentPrompt(agentId, payload) {
    const baseUrl = process.env.ELEVENLABS_API_URL;
    if (!baseUrl) {
        console.warn('[Agent Patch Prompt] ELEVENLABS_API_URL not configured');
        return null;
    }

    try {
        const url = `${baseUrl}/api/v1/agents/${agentId}/prompt`;
        console.log(`[Agent Patch] PATCH ${url}`);
        console.log(`[Agent Patch Prompt] Payload:`, JSON.stringify(payload, null, 2));


        const response = await axios.patch(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.ELEVENLABS_API_KEY && { 'Authorization': `Bearer ${process.env.ELEVENLABS_API_KEY}` })
            }
        });

        console.log(`[Agent Patch Prompt] Status: ${response.status}`);
        console.log(`[Agent Patch Prompt] Response:`, JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (err) {
        console.error(`[Agent Patch Prompt] Failed to patch agent ${agentId}`);
        console.error(`[Agent Patch Prompt] Error Status:`, err.response?.status);
        console.error(`[Agent Patch Prompt] Error Data:`, JSON.stringify(err.response?.data || {}, null, 2));
        return null;
    }
}

module.exports = {
    createSchoolAgent,
    importSipTrunk,
    deletePhoneNumber,
    updatePhoneNumber,
    registerTool,
    patchAgentPrompt,
    formatQAPairsForKB,
    ingestKnowledgeBaseDocument,
    APPOINTMENT_AGENT_PROMPT,
    GLOBAL_TIME_TOOL_ID,
    NORA_SYSTEM_PROMPT_TEMPLATE,
    DEFAULT_FIRST_MESSAGE_TEMPLATE
};
