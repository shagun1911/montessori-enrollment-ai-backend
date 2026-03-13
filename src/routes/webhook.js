const express = require('express');
const mongoose = require('mongoose');
const ElevenLabsWebhook = require('../models/ElevenLabsWebhook');
const School = require('../models/School');
const User = require('../models/User');
const TourBooking = require('../models/TourBooking');
const Followup = require('../models/Followup');
const { processTranscript } = require('../services/openaiService');
const { createCalendarEvent, isSlotAvailable } = require('../services/calendarService');

const router = express.Router();

/**
 * POST /api/v1/webhook/elevenlabs
 * Webhook endpoint to receive call transcript and recording data from ElevenLabs API
 * No authentication required - called by ElevenLabs service
 */
router.post('/elevenlabs', async (req, res) => {
    // Immediately acknowledge receipt with 200 OK
    res.status(200).json({ 
        status: 'received',
        message: 'Webhook received successfully'
    });

    // Process webhook asynchronously (after sending response)
    processWebhookAsync(req.body).catch(err => {
        console.error('[Webhook] Async processing error:', err);
    });
});

/**
 * Asynchronously process the webhook payload
 */
async function processWebhookAsync(payload) {
    try {
        // Log all incoming webhook data
        console.log('[Webhook] ========================================');
        console.log('[Webhook] Received webhook payload:');
        console.log('[Webhook] Type:', payload?.type);
        console.log('[Webhook] Full Payload:', JSON.stringify(payload, null, 2));
        console.log('[Webhook] ========================================');

        if (!payload || !payload.type) {
            console.warn('[Webhook] Invalid payload: missing type field');
            return;
        }

        const { type, data } = payload;

        if (!data) {
            console.warn('[Webhook] Invalid payload: missing data field');
            return;
        }

        // Extract common fields
        const conversationId = data.conversation_id || '';
        const agentId = data.agent_id || '';
        const agentName = data.agent_name || '';
        const userId = data.user_id || '';
        const status = data.status || '';
        const metadata = data.metadata || {};

        // Prepare webhook document based on type
        let webhookDoc = {
            type: type,
            conversation_id: conversationId,
            agent_id: agentId,
            agent_name: agentName,
            user_id: userId,
            status: status,
            metadata: metadata,
            raw_payload: payload, // Store full payload for debugging
            processed: false,
            received_at: new Date()
        };

        // Handle different webhook types
        if (type === 'post_call_transcription') {
            console.log('[Webhook] Processing post_call_transcription webhook');
            console.log('[Webhook] Conversation ID:', conversationId);
            console.log('[Webhook] Transcript entries:', Array.isArray(data.transcript) ? data.transcript.length : 0);
            
            webhookDoc.transcript = data.transcript || [];
            
            // Log transcript summary
            if (Array.isArray(data.transcript) && data.transcript.length > 0) {
                console.log('[Webhook] Transcript preview (first entry):', 
                    JSON.stringify(data.transcript[0], null, 2));
            }

        } else if (type === 'post_call_audio') {
            console.log('[Webhook] Processing post_call_audio webhook');
            console.log('[Webhook] Conversation ID:', conversationId);
            console.log('[Webhook] Audio data length:', 
                data.full_audio ? `${data.full_audio.length} characters (base64)` : 'missing');
            
            webhookDoc.audio_base64 = data.full_audio || '';
            
            // Log audio metadata
            if (metadata.phone_call) {
                console.log('[Webhook] Call duration:', metadata.phone_call.call_duration_secs, 'seconds');
                console.log('[Webhook] Call direction:', metadata.phone_call.direction);
                console.log('[Webhook] External number:', metadata.phone_call.external_number);
            }

        } else {
            console.warn(`[Webhook] Unknown webhook type: ${type}`);
            // Still store it for debugging
        }

        // Save to database
        const savedWebhook = await ElevenLabsWebhook.create(webhookDoc);
        console.log(`[Webhook] Saved webhook to database. ID: ${savedWebhook._id}, Type: ${type}, Conversation: ${conversationId}`);

        // Mark as processed
        savedWebhook.processed = true;
        await savedWebhook.save();
        console.log('[Webhook] Webhook marked as processed');

        // Process transcript with OpenAI if it's a transcription webhook
        if (type === 'post_call_transcription' && Array.isArray(data.transcript) && data.transcript.length > 0) {
            console.log('[Webhook] Starting AI processing for transcript...');
            processTranscriptWithAI(savedWebhook._id, data.transcript).catch(err => {
                console.error('[Webhook] Error in AI processing:', err);
            });
        }

    } catch (err) {
        console.error('[Webhook] Error processing webhook:', err);
        console.error('[Webhook] Error stack:', err.stack);
        
        // Try to save error information
        try {
            await ElevenLabsWebhook.create({
                type: payload?.type || 'unknown',
                conversation_id: payload?.data?.conversation_id || 'error',
                raw_payload: payload,
                processed: false,
                received_at: new Date(),
                metadata: {
                    error: err.message,
                    error_stack: err.stack
                }
            });
        } catch (saveErr) {
            console.error('[Webhook] Failed to save error record:', saveErr);
        }
    }
}

/**
 * Process transcript with OpenAI (summary and tour booking extraction)
 * This runs asynchronously after the webhook is saved
 */
async function processTranscriptWithAI(webhookId, transcriptArray) {
    try {
        console.log(`[Webhook AI] Processing transcript for webhook ID: ${webhookId}`);
        
        // Process transcript with OpenAI
        const aiResult = await processTranscript(transcriptArray);
        
        // Update webhook with AI results
        const updatedWebhook = await ElevenLabsWebhook.findByIdAndUpdate(
            webhookId,
            {
                summary: aiResult.summary,
                tour_booking_detected: aiResult.tour_booking_detected,
                tour_booking_date: aiResult.tour_booking_date,
                tour_booking_extracted: aiResult.tour_booking_extracted,
                ai_processed: true
            },
            { new: true }
        );

        console.log(`[Webhook AI] AI processing complete for webhook ID: ${webhookId}`);
        console.log(`[Webhook AI] Summary generated: ${aiResult.summary ? 'Yes' : 'No'}`);
        console.log(`[Webhook AI] Tour booking detected: ${aiResult.tour_booking_detected}`);
        
        if (aiResult.tour_booking_detected && aiResult.tour_booking_date) {
            console.log(`[Webhook AI] Tour booking date: ${aiResult.tour_booking_date}`);
            
            // Automatically create calendar booking
            await createTourBookingFromWebhook(updatedWebhook, aiResult).catch(err => {
                console.error('[Webhook AI] Error creating tour booking:', err);
            });
        }

        // Send email notification to admin AFTER AI processing completes (so it includes summary)
        sendAdminEmailNotification(updatedWebhook, aiResult).catch(err => {
            console.error('[Webhook AI] Error sending admin email notification:', err);
        });

        return updatedWebhook;

    } catch (err) {
        console.error(`[Webhook AI] Error processing transcript for webhook ${webhookId}:`, err);
        // Mark as AI processed even if it failed, so we don't retry indefinitely
        try {
            const existingWebhook = await ElevenLabsWebhook.findById(webhookId).select('metadata').lean();
            await ElevenLabsWebhook.findByIdAndUpdate(webhookId, {
                ai_processed: true,
                $set: {
                    'metadata.ai_processing_error': err.message
                }
            });
        } catch (updateErr) {
            console.error('[Webhook AI] Failed to update error status:', updateErr);
        }
        throw err;
    }
}

/**
 * Helper function to normalize phone number
 */
function normalizePhone(phone) {
    if (!phone || typeof phone !== 'string') return '';
    const trimmed = phone.trim().replace(/[\s\-\(\)]/g, '');
    if (!trimmed) return '';
    return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

/**
 * Extract parent information from transcript using OpenAI
 */
async function extractParentInfo(transcriptArray) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('[Webhook] OPENAI_API_KEY not configured, skipping parent info extraction');
        return { parentName: '', phone: '', email: '', childAge: '', reason: '' };
    }

    try {
        const { formatTranscript } = require('../services/openaiService');
        const transcriptText = formatTranscript(transcriptArray);
        if (!transcriptText || transcriptText.trim().length === 0) {
            return { parentName: '', phone: '', email: '', childAge: '', reason: '' };
        }

        const axios = require('axios');
        const prompt = `You are analyzing a phone call transcript between a school enrollment AI agent and a parent.

Extract the following information about the parent/caller:
- Parent's name
- Phone number (if mentioned)
- Email address (if mentioned)
- Child's age (if mentioned)
- Reason for inquiry (if mentioned)

Respond ONLY with a JSON object in this exact format:
{
  "parent_name": "name or empty string",
  "phone": "phone number or empty string",
  "email": "email address or empty string",
  "child_age": "child age or empty string",
  "reason": "reason for inquiry or empty string"
}

Transcript:
${transcriptText}

JSON Response:`;

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 200,
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
            return { parentName: '', phone: '', email: '', childAge: '', reason: '' };
        }

        const info = JSON.parse(content);
        return {
            parentName: info.parent_name || '',
            phone: info.phone || '',
            email: info.email || '',
            childAge: info.child_age || '',
            reason: info.reason || ''
        };
    } catch (err) {
        console.error('[Webhook] Error extracting parent info:', err.message);
        return { parentName: '', phone: '', email: '', childAge: '', reason: '' };
    }
}

/**
 * Find school by called phone number (aiNumber) or by elevenlabsAgentId stored on the school.
 * Priority:
 *   1. Match metadata.phone_call.to_number against school.aiNumber  (phone calls)
 *   2. Match webhook.agent_id against school.elevenlabsAgentId        (SDK / widget calls)
 * No hardcoded IDs anywhere.
 */
async function findSchoolForWebhook(webhook) {
    try {
        // ── Strategy 1: Phone-call match by called number ──────────────────
        const phoneCall = webhook.metadata?.phone_call || {};
        const calledNumber = phoneCall.to_number || phoneCall.external_number || '';

        if (calledNumber) {
            const normalizedCalled = normalizePhone(calledNumber);
            if (normalizedCalled) {
                console.log(`[Webhook] Strategy 1 – searching by called number: ${normalizedCalled}`);

                const allSchools = await School.find({}).select('_id name aiNumber status').lean();
                const matchedSchool = allSchools.find(s => {
                    const schoolAiNumber = normalizePhone(s.aiNumber || '');
                    return schoolAiNumber === normalizedCalled;
                });

                if (matchedSchool) {
                    console.log(`[Webhook] Found school by aiNumber: "${matchedSchool.name}" (${matchedSchool._id}, status: ${matchedSchool.status})`);
                    return matchedSchool._id;
                }

                console.warn(`[Webhook] No school matched called number: ${normalizedCalled}`);
            }
        }

        // ── Strategy 2: Agent ID match via elevenlabsAgentId on school ─────
        const agentId = webhook.agent_id || '';
        if (agentId) {
            console.log(`[Webhook] Strategy 2 – searching by elevenlabsAgentId: ${agentId}`);

            const matchedSchool = await School.findOne({ elevenlabsAgentId: agentId })
                .select('_id name status')
                .lean();

            if (matchedSchool) {
                console.log(`[Webhook] Found school by elevenlabsAgentId: "${matchedSchool.name}" (${matchedSchool._id}, status: ${matchedSchool.status})`);
                return matchedSchool._id;
            }

            console.warn(`[Webhook] No school has elevenlabsAgentId = "${agentId}"`);
        }

        // ── No school found – log helpful debug info ───────────────────────
        const allSchools = await School.find({}).select('_id name aiNumber elevenlabsAgentId').lean();
        console.warn('[Webhook] Could not find school for this webhook.');
        console.warn('[Webhook] Webhook data:', {
            agent_id: webhook.agent_id,
            called_number: calledNumber || '(none – SDK call)',
            user_id: webhook.user_id,
        });
        console.warn('[Webhook] All schools in DB:');
        allSchools.forEach(s => {
            console.warn(`  - "${s.name}" (${s._id}): aiNumber="${s.aiNumber || 'N/A'}", elevenlabsAgentId="${s.elevenlabsAgentId || 'NOT SET'}"`);
        });

        return null;
    } catch (err) {
        console.error('[Webhook] Error finding school:', err);
        return null;
    }
}


/**
 * Create tour booking from webhook when OpenAI detects a booking
 */
async function createTourBookingFromWebhook(webhook, aiResult) {
    try {
        console.log('[Webhook Booking] Starting automatic tour booking creation...');
        
        // Find school
        const schoolId = await findSchoolForWebhook(webhook);
        if (!schoolId) {
            console.warn('[Webhook Booking] Cannot create booking: school not found');
            return;
        }

        // Extract parent info from transcript
        const parentInfo = await extractParentInfo(webhook.transcript || []);
        console.log('[Webhook Booking] Extracted parent info:', parentInfo);

        // Parent's phone is 'from_number' for inbound calls
        const phoneCall = webhook.metadata?.phone_call || {};
        const callerPhone = phoneCall.from_number || '';
        const phone = parentInfo.phone || callerPhone || '';
        const parentName = parentInfo.parentName || 'Parent';

        // Get tour booking date
        const tourDate = aiResult.tour_booking_date;
        if (!tourDate || isNaN(new Date(tourDate).getTime())) {
            console.warn('[Webhook Booking] Invalid tour booking date');
            return;
        }

        const start = new Date(tourDate);
        const end = new Date(start.getTime() + 15 * 60 * 1000); // 15-minute slot

        // Check slot availability
        const { available, error: slotError } = await isSlotAvailable(schoolId, start, end);
        if (!available) {
            console.warn(`[Webhook Booking] Slot not available: ${slotError || 'Time slot is already booked'}`);
            // Still create the booking record but mark it as unavailable
            await TourBooking.create({
                schoolId,
                parentName,
                phone: phone || '',
                email: parentInfo.email || '',
                childAge: parentInfo.childAge || '',
                reason: parentInfo.reason || '',
                scheduledAt: start,
                calendarEventId: '',
                calendarProvider: '',
            });
            console.log('[Webhook Booking] Tour booking created but calendar event not created (slot unavailable)');
            return;
        }

        // Get school name and preferred calendar for event title
        const school = await School.findById(schoolId).select('name preferredCalendar').lean();
        const title = `School Tour – ${parentName}`;
        const description = `Tour for ${parentName}. Phone: ${phone || 'N/A'}. Email: ${parentInfo.email || 'N/A'}. Reason: ${parentInfo.reason || 'Inquiry'}.${aiResult.tour_booking_extracted?.notes ? ` Notes: ${aiResult.tour_booking_extracted.notes}` : ''}`;
        
        console.log(`[Webhook Booking] School: ${school?.name || 'Unknown'}`);
        console.log(`[Webhook Booking] Preferred Calendar: ${school?.preferredCalendar || 'google'}`);
        console.log(`[Webhook Booking] Tour Date/Time: ${start.toISOString()}`);
        console.log(`[Webhook Booking] Event Title: ${title}`);

        // Check for connected integrations before attempting to create event
        const Integration = require('../models/Integration');
        const integrations = await Integration.find({
            schoolId,
            connected: true,
            type: { $in: ['google', 'outlook'] }
        }).select('type connected').lean();
        
        console.log(`[Webhook Booking] Found ${integrations.length} connected integration(s):`, 
            integrations.map(i => `${i.type} (connected: ${i.connected})`).join(', ') || 'None');

        // Create calendar event
        console.log(`[Webhook Booking] Attempting to create calendar event with preference: ${school?.preferredCalendar || 'google'}...`);

        // Create calendar event
        const calResult = await createCalendarEvent(schoolId, {
            title,
            startDateTime: start,
            endDateTime: end,
            description
        });
        
        console.log(`[Webhook Booking] Calendar event creation result:`, JSON.stringify(calResult, null, 2));

        // Create TourBooking record
        const tourBooking = await TourBooking.create({
            schoolId,
            parentName,
            phone: phone || '',
            email: parentInfo.email || '',
            childAge: parentInfo.childAge || '',
            reason: parentInfo.reason || '',
            scheduledAt: start,
            calendarEventId: calResult.success ? calResult.eventId : '',
            calendarProvider: calResult.success ? calResult.provider : '',
        });

        console.log(`[Webhook Booking] Tour booking created successfully!`);
        console.log(`[Webhook Booking] Tour Booking ID: ${tourBooking._id}`);
        console.log(`[Webhook Booking] Scheduled At: ${start}`);
        console.log(`[Webhook Booking] Calendar Event Created: ${calResult.success ? 'Yes' : 'No'}`);
        if (calResult.success) {
            console.log(`[Webhook Booking] Calendar Provider: ${calResult.provider}`);
            console.log(`[Webhook Booking] Calendar Event ID: ${calResult.eventId}`);
        }

        return tourBooking;

    } catch (err) {
        console.error('[Webhook Booking] Error creating tour booking:', err);
        throw err;
    }
}

/**
 * Send email notification to admin when webhook is received and processed
 * @param {Object} webhook - The webhook document (with AI processing results)
 * @param {Object} aiResult - The AI processing result (summary, tour booking info)
 */
async function sendAdminEmailNotification(webhook, aiResult = null) {
    try {
        // Find school by phone number or agent ID
        const schoolId = await findSchoolForWebhook(webhook);
        if (!schoolId) {
            console.warn('[Webhook Email] Cannot send email: school not found');
            return;
        }

        // schoolId might be ObjectId or string, handle both
        let schoolObjectId = schoolId;
        if (typeof schoolId === 'string' && mongoose.Types.ObjectId.isValid(schoolId)) {
            schoolObjectId = new mongoose.Types.ObjectId(schoolId);
        } else if (!(schoolId instanceof mongoose.Types.ObjectId)) {
            schoolObjectId = schoolId;
        }

        console.log(`[Webhook Email] Looking up school with ID: ${schoolObjectId} (type: ${typeof schoolObjectId})`);
        
        const school = await School.findById(schoolObjectId).select('name adminEmail').lean();
        
        console.log(`[Webhook Email] School found: ${school ? school.name : 'Not found'}`);
        
        if (!school) {
            console.warn('[Webhook Email] School not found in database');
            return;
        }

        // Find the user associated with this school (the school admin user)
        const schoolUser = await User.findOne({ 
            schoolId: schoolObjectId, 
            role: 'school' 
        }).select('email name').lean();
        
        console.log(`[Webhook Email] School user found: ${schoolUser ? schoolUser.name : 'Not found'}`);
        console.log(`[Webhook Email] School user email: "${schoolUser?.email || 'Not set'}"`);
        console.log(`[Webhook Email] School adminEmail: "${school?.adminEmail || 'Not set'}"`);
        
        // Determine admin email: prefer user email, fallback to school adminEmail
        let adminEmail = null;
        if (schoolUser && schoolUser.email && schoolUser.email.trim()) {
            adminEmail = schoolUser.email.trim();
            console.log(`[Webhook Email] Using school user email: ${adminEmail}`);
        } else if (school.adminEmail && school.adminEmail.trim()) {
            adminEmail = school.adminEmail.trim();
            console.log(`[Webhook Email] Using school adminEmail field: ${adminEmail}`);
        }
        
        if (!adminEmail) {
            console.log('[Webhook Email] No admin email found (neither school user email nor school adminEmail), skipping notification');
            // Debug: show all school users
            const allSchoolUsers = await User.find({ role: 'school' }).select('email name schoolId').lean();
            console.log(`[Webhook Email] Total school users: ${allSchoolUsers.length}`);
            if (allSchoolUsers.length > 0) {
                const schoolsWithUsers = await School.find({ _id: { $in: allSchoolUsers.map(u => u.schoolId).filter(Boolean) } }).select('name').lean();
                const schoolMap = new Map(schoolsWithUsers.map(s => [s._id.toString(), s.name]));
                console.log(`[Webhook Email] School users:`, allSchoolUsers.map(u => `${schoolMap.get(u.schoolId?.toString()) || 'Unknown'}: ${u.email}`).join(', '));
            }
            return;
        }
        
        // Get email transport
        const host = process.env.SMTP_HOST;
        const port = process.env.SMTP_PORT || 587;
        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
        const secure = process.env.SMTP_SECURE === 'true';

        if (!host || !user || !pass) {
            console.warn('[Webhook Email] SMTP not configured, cannot send admin notification');
            return;
        }

        const nodemailer = require('nodemailer');
        const transport = nodemailer.createTransport({
            host,
            port: Number(port),
            secure,
            auth: { user, pass },
        });

        const from = process.env.MAIL_FROM || process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@enrollmentai.com';
        
        // Format call information
        const callDuration = webhook.metadata?.phone_call?.call_duration_secs || 0;
        const callDurationMin = Math.floor(callDuration / 60);
        const callDurationSec = callDuration % 60;
        const callerNumber = webhook.user_id || webhook.metadata?.phone_call?.external_number || 'Unknown';
        const conversationId = webhook.conversation_id || 'N/A';
        const receivedAt = webhook.received_at ? new Date(webhook.received_at).toLocaleString() : new Date().toLocaleString();

        // Count transcript entries
        const transcriptCount = Array.isArray(webhook.transcript) ? webhook.transcript.length : 0;

        // Include AI processing results if available
        const summary = webhook.summary || aiResult?.summary || '';
        const tourBooked = webhook.tour_booking_detected || aiResult?.tour_booking_detected || false;
        const tourDate = webhook.tour_booking_date || aiResult?.tour_booking_date || null;
        const tourNotes = webhook.tour_booking_extracted?.notes || aiResult?.tour_booking_extracted?.notes || '';

        const emailSubject = `New Call Received - ${school.name}${tourBooked ? ' (Tour Booked)' : ''}`;
        let emailBody = `Hello,

A new call has been received and processed for ${school.name}.

Call Details:
- Conversation ID: ${conversationId}
- Caller Number: ${callerNumber}
- Call Duration: ${callDurationMin}m ${callDurationSec}s
- Transcript Entries: ${transcriptCount}
- Received At: ${receivedAt}

`;

        if (summary) {
            emailBody += `Call Summary:
${summary}

`;
        }

        if (tourBooked && tourDate) {
            const tourDateStr = new Date(tourDate).toLocaleString(undefined, { 
                dateStyle: 'full', 
                timeStyle: 'short' 
            });
            emailBody += `Tour Booking:
- Tour Scheduled: ${tourDateStr}
${tourNotes ? `- Notes: ${tourNotes}\n` : ''}
`;
        }

        emailBody += `You can view the full call details in your dashboard.

Best regards,
Montessori Enrollment AI Platform`;

        await transport.sendMail({
            from,
            to: adminEmail,
            subject: emailSubject,
            text: emailBody,
        });

        // Create Followup record to track admin email notification
        await Followup.create({
            schoolId,
            leadName: 'Admin Notification',
            type: 'Email',
            status: 'sent',
            message: emailBody,
            recipient: adminEmail,
        });

        console.log(`[Webhook Email] Admin notification sent successfully to ${adminEmail}`);

    } catch (err) {
        console.error('[Webhook Email] Error sending admin email notification:', err.message);
        // Don't throw - email failure shouldn't break webhook processing
    }
}

module.exports = router;

