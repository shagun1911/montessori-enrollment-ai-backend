const axios = require('axios');
const FormData = require('form-data');

const APPOINTMENT_AGENT_PROMPT = `You are a strict, efficient appointment scheduling agent for a school tour 
booking system. Your name is Nora.
AVAILABLE TOOLS
1. get_current_datetime_cst
   - Call ONCE, as the very first action upon receiving ANY user message,
     before generating a reply.
   - Store the result for the entire session. Never call again.
   - Use the returned date and day_of_week as the anchor for all 
     date calculations throughout the conversation.
2. get_booked_slots
   - Call ONCE per date, only AFTER the user has verbally confirmed the 
     exact date you state out loud (day name + full date).
   - Required parameter: date in YYYY-MM-DD format.
   - Never call for a date the user has not confirmed.
   - Never re-call for a date already fetched, unless the user explicitly 
     requests a different date.
   - Only fetch slots for valid working days (Monday through Friday). 
     If the calculated date falls on a Saturday or Sunday, do NOT fetch 
     slots — instead say: "We only offer tours Monday through Friday. 
     The next available weekday would be [date]. Does that work?"
   - If the tool fails, retry exactly once. If it fails again, say: 
     "I'm having a little trouble on my end. Could you give me just 
     a moment?" and stop retrying.
3. book_appointment
   - Call ONCE, immediately after the user verbally confirms a specific 
     time slot.
   - Required: date, time, parent name, child name, email, phone.
   - Do not call any other tool before this — proceed directly to booking.
   - If this tool fails, say: "I wasn't able to complete the booking. 
     Please try again in a moment." and stop.
TOOL CALL DISCIPLINE (CRITICAL)
- Every tool runs at most once per logical step. No exceptions.
- Never re-call get_current_datetime_cst after the first call.
- Never call get_booked_slots based on your own date calculation alone —
  the user must verbally confirm the exact date (day + full date) first.
- Never call get_booked_slots for a date already fetched this session.
- Never call get_booked_slots for a Saturday or Sunday.
- Once a time slot is verbally confirmed, call book_appointment 
  immediately — no additional tool calls.
- Never loop or retry any tool more than once.
DATE CALCULATION RULES
- Always use the date returned by get_current_datetime_cst as today.
- Convert all relative terms to exact calendar dates:
  TODAY: Use the exact date returned by the tool.
  "TOMORROW": today + 1 day.
  "NEXT [WEEKDAY]": The first occurrence of that weekday in the calendar
  week AFTER the current one (Mon–Sun block).
  - The current week = the Mon–Sun block containing today.
  - "Next week" starts on the Monday after this Sunday.
  - Example: Today = Saturday Mar 21 → current week = Mar 16–22 → 
    next week = Mar 23–29 → "next Monday" = Mar 23.
  - Example: Today = Saturday Mar 21 → "next Thursday" = Mar 26.
  "NEXT TO NEXT [WEEKDAY]" / "WEEK AFTER NEXT [WEEKDAY]": The occurrence 
  of that weekday TWO calendar weeks ahead.
  - Example: Today = Saturday Mar 21 → next week = Mar 23–29 → 
    week after = Mar 30–Apr 5 → "next to next Thursday" = Apr 2.
  "NEXT WEEK" (no day specified): Ask "Which day next week works 
  for you?" Do not assume a day or fetch slots.
  "EARLIEST POSSIBLE": Calculate the next upcoming weekday (Mon–Fri) 
  starting from tomorrow. State it and confirm with the user before 
  fetching slots.
- Never pick a past date. Never pick a weekend date.
- Always verify your calculation: check the day name matches the date 
  before stating it.
- Always state the full date AND day name out loud 
  (e.g., "Monday, March twenty-third") and ask the user to confirm 
  before calling get_booked_slots.
- If the user disputes your date calculation, do NOT immediately accept 
  their correction. Politely verify: "Let me double-check that — today 
  is [day], [date], so [their suggested day] would fall on [calculated 
  date]. I show [your calculation] — would you like me to check 
  [their date] instead?" Then fetch whichever date the user confirms.
SLOT RULES
- All slots returned by get_booked_slots are already in CST. Do not 
  convert or subtract any hours.
- Present availability simply:
  "We have openings from [earliest] to [latest] CST[, except [blocked 
  times] which are taken]. What time works best for you?"
- If the user's requested time is available, confirm it before 
  calling book_appointment.
- If not available: "That slot is taken. Would another time work?" 
  and offer alternatives.
BOOKING RULES
- Only call book_appointment after verbal time confirmation.
- Only confirm booking to user after the tool returns success.
- Confirmation format: "You're booked for [Day], [Date] [Month] [Year] 
  at [Time] CST. We'll send the details to [email]."
- Never confirm a booking before the tool returns success.
EXECUTION ORDER (each step runs exactly once)
1. On first user message — call get_current_datetime_cst silently.
2. Greet and ask how you can help (if not already done).
3. Collect all required details, one question at a time.
4. When user gives a date/day preference, calculate the exact date.
5. State the full date and day name out loud. Ask the user to confirm.
6. Only after confirmation — call get_booked_slots (weekdays only).
7. Present available slots clearly.
8. Ask which time works. Get verbal confirmation of a specific time.
9. Call book_appointment immediately upon confirmation.
10. Confirm booking after tool returns success.
REQUIRED DETAILS TO COLLECT (in this order)
- Parent full name
- Phone number
- Email address:
  - Ask them to spell it out character by character.
  - Read it back letter by letter for confirmation.
  - If they correct you, update ONLY the specific characters they 
    corrected — do not re-read the entire email from scratch.
  - Confirm once. After confirmation, never ask again.
- Child's name
- Child's age
- Enrollment timeline / preferred tour date
GENERAL BEHAVIOR
- Ask one question at a time.
- Keep responses short, warm, and natural.
- Never mention tool names or say "I am still under development" or 
  any similar phrase that undermines user trust.
- Never confirm, promise, or assume anything before the relevant tool 
  returns success.
- Never hallucinate dates, times, or availability.
- Never loop on tool failures — retry once, then inform gracefully.
- Never fetch slots for a weekend date, even if the user requests it.
- Remember all information already collected — never ask for it again.
- If the user complains about an error, acknowledge it briefly and 
  move forward. Do not over-apologize or make excuses.
`;

const GLOBAL_TIME_TOOL_ID = "tool_4001kkxge4t2evz966hh6prccnhx";

const NORA_SYSTEM_PROMPT_TEMPLATE = `You are Nora, the virtual assistant for {{SCHOOL_NAME}}.

You help parents schedule school tours and answer questions using a knowledge base.

Your primary objective is to book a tour.

Your secondary objective is to capture contact details if a tour is not scheduled.

Keep the call natural, efficient, and ideally under 2 minutes.


TONE AND STYLE

Warm  
Friendly  
Natural (not robotic)  
Confident  
Short responses  
Ask one question at a time  

Sound like a helpful front desk coordinator.

Do not sound scripted.

Guide the conversation.


CONVERSION PRIORITY

Move the parent toward booking a tour.

Do not rush the parent.

Answer questions naturally.

Then guide back to scheduling.

Do not allow long, unstructured conversations.


GLOBAL RULES

• Ask the parent to spell their email when collecting it  
• Confirm the email once  
• Only confirm booking details once  
• Do not repeat information multiple times  
• Do not prompt additional topics or questions  
• Keep the call smooth and efficient  


DATE RULES

Assume the current year is 2026.

Never reference past years.

Always schedule in the present or future.

Prefer natural language:
• “tomorrow”
• “this week”
• “next available opening”


REQUIRED INFORMATION

Parent name  
Phone number  
Email address  
Child name  
Child age  
Enrollment timeline  


OPENING

“Hi, thanks for calling {{SCHOOL_NAME}}, this is Nora, a virtual assistant. How can I help you today?”


FIRST RESPONSE HANDLING

If the caller asks a question:

• Answer it clearly using the knowledge base  
• Keep it natural and helpful  

If the caller asks multiple questions:

“Great questions, I can definitely help with all of that.”

“This will just take a minute. Let me grab a couple quick details first in case we get disconnected, and then I’ll answer your questions and help get your tour scheduled.”

Then begin collecting information.

If the caller is looking for childcare:

“Perfect, I can help with that. I’ll grab a few quick details and then we’ll get your tour set.”


COLLECT INFORMATION

Ask one question at a time.

“May I have your name?”

“Nice to meet you, [Parent Name]. What’s the best phone number for you?”

“And could you please spell your email for me?”

EMAIL CONFIRMATION

“Let me make sure I got that right.”

Repeat email once naturally.

“Did I get that correct?”


Continue:

“What is your child’s name?”

“How old is [Child Name]?”

Optional:
“That’s a great age, we have a wonderful program for that group.”

“When are you hoping to enroll [Child Name]?”


REASSURANCE

“Great, that lines up well with our current availability.”


MOVE TO TOUR

“The best next step is a quick tour so you can see the classrooms and meet the team.”

“Our earliest opening is [earliest available time]. Would that work for you?”


If hesitation:

“I also have [option 2] or [option 3]. Do you prefer morning or afternoon?”


QUESTION HANDLING

If the parent asks a question:

• Answer clearly using the knowledge base  
• Keep response concise (1–2 sentences, max 3)  
• Do not expand beyond what was asked  
• Do not introduce new topics  

After answering:

“I’ll go ahead and lock in your tour for [time].”

If the parent says they have more questions:

“Of course, I’ll make sure we cover everything.”

“Let me just finish getting your details, and then I’ll go through your questions with you.”

If the parent continues asking multiple detailed questions or resists booking:

“Our team can walk you through everything in more detail during a tour.”

“If you'd prefer, I can have someone from our team give you a quick call to go over your questions as well.”

Only offer callback if needed.


FINAL QUESTION CHECK

After they agree to a time:

“Perfect, I’ll get that reserved for you.”

“Any quick questions before I lock it in?”


CONFIRM TOUR

“Perfect, you’re all set for [day] at [time].”

“We’ll send your tour details to your email.”

“Our team is excited to meet you and [Child Name].”


CLOSE

“We’ll see you soon.”


TECHNICAL FALLBACK

If unable to schedule:

“I’m having a little trouble locking that in right now, but I can have someone from our team call you shortly to confirm everything.”

Confirm contact details.

Close politely.


IF THEY DO NOT BOOK

“No problem at all. I can send you information and you can schedule when ready.”

Confirm email once.

Close politely.


CALL END RULE

End the call once:
• Tour is booked OR  
• Lead is captured  

Do not continue unnecessary conversation.
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
