require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDatabase, seedDatabase } = require('./src/database');

const authRoutes = require('./src/routes/auth');
const adminRoutes = require('./src/routes/admin');
const schoolRoutes = require('./src/routes/school');
const voiceRoutes = require('./src/routes/voice');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:5001'],
    credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/school', schoolRoutes);
app.use('/api/voice', voiceRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Connect to MongoDB and start server
async function start() {
    try {
        await connectDatabase();
        await seedDatabase();

        app.listen(PORT, () => {
            console.log(`\n🚀 Montessori Enrollment AI Backend`);
            console.log(`   Server running on http://localhost:${PORT}`);
            console.log(`   Database: MongoDB`);
            console.log(`   API Health: http://localhost:${PORT}/api/health`);
            console.log(`\n📋 Default Credentials:`);
            console.log(`   Admin: admin@enrollmentai.com / admin123`);
            console.log(`   School: sunshine@school.com / school123`);
            console.log(`   School: oaktree@school.com / school123`);
            console.log(`   School: rivervalley@school.com / school123\n`);
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err.message);
        process.exit(1);
    }
}

start();
