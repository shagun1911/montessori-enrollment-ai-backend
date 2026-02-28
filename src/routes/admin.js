const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const School = require('../models/School');
const User = require('../models/User');
const CallLog = require('../models/CallLog');
const Integration = require('../models/Integration');
const Followup = require('../models/Followup');
const FormQuestion = require('../models/FormQuestion');
const Referral = require('../models/Referral');
const ReferralLink = require('../models/ReferralLink');
const InquirySubmission = require('../models/InquirySubmission');
const TourBooking = require('../models/TourBooking');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Apply auth middleware to all admin routes
router.use(authMiddleware, adminOnly);

// GET /api/admin/dashboard - Dashboard metrics
router.get('/dashboard', async (req, res) => {
    try {
        const totalSchools = await School.countDocuments();
        const activeSchools = await School.countDocuments({ status: 'active' });
        const totalCalls = await CallLog.countDocuments();
        const inquiryCalls = await CallLog.countDocuments({ callType: 'inquiry' });
        const totalFollowups = await Followup.countDocuments();
        const sentFollowups = await Followup.countDocuments({ status: 'sent' });
        const totalReferrals = await Referral.countDocuments();

        // Recent calls with school name
        const recentCalls = await CallLog.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .populate('schoolId', 'name')
            .lean();

        const formattedCalls = recentCalls.map(c => ({
            id: c._id,
            school_name: c.schoolId?.name || 'Unknown',
            caller_name: c.callerName,
            caller_phone: c.callerPhone,
            call_type: c.callType,
            duration: c.duration,
            timestamp: c.createdAt,
        }));

        // Recent followups with school name
        const recentFollowups = await Followup.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .populate('schoolId', 'name')
            .lean();

        const formattedFollowups = recentFollowups.map(f => ({
            id: f._id,
            school_name: f.schoolId?.name || 'Unknown',
            lead_name: f.leadName,
            type: f.type,
            status: f.status,
            timestamp: f.createdAt,
        }));

        res.json({
            metrics: [
                { label: 'Total Schools', value: totalSchools },
                { label: 'Total Calls', value: totalCalls },
                { label: 'Inquiry Calls', value: inquiryCalls },
                { label: 'Followups Sent', value: sentFollowups },
            ],
            recentCalls: formattedCalls,
            recentFollowups: formattedFollowups,
            overview: {
                totalSchools,
                activeSchools,
                totalCalls,
                inquiryCalls,
                totalFollowups,
                sentFollowups,
                totalReferrals,
            },
        });
    } catch (err) {
        console.error('Admin dashboard error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/admin/schools - List all schools
router.get('/schools', async (req, res) => {
    try {
        const schools = await School.find().sort({ createdAt: -1 }).lean();

        // Get call counts and followup counts per school
        const referralLinks = await ReferralLink.find().lean();
        const schoolIdToCode = {};
        referralLinks.forEach(rl => { schoolIdToCode[rl.schoolId.toString()] = rl.code; });

        const TourBooking = require('../models/TourBooking');
        const formatted = await Promise.all(
            schools.map(async (s) => {
                const calls = await CallLog.countDocuments({ schoolId: s._id });
                const inquiryCalls = await CallLog.countDocuments({ schoolId: s._id, callType: 'inquiry' });
                const followupsSent = await Followup.countDocuments({ schoolId: s._id, status: 'sent' });
                const tours = await TourBooking.countDocuments({ schoolId: s._id });

                return {
                    id: s._id.toString(),
                    name: s.name,
                    aiNumber: s.aiNumber,
                    routingNumber: s.routingNumber,
                    status: s.status,
                    language: s.language,
                    calls,
                    inquiryCalls,
                    tours,
                    followupsSent,
                    referralCode: schoolIdToCode[s._id.toString()] || null,
                    createdAt: s.createdAt,
                };
            })
        );

        res.json(formatted);
    } catch (err) {
        console.error('Admin schools error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/admin/schools - Create a new school + user credentials. Optional referralCode links to referrer.
router.post('/schools', async (req, res) => {
    try {
        const { name, email, password, aiNumber, routingNumber, referralCode, referrerSchoolId } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'A user with this email already exists' });
        }

        const school = await School.create({
            name,
            aiNumber: aiNumber || '',
            routingNumber: routingNumber || '',
            status: 'active',
        });

        const passwordHash = bcrypt.hashSync(password, 10);
        await User.create({
            email,
            passwordHash,
            name: name + ' Admin',
            role: 'school',
            schoolId: school._id,
        });

        await Integration.insertMany([
            { schoolId: school._id, type: 'outlook', name: 'Microsoft Outlook', connected: false },
            { schoolId: school._id, type: 'google', name: 'Google Workspace', connected: false },
        ]);

        const refCode = `ref-${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`;
        await ReferralLink.create({ schoolId: school._id, code: refCode });

        let referralLinked = false;
        const refId = referrerSchoolId && mongoose.Types.ObjectId.isValid(referrerSchoolId) ? referrerSchoolId : null;
        const refCodeTrim = referralCode && String(referralCode).trim() ? String(referralCode).trim() : null;

        if (refId) {
            const referrerSchool = await School.findById(refId).select('name').lean();
            const link = await ReferralLink.findOne({ schoolId: refId }).lean();
            if (referrerSchool && link) {
                await Referral.create({
                    referrerSchoolId: refId,
                    referrerSchoolName: referrerSchool.name,
                    referredSchoolId: school._id,
                    newSchoolName: name,
                    referralCode: link.code,
                    status: 'converted',
                });
                referralLinked = true;
            }
        } else if (refCodeTrim) {
            const link = await ReferralLink.findOne({ code: new RegExp(`^${refCodeTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).populate('schoolId', 'name').lean();
            if (link && link.schoolId) {
                await Referral.create({
                    referrerSchoolId: link.schoolId._id,
                    referrerSchoolName: link.schoolId.name,
                    referredSchoolId: school._id,
                    newSchoolName: name,
                    referralCode: link.code,
                    status: 'converted',
                });
                referralLinked = true;
            }
        }

        if ((refId || refCodeTrim) && !referralLinked) {
            console.warn('[Admin] Create school: referral code/school not found:', refCodeTrim || refId);
        }

        res.status(201).json({
            message: 'School created successfully',
            referralLinked,
            school: {
                id: school._id.toString(),
                name,
                email,
                aiNumber: aiNumber || '',
                routingNumber: routingNumber || '',
            },
        });
    } catch (err) {
        console.error('Create school error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/admin/schools/:id - Update school
router.put('/schools/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, aiNumber, routingNumber, status } = req.body;

        const school = await School.findById(id);
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        if (name !== undefined) school.name = name;
        if (aiNumber !== undefined) school.aiNumber = aiNumber;
        if (routingNumber !== undefined) school.routingNumber = routingNumber;
        if (status !== undefined) school.status = status;

        await school.save();

        res.json({ message: 'School updated successfully' });
    } catch (err) {
        console.error('Update school error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/admin/schools/:id - Delete school and all related data from DB
router.delete('/schools/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid school ID' });
        }

        const school = await School.findById(id);
        if (!school) {
            return res.status(404).json({ error: 'School not found' });
        }

        const objectId = new mongoose.Types.ObjectId(id);
        await Promise.all([
            User.deleteMany({ schoolId: objectId }),
            CallLog.deleteMany({ schoolId: objectId }),
            Integration.deleteMany({ schoolId: objectId }),
            Followup.deleteMany({ schoolId: objectId }),
            FormQuestion.deleteMany({ schoolId: objectId }),
            Referral.deleteMany({ referrerSchoolId: objectId }),
            Referral.deleteMany({ referredSchoolId: objectId }),
            ReferralLink.deleteMany({ schoolId: objectId }),
            InquirySubmission.deleteMany({ schoolId: objectId }),
            TourBooking.deleteMany({ schoolId: objectId }),
        ]);
        await School.findByIdAndDelete(id);

        res.json({ message: 'School deleted successfully' });
    } catch (err) {
        console.error('Delete school error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/admin/analytics - Analytics data
router.get('/analytics', async (req, res) => {
    try {
        // Calls by month using aggregation
        const callsByMonth = await CallLog.aggregate([
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                    total: { $sum: 1 },
                    inquiries: { $sum: { $cond: [{ $eq: ['$callType', 'inquiry'] }, 1, 0] } },
                    general: { $sum: { $cond: [{ $eq: ['$callType', 'general'] }, 1, 0] } },
                    routed: { $sum: { $cond: [{ $eq: ['$callType', 'routing'] }, 1, 0] } },
                },
            },
            { $sort: { _id: 1 } },
            { $project: { month: '$_id', total: 1, inquiries: 1, general: 1, routed: 1, _id: 0 } },
        ]);

        // Calls per school
        const callsBySchool = await CallLog.aggregate([
            {
                $group: {
                    _id: '$schoolId',
                    calls: { $sum: 1 },
                    inquiries: { $sum: { $cond: [{ $eq: ['$callType', 'inquiry'] }, 1, 0] } },
                },
            },
            {
                $lookup: {
                    from: 'schools',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'school',
                },
            },
            { $unwind: '$school' },
            { $project: { name: '$school.name', calls: 1, inquiries: 1, _id: 0 } },
            { $sort: { calls: -1 } },
        ]);

        // Followup stats
        const followupStats = await Followup.aggregate([
            {
                $group: {
                    _id: { type: '$type', status: '$status' },
                    count: { $sum: 1 },
                },
            },
            { $project: { type: '$_id.type', status: '$_id.status', count: 1, _id: 0 } },
        ]);

        // Top performing schools
        const schools = await School.find().lean();
        const topSchools = await Promise.all(
            schools.map(async (s) => {
                const totalCalls = await CallLog.countDocuments({ schoolId: s._id });
                const inquiryCalls = await CallLog.countDocuments({ schoolId: s._id, callType: 'inquiry' });
                const followupsSent = await Followup.countDocuments({ schoolId: s._id, status: 'sent' });
                return {
                    name: s.name,
                    status: s.status,
                    total_calls: totalCalls,
                    inquiry_calls: inquiryCalls,
                    followups_sent: followupsSent,
                };
            })
        );
        topSchools.sort((a, b) => b.total_calls - a.total_calls);

        res.json({
            callsByMonth,
            callsBySchool,
            followupStats,
            topSchools,
        });
    } catch (err) {
        console.error('Admin analytics error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/admin/integrations - All integration statuses
router.get('/integrations', async (req, res) => {
    try {
        const integrations = await Integration.find()
            .populate('schoolId', 'name status')
            .lean();

        // Group by type
        const grouped = {};
        integrations.forEach(i => {
            if (!grouped[i.type]) {
                grouped[i.type] = {
                    type: i.type,
                    name: i.name,
                    schools: [],
                };
            }
            grouped[i.type].schools.push({
                schoolId: i.schoolId?._id?.toString(),
                schoolName: i.schoolId?.name || 'Unknown',
                schoolStatus: i.schoolId?.status || 'unknown',
                connected: i.connected,
                connectedAt: i.connectedAt,
            });
        });

        res.json(Object.values(grouped));
    } catch (err) {
        console.error('Admin integrations error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/admin/referrals - All referrals
router.get('/referrals', async (req, res) => {
    try {
        const referrals = await Referral.find()
            .sort({ createdAt: -1 })
            .lean();

        const formatted = referrals.map(r => ({
            id: r._id.toString(),
            referrerSchool: r.referrerSchoolName,
            newSchool: r.newSchoolName,
            referredSchoolId: r.referredSchoolId?.toString() || null,
            date: r.date,
            status: r.status,
        }));

        res.json(formatted);
    } catch (err) {
        console.error('Admin referrals error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
