const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ['admin', 'school'], required: true },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
