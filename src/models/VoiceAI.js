const mongoose = require('mongoose');

const voiceAISchema = new mongoose.Schema({
    session_id: { type: String },
    participant_id: { type: String },
    transcript: [{
        role: String,
        text: String,
        content: String,
        timestamp: Date
    }],
    transcript_summary: { type: String },
    recording_url: { type: String },
    duration_seconds: { type: Number },
    created_at: { type: Date },
    updated_at: { type: Date }
}, { collection: 'voiceAI', timestamps: false });

module.exports = voiceAISchema;
