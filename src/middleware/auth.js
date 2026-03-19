const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'childcare-enrollment-ai-secret-key-2024';

function authMiddleware(req, res, next) {
    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

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
