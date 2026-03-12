const express = require('express');
const ElevenLabsWebhook = require('../models/ElevenLabsWebhook');
const { processTranscript } = require('../services/openaiService');

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
        }

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

module.exports = router;

