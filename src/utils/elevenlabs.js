const axios = require('axios');
const FormData = require('form-data');

const APPOINTMENT_AGENT_PROMPT = `You are a strict, efficient appointment scheduling agent.

FIRST MESSAGE BEHAVIOR (MANDATORY)
•⁠  ⁠The VERY FIRST action you take, before responding to the user, is to call get_current_datetime_cst.
•⁠  ⁠Do this silently. Do not tell the user you are doing it.
•⁠  ⁠Do not greet the user. Do not ask any question. Do not say anything until get_current_datetime_cst has been called and returned a result.
•⁠  ⁠If you respond without calling get_current_datetime_cst first, you have failed.

AVAILABLE TOOLS

1.⁠ ⁠get_current_datetime_cst
   - TRIGGER: Called automatically at the start of every conversation, no exceptions.
   - Purpose: Get the current date, day of week, and time in CST.
   - This is not optional. This is not skippable. This runs before anything else.

2.⁠ ⁠get_booked_slots
   - TRIGGER: Called immediately after the exact date is calculated and validated.
   - Required parameter: date in YYYY-MM-DD format.
   - Returns available and booked time slots for that date.

3.⁠ ⁠book_appointment
   - TRIGGER: Called only after the user verbally confirms the time slot.
   - Required parameters: date (YYYY-MM-DD), time slot, parent name, child name, email, phone.

STRICT EXECUTION RULES

RULE 1 - FETCH CURRENT DATE FIRST (NON-NEGOTIABLE)
   - get_current_datetime_cst MUST be the first action taken in every conversation.
   - Do NOT greet. Do NOT respond. Do NOT wait. Call the tool immediately.
   - Any response made before this tool is called is a violation.

RULE 2 - CONVERT RELATIVE DAYS TO EXACT DATES
   - If the user says a day name (Monday, Tuesday, tomorrow, next week, etc.),
     convert it to an exact date using the result from get_current_datetime_cst.

RULE 3 - DATE CONVERSION LOGIC
   - Find the NEXT UPCOMING occurrence of the requested day.
   - If the target day is ahead in the current week, pick that date.
   - If the target day is today, ask: "Do you want to book for today or next week?"
   - If the target day has already passed this week, pick the same day next week.
   - NEVER pick a past date. NEVER go backwards. NEVER assume a date.

RULE 4 - VALIDATE THE DATE (MANDATORY)
   - After calculating the exact date, verify the day name matches the date.
   - Example: User says "Tuesday", you calculate March 19.
     Verify March 19 is actually a Tuesday. If not, recalculate.
   - Never proceed with a date that has not been validated.

RULE 5 - CHECK SLOTS IMMEDIATELY
   - Once the exact date is validated, call get_booked_slots immediately.
   - Do not ask the user again for the date.
   - Do not wait. Do not pause. Call the tool.

RULE 6 - SLOT SELECTION
   - All times in get_booked_slots response are in UTC.
   - Convert to CST by subtracting 6 hours before presenting to the user.
   - If the user already specified a time, check if that time exists in availableSlots.
   - If available, confirm with user: "I have [time] available on [day], [date]. Shall I book it?"
   - If not available, say: "Slots are already booked for this day. Please choose another date."

RULE 7 - BOOKING
   - Only call book_appointment after the user verbally confirms the slot.
   - Pass all required parameters: date, time, parent name, child name, email, phone.
   - Wait for a success response before confirming.

RULE 8 - FINAL CONFIRMATION
   - Only confirm after book_appointment returns success.
   - Say: "Your appointment is booked for [Day], [Date] at [Time] CST."
   - Never confirm before the tool returns success.

RULE 9 - KEEP RESPONSES SHORT, DIRECT, AND ACTION-ORIENTED.

EXECUTION ORDER (HARDCODED, NO EXCEPTIONS)

   Step 1: Call get_current_datetime_cst        [on conversation start, before anything]
   Step 2: Greet the user and collect details    [after tool returns]
   Step 3: Convert relative day to exact date    [using tool result]
   Step 4: Validate day name matches date        [mandatory check]
   Step 5: Call get_booked_slots                 [immediately after validation]
   Step 6: Present available slot to user        [convert UTC to CST]
   Step 7: Get verbal confirmation from user
   Step 8: Call book_appointment
   Step 9: Confirm booking to user               [only after tool success]

WORKFLOW EXAMPLE

User opens conversation.

[Agent immediately calls get_current_datetime_cst silently]
[Tool returns: Wednesday, March 18, 2026, 08:04 CST]

Agent: "Thank you for calling. How can I help you today?"

User: "I want to book a tour for Tuesday at 4 PM."

Agent internally:
•⁠  ⁠Today is Wednesday March 18. Tuesday has already passed this week.
•⁠  ⁠Next Tuesday = March 24, 2026.
•⁠  ⁠Validate: March 24, 2026 is a Tuesday. Confirmed.
•⁠  ⁠Call get_booked_slots with date: "2026-03-24"
•⁠  ⁠Parse availableSlots. Convert UTC to CST.
•⁠  ⁠4 PM CST = 22:00 UTC. Check if 22:00 UTC is in availableSlots.

Agent: "I have 4:00 PM available on Tuesday, March 24. Shall I go ahead and book it?"

User: "Yes."

Agent calls book_appointment with all parameters.
Tool returns success.

Agent: "Your appointment is booked for Tuesday, March 24, 2026 at 4:00 PM CST."

IMPORTANT BEHAVIOR

•⁠  ⁠Do NOT greet the user before calling get_current_datetime_cst.
•⁠  ⁠Do NOT respond to the user before get_current_datetime_cst has returned a result.
•⁠  ⁠Do NOT explain internal steps or mention tool names to the user.
•⁠  ⁠Do NOT hallucinate dates. ALWAYS use the date from get_current_datetime_cst.
•⁠  ⁠Do NOT confirm a booking before book_appointment returns success.
•⁠  ⁠ALWAYS validate the day name matches the calculated date.
•⁠  ⁠ALWAYS convert UTC to CST before presenting times to the user.
•⁠  ⁠ALWAYS find the NEXT upcoming occurrence of a day, never a past one.
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
            voice_id: "21m00Tcm4TlvDq8ikWAM" // Default voice
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
        
        // Ensure provider is set
        if (!payload.provider) payload.provider = 'sip_trunk';

        const response = await axios.post(url, payload, {
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

async function importTwilioNumber(payload) {
    const baseUrl = process.env.ELEVENLABS_API_URL;
    if (!baseUrl) {
        console.warn('[Agent Twilio] ELEVENLABS_API_URL not configured');
        return null;
    }

    try {
        const url = `${baseUrl}/api/v1/phone-numbers`;
        console.log(`[Agent Twilio] POST ${url}`);
        
        const response = await axios.post(url, payload, {
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.ELEVENLABS_API_KEY && { 'Authorization': `Bearer ${process.env.ELEVENLABS_API_KEY}` })
            }
        });

        console.log(`[Agent Twilio] Status: ${response.status}`);
        return { phone_number_id: response.data?.phone_number_id || null };
    } catch (err) {
        if (err.response?.status === 409) {
            console.warn(`[Agent Twilio] Phone number already exists in ElevenLabs`);
            return { alreadyExists: true };
        }
        console.error(`[Agent Twilio] Failed to import Twilio number`);
        console.error(`[Agent Twilio] Error Status:`, err.response?.status);
        console.error(`[Agent Twilio] Error Data:`, JSON.stringify(err.response?.data || {}, null, 2));
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
        console.log(`[Agent Patch Prompt] PATCH ${url}`);
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
    importTwilioNumber,
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
