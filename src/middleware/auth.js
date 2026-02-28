const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'montessori-enrollment-ai-secret-key-2024';

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

function schoolOnly(req, res, next) {
    if (req.user.role !== 'school') {
        return res.status(403).json({ error: 'School access required' });
    }
    next();
}

module.exports = { authMiddleware, adminOnly, schoolOnly };
