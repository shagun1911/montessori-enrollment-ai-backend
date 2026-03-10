const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const School = require('../models/School');
const Integration = require('../models/Integration');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'montessori-enrollment-ai-secret-key-2024';

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const validPassword = bcrypt.compareSync(password, user.passwordHash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            {
                id: user._id.toString(),
                email: user.email,
                name: user.name,
                role: user.role,
                schoolId: user.schoolId ? user.schoolId.toString() : null,
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user._id.toString(),
                email: user.email,
                name: user.name,
                role: user.role,
                schoolId: user.schoolId ? user.schoolId.toString() : undefined,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-passwordHash');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            id: user._id.toString(),
            email: user.email,
            name: user.name,
            role: user.role,
            schoolId: user.schoolId ? user.schoolId.toString() : undefined,
        });
    } catch (err) {
        console.error('Auth me error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { email, password, name, schoolName, address } = req.body;

        if (!email || !password || !name || !schoolName) {
            return res.status(400).json({ error: 'All fields are required.' });
        }

        // 1. Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered.' });
        }

        // 2. Create the school
        const school = await School.create({
            name: schoolName,
            address: address || '',
            status: 'active'
        });

        // 3. Create the user
        const hashedPassword = bcrypt.hashSync(password, 10);
        const user = await User.create({
            email,
            passwordHash: hashedPassword,
            name,
            role: 'school',
            schoolId: school._id
        });

        // 4. Initialize integrations
        await Integration.insertMany([
            { schoolId: school._id, type: 'google', name: 'Google Workspace', connected: false },
            { schoolId: school._id, type: 'outlook', name: 'Microsoft Outlook', connected: false }
        ]);

        // 5. Generate token (auto-login after registration)
        const token = jwt.sign(
            {
                id: user._id.toString(),
                email: user.email,
                name: user.name,
                role: user.role,
                schoolId: user.schoolId ? user.schoolId.toString() : null,
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({
            message: 'Registration successful!',
            token,
            user: {
                id: user._id.toString(),
                email: user.email,
                name: user.name,
                role: user.role,
                schoolId: user.schoolId ? user.schoolId.toString() : undefined,
            },
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
