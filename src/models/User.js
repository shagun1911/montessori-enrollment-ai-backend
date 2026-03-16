const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: false }, // Optional for OAuth users
    name: { type: String, required: true },
    role: { type: String, enum: ['admin', 'school'], required: true },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', default: null },
    googleId: { type: String, unique: true, sparse: true }, // Google OAuth ID
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' }, // Track auth method
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
