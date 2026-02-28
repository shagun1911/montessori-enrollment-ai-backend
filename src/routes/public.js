const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const FormQuestion = require('../models/FormQuestion');
const School = require('../models/School');
const User = require('../models/User');
const Integration = require('../models/Integration');
const ReferralLink = require('../models/ReferralLink');
const Referral = require('../models/Referral');

const router = express.Router();

// GET /api/public/inquiry/:schoolId/forms - Public: get form questions for a school (no auth)
router.get('/inquiry/:schoolId/forms', async (req, res) => {
    try {
        const { schoolId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(schoolId)) {
            return res.status(400).json({ error: 'Invalid school ID' });
        }

        const school = await School.findById(schoolId).select('name').lean();
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        const questions = await FormQuestion.find({ schoolId })
            .sort({ position: 1 })
            .lean();

        res.json({
            schoolName: school.name,
            questions: questions.map(q => ({
                id: q._id.toString(),
                question: q.question,
                required: !!q.required,
            })),
        });
    } catch (err) {
        console.error('Public inquiry forms error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/public/inquiry/:schoolId/submit - Public: submit inquiry form (no auth)
router.post('/inquiry/:schoolId/submit', async (req, res) => {
    try {
        const { schoolId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(schoolId)) {
            return res.status(400).json({ error: 'Invalid school ID' });
        }

        const school = await School.findById(schoolId).select('name').lean();
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        const { parentName, email, phone, answers } = req.body || {};
        const submission = {
            schoolId: new mongoose.Types.ObjectId(schoolId),
            parentName: parentName || 'Not provided',
            email: email || '',
            phone: phone || '',
            answers: Array.isArray(answers) ? answers : [],
            submittedAt: new Date(),
        };

        const InquirySubmission = require('../models/InquirySubmission');
        await InquirySubmission.create(submission);

        res.status(201).json({
            message: 'Thank you! Your inquiry has been submitted.',
            schoolName: school.name,
        });
    } catch (err) {
        console.error('Public inquiry submit error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/public/refer/:code - Resolve referral code (no auth). Returns referrer school name for signup page.
router.get('/refer/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const link = await ReferralLink.findOne({ code }).populate('schoolId', 'name').lean();
        if (!link || !link.schoolId) {
            return res.status(404).json({ error: 'Invalid or expired referral link' });
        }
        res.json({
            valid: true,
            referrerSchoolName: link.schoolId.name,
            code,
        });
    } catch (err) {
        console.error('Referral resolve error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/public/refer/:code/register - Register a new school via referral (no auth). Creates School, User, Referral.
router.post('/refer/:code/register', async (req, res) => {
    try {
        const { code } = req.params;
        const { schoolName, email, password } = req.body || {};

        if (!schoolName?.trim() || !email?.trim() || !password) {
            return res.status(400).json({ error: 'School name, email, and password are required' });
        }

        const link = await ReferralLink.findOne({ code }).populate('schoolId', 'name').lean();
        if (!link || !link.schoolId) {
            return res.status(404).json({ error: 'Invalid or expired referral link' });
        }

        const existingUser = await User.findOne({ email: email.trim().toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'A user with this email already exists' });
        }

        const referrerSchoolId = link.schoolId._id;
        const referrerSchoolName = link.schoolId.name;

        const school = await School.create({
            name: schoolName.trim(),
            aiNumber: '',
            routingNumber: '',
            escalationNumber: '',
            status: 'active',
        });

        const passwordHash = bcrypt.hashSync(password, 10);
        await User.create({
            email: email.trim().toLowerCase(),
            passwordHash,
            name: schoolName.trim() + ' Admin',
            role: 'school',
            schoolId: school._id,
        });

        await Integration.insertMany([
            { schoolId: school._id, type: 'outlook', name: 'Microsoft Outlook', connected: false },
            { schoolId: school._id, type: 'google', name: 'Google Workspace', connected: false },
        ]);

        const newRefCode = `ref-${schoolName.trim().toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`;
        await ReferralLink.create({ schoolId: school._id, code: newRefCode });

        await Referral.create({
            referrerSchoolId,
            referrerSchoolName,
            referredSchoolId: school._id,
            newSchoolName: schoolName.trim(),
            referralCode: code,
            status: 'converted',
        });

        res.status(201).json({
            message: 'School registered successfully. You can sign in with your email and password.',
            schoolId: school._id.toString(),
        });
    } catch (err) {
        console.error('Referral register error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
