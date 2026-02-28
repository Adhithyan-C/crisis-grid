const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            next();
        } catch (err) {
            res.status(401).json({ message: 'Not authorized, token failed' });
        }
    } else {
        res.status(401).json({ message: 'Not authorized, no token' });
    }
};

const donorOnly = (req, res, next) => {
    if (req.user && req.user.role === 'donor') return next();
    res.status(403).json({ message: 'Access denied: donors only' });
};

const ngoOnly = (req, res, next) => {
    if (req.user && req.user.role === 'ngo') return next();
    res.status(403).json({ message: 'Access denied: NGOs only' });
};

const deliveryOnly = (req, res, next) => {
    if (req.user && req.user.role === 'delivery') return next();
    res.status(403).json({ message: 'Access denied: delivery partners only' });
};

const governmentOnly = (req, res, next) => {
    if (req.user && req.user.role === 'government') return next();
    res.status(403).json({ message: 'Access denied: government users only' });
};

module.exports = { protect, donorOnly, ngoOnly, deliveryOnly, governmentOnly };
