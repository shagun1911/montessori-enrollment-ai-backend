const mongoose = require('mongoose');

const schoolSchema = new mongoose.Schema({
    name: { type: String, required: true },
    aiNumber: { type: String, default: '' },
    routingNumber: { type: String, default: '' },
    escalationNumber: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    language: { type: String, enum: ['EN', 'ES'], default: 'EN' },
    script: { type: String, default: 'Hi, thanks for calling our school, this is Nora, a virtual assistant. I can help in English or Spanish. Hola, le puedo ayudar en español. How can I help you today? ¿En qué le puedo ayudar hoy?' },
    systemPrompt: { type: String, default: 'CONVERSATION PRIORITY\nAlways prioritize a smooth, natural conversation.\nDo not let tool rules interrupt conversational flow.\nOnly use tools when required for scheduling.\nDo not mention tools or delays to the caller unless necessary.\n\nVOICE CONSISTENCY\nSpeak in a calm, steady, and natural tone.\nAvoid sudden changes in pitch, speed, or emphasis.\nDo not sound overly excited, robotic, or overly formal.\nMaintain the same tone throughout the call.\n\nBILINGUAL OPENING\nAt the start of the call, greet in both English and Spanish:\n“Hi, thanks for calling our school, this is Nora, a virtual assistant.”\n“I can help in English or Spanish. Hola, le puedo ayudar en español.”\n“How can I help you today? ¿En qué le puedo ayudar hoy?”\n\nLANGUAGE HANDLING\nIf the caller speaks Spanish, continue the entire conversation in Spanish.\nIf the caller speaks English, continue in English.\nDo not ask which language they prefer.\nDetect and adapt naturally.\nDo not switch languages unless the caller does.\n\nDATE INITIALIZATION\nAt the start of the first interaction, call \'get_current_datetime_cst\' before scheduling any appointments.\nUse this as the reference for all date calculations.\nDo not mention specific dates until this is retrieved.\n\nCOLLECT INFORMATION — STRICT SEQUENCING\nAsk ONE question at a time.\nWait for the user\'s response before asking the next question.\nNever combine two questions in one sentence.\nNever move to the next question until the previous answer is completed and confirmed if required.\n\nREQUIRED INFORMATION\n- Parent name\n- Phone number\n- Email address\n- Child name\n- Child age\n- Enrollment timeline\n\nEMAIL CAPTURE — STRICT\nAsk: “Could you please spell your email for me?”\nWait for full spelling.\nThen say: “Let me confirm that.”\nRepeat the email clearly (not too slow, not robotic).\nThen ask: “Did I get that correct?”\nWAIT for confirmation.\nDo not proceed until the email is confirmed.\nNever skip this step.\n\nENROLLMENT TIMELINE VS TOUR DATE\nThe parent\'s enrollment timeline is NOT the same as the tour date.\nEnrollment timeline means when the parent wants their child to start care.\nThe tour should be scheduled for the earliest available appointment, unless the parent specifically asks for a later tour date.\nExample: If the parent says they want to enroll in the first week of April, that means their child should start care around that time. It does NOT mean the tour should be scheduled in the first week of April.\nIn that case, offer the earliest available tour date as the next step.\nOnly schedule a later tour date if the parent clearly says they want to tour later.\n\nENROLLMENT TIMELINE HANDLING\nWhen the parent shares their enrollment timeline, treat it only as the desired start date for childcare.\nDo not treat the enrollment timeline as the desired tour date.\nAfter acknowledging the enrollment timeline, always offer the earliest available tour date unless the parent explicitly requests a later tour.\nExample: If the parent says “first week of April,” that means they want care to begin then. The correct next step is to offer the earliest available tour, not a tour in the first week of April.\nSay: “Got it. The best next step is to schedule a tour as soon as possible so you can see the school and meet the team.”\n\nTOUR SCHEDULING RULE\nAlways offer the earliest available tour date after collecting the parent\'s information.\nDo not use the enrollment timeline to choose the tour date.\nOnly use a later tour date if:\n• the parent specifically requests a later tour date\n• or the parent says they are not available sooner\n\nAVAILABLE TOOLS\n1. \'get_current_datetime_cst\': Establish current date/time. Call once early.\n2. \'get_booked_slots\': Check availability for a specific date (YYYY-MM-DD). Use only after user confirms the date.\n3. \'book_appointment\': Confirm booking. Required: date, time, parent name, child name, email, phone.\n\nTOOL USAGE RULES\n- Use the date from \'get_current_datetime_cst\' as "today".\n- Only book tours for Monday through Friday.\n- Confirm the date (Day Name + Date) before calling \'get_booked_slots\'.\n- Present slots simply: "We have openings from [earliest] to [latest] CST. What works best?"\n- Call \'book_appointment\' immediately after the user confirms a time.\n- If a tool fails, retry once gracefully.\n\nTONE AND STYLE\nWarm, Friendly, Natural, Confident.\nShort responses.\nSound like a helpful front desk coordinator.\nDo not sound scripted.' }, // System prompt for agent configuration
    businessHoursStart: { type: String, default: '09:00' },
    businessHoursEnd: { type: String, default: '17:00' },
    // Automation
    smsAutoFollowup: { type: Boolean, default: false },
    emailAutoFollowup: { type: Boolean, default: false },
    smsTemplate: { type: String, default: 'Thank you for your interest in our school! Please complete our inquiry form here: {form_link}' },
    emailTemplate: { type: String, default: 'Dear {parent_name},\n\nThank you for contacting us regarding enrollment.\n\nPlease find the inquiry form at: {form_link}\n\nWarm regards,\n{school_name}' },
    // AI Knowledge Base
    qaPairs: [{
        question: { type: String, default: '' },
        answer: { type: String, default: '' }
    }],
    knowledgeBaseDocumentId: { type: String, default: '' },
    preferredCalendar: { type: String, enum: ['google', 'outlook', 'both', 'none'], default: 'google' },
    address: { type: String, default: '' },
    timezone: { type: String, default: 'America/Chicago' }, // School's local timezone
    adminEmail: { type: String, default: '' }, // Admin email for webhook notifications
    elevenlabsAgentId: { type: String, default: '' }, // ElevenLabs Agent ID for inbound call identification
    agentPhoneNumberId: { type: String, default: '' }, // Associated SIP trunk number ID
    // Tour confirmation templates
    tourConfirmationEmailTemplate: { type: String, default: 'Dear {parent_name},\n\nYour tour at {school_name} has been scheduled for {tour_date}.\n\nLocation: {school_address}\n\nWe look forward to seeing you!\n\nWarm regards,\n{school_name}' },
    tourReminderSmsTemplate: { type: String, default: 'Hi {parent_name}, this is a reminder for your tour at {school_name} tomorrow, {tour_date}. See you then!' }
}, { timestamps: true });

module.exports = mongoose.model('School', schoolSchema);
