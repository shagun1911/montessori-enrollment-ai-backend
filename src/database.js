const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const School = require('./models/School');
const User = require('./models/User');
const CallLog = require('./models/CallLog');
const Integration = require('./models/Integration');
const Followup = require('./models/Followup');
const FormQuestion = require('./models/FormQuestion');
const Referral = require('./models/Referral');
const ReferralLink = require('./models/ReferralLink');

async function connectDatabase() {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/montessori-enrollment-ai';
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');
}

async function seedDatabase() {
    // Check if data already exists
    const userCount = await User.countDocuments();
    if (userCount > 0) {
        console.log('ℹ️  Database already seeded, skipping...');
        return;
    }

    console.log('🌱 Seeding database...');

    const adminPasswordHash = bcrypt.hashSync('admin123', 10);
    const schoolPasswordHash = bcrypt.hashSync('school123', 10);

    // Create schools
    const schoolsData = [
        { name: 'Sunshine Montessori', aiNumber: '+1 (555) 123-4567', routingNumber: '+1 (555) 123-4568', status: 'active' },
        { name: 'Oak Tree Academy', aiNumber: '+1 (555) 234-5678', routingNumber: '+1 (555) 234-5679', status: 'active' },
        { name: 'River Valley School', aiNumber: '+1 (555) 345-6789', routingNumber: '+1 (555) 345-6790', status: 'inactive' },
    ];

    const schools = await School.insertMany(schoolsData);

    // Create admin user
    await User.create({
        email: 'admin@enrollmentai.com',
        passwordHash: adminPasswordHash,
        name: 'Admin',
        role: 'admin',
        schoolId: null,
    });

    // Create school users
    const schoolUsers = [
        { email: 'sunshine@school.com', name: 'Sunshine Admin', schoolId: schools[0]._id },
        { email: 'oaktree@school.com', name: 'Oak Tree Admin', schoolId: schools[1]._id },
        { email: 'rivervalley@school.com', name: 'River Valley Admin', schoolId: schools[2]._id },
    ];

    await User.insertMany(
        schoolUsers.map(u => ({
            ...u,
            passwordHash: schoolPasswordHash,
            role: 'school',
        }))
    );

    // Create integrations for each school
    const integrations = [];
    schools.forEach(school => {
        integrations.push(
            { schoolId: school._id, type: 'outlook', name: 'Microsoft Outlook', connected: false },
            { schoolId: school._id, type: 'google', name: 'Google Workspace', connected: false },
        );
    });
    const createdIntegrations = await Integration.insertMany(integrations);

    // Connect first school's Outlook
    await Integration.updateOne(
        { schoolId: schools[0]._id, type: 'outlook' },
        { connected: true, connectedAt: new Date('2024-01-15') }
    );

    // Create sample call logs (50 calls)
    const callTypes = ['inquiry', 'general', 'inquiry', 'inquiry', 'routing'];
    const callerNames = ['Maria Garcia', 'John Smith', 'Sarah Johnson', 'David Lee', 'Emily Chen'];
    const callerPhones = ['+1 (555) 111-1111', '+1 (555) 222-2222', '+1 (555) 333-3333', '+1 (555) 444-4444', '+1 (555) 555-5555'];

    const callLogs = [];
    for (let i = 0; i < 50; i++) {
        const schoolIndex = i % 3;
        const nameIndex = i % 5;
        const typeIndex = i % 5;
        const day = Math.floor(Math.random() * 28) + 1;
        const month = Math.floor(Math.random() * 3);
        const hour = Math.floor(Math.random() * 12) + 8;
        const minute = Math.floor(Math.random() * 60);

        callLogs.push({
            schoolId: schools[schoolIndex]._id,
            callerName: callerNames[nameIndex],
            callerPhone: callerPhones[nameIndex],
            callType: callTypes[typeIndex],
            duration: Math.floor(Math.random() * 300) + 30,
            createdAt: new Date(2024, month, day, hour, minute),
        });
    }
    await CallLog.insertMany(callLogs);

    // Create sample followups
    const followupData = [
        { name: 'John Doe', type: 'SMS', status: 'sent', message: 'Thank you for your inquiry!' },
        { name: 'Jane Smith', type: 'Email', status: 'pending', message: 'Tour confirmation details' },
        { name: 'Bob Johnson', type: 'SMS', status: 'sent', message: 'Enrollment form link' },
        { name: 'Alice Williams', type: 'Email', status: 'failed', message: 'Welcome information' },
        { name: 'Carlos Rodriguez', type: 'SMS', status: 'sent', message: 'Follow-up on tour visit' },
    ];

    await Followup.insertMany(
        followupData.map((f, i) => ({
            schoolId: schools[i % 3]._id,
            leadName: f.name,
            type: f.type,
            status: f.status,
            message: f.message,
            recipient: f.type === 'SMS'
                ? `+1 (555) 999-${String(i).padStart(4, '0')}`
                : `${f.name.toLowerCase().replace(' ', '.')}@email.com`,
        }))
    );

    // Create sample form questions for first school
    await FormQuestion.insertMany([
        { schoolId: schools[0]._id, question: "What is your child's name?", required: true, position: 0 },
        { schoolId: schools[0]._id, question: "What is your preferred contact method?", required: false, position: 1 },
        { schoolId: schools[0]._id, question: "What age group is your child in?", required: true, position: 2 },
    ]);

    // Create sample referrals
    await Referral.insertMany([
        { referrerSchoolId: schools[0]._id, referrerSchoolName: 'Sunshine Montessori', newSchoolName: 'Oak Tree Academy', referralCode: 'REF-001', date: new Date('2024-01-15'), status: 'converted' },
        { referrerSchoolId: schools[1]._id, referrerSchoolName: 'Oak Tree Academy', newSchoolName: 'River Valley School', referralCode: 'REF-002', date: new Date('2024-02-01'), status: 'active' },
    ]);

    // Create referral links for schools
    await ReferralLink.insertMany(
        schools.map(school => ({
            schoolId: school._id,
            code: `ref-${school.name.toLowerCase().replace(/\s+/g, '-')}`,
        }))
    );

    console.log('✅ Database seeded with sample data');
}

module.exports = { connectDatabase, seedDatabase };
