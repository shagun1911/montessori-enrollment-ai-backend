const mongoose = require('mongoose');

const inquirySubmissionSchema = new mongoose.Schema({
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
    parentName: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    answers: [{ questionId: String, question: String, value: String }],
    submittedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('InquirySubmission', inquirySubmissionSchema);
