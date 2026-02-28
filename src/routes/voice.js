const express = require('express');
const CallLog = require('../models/CallLog');
const { triggerAutomation } = require('../services/automation');

const router = express.Router();

// POST /api/voice/call-end - Called by AI agent when call completes
router.post('/call-end', async (req, res) => {
    try {
        const { schoolId, callerName, callerPhone, callType, duration, recordingUrl, leadData } = req.body;

        if (!schoolId) {
            return res.status(400).json({ error: 'schoolId is required' });
        }

        // Create call log
        const callLog = await CallLog.create({
            schoolId,
            callerName: callerName || 'Unknown',
            callerPhone: callerPhone || '',
            callType: callType || 'inquiry',
            duration: duration || 0,
            recordingUrl: recordingUrl || '',
        });

        // If it was an inquiry, handle followups
        if (callType === 'inquiry' && leadData) {
            await triggerAutomation(schoolId, {
                parentName: leadData.parentName || callerName,
                phone: leadData.phone || callerPhone,
                email: leadData.email,
                childAge: leadData.childAge,
                reason: leadData.reason,
            });
        }

        res.json({ success: true, callLogId: callLog._id });
    } catch (err) {
        console.error('Voice call-end error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
