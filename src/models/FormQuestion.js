const mongoose = require('mongoose');

const formQuestionSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    question: { type: String, required: true },
    required: { type: Boolean, default: false },
    position: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('FormQuestion', formQuestionSchema);
