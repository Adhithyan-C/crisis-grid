const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// @POST /api/auth/register
const register = async (req, res) => {
    try {
        const { name, email, password, role, phone, organizationName, vehicleType, vehicleCapacity, address } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({ message: 'Please provide name, email, password, and role' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists with this email' });
        }

        // Handle location for delivery, NGO, and government roles
        let location = { type: 'Point', coordinates: [0, 0] };
        if ((role === 'delivery' || role === 'ngo' || role === 'government') && address) {
            const { geocodeAddress } = require('./donationController');
            const coords = await geocodeAddress(address);
            if (coords) {
                location.coordinates = [coords.lng, coords.lat];
            }
        }

        const user = await User.create({
            name,
            email,
            password,
            role,
            phone: phone || '',
            address: (role === 'ngo' || role === 'delivery') ? address || '' : undefined,
            organizationName: role === 'ngo' ? organizationName || '' : undefined,
            vehicleType: role === 'delivery' ? vehicleType : undefined,
            vehicleCapacity: role === 'delivery' ? parseInt(vehicleCapacity) : undefined,
            location: (role === 'delivery' || role === 'ngo') ? location : undefined,
        });

        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            phone: user.phone,
            organizationName: user.organizationName,
            vehicleType: user.vehicleType,
            vehicleCapacity: user.vehicleCapacity,
            location: user.location,
            token: generateToken(user._id),
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ message: err.message });
    }
};

// @POST /api/auth/login
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Please provide email and password' });
        }

        const user = await User.findOne({ email });
        if (!user || !(await user.matchPassword(password))) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            phone: user.phone,
            organizationName: user.organizationName,
            vehicleType: user.vehicleType,
            vehicleCapacity: user.vehicleCapacity,
            token: generateToken(user._id),
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: err.message });
    }
};

// @GET /api/auth/me
const getMe = async (req, res) => {
    res.json(req.user);
};

const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// @POST /api/auth/google — Verify Google ID token and return JWT
const googleLogin = async (req, res) => {
    try {
        const { idToken, role } = req.body;
        console.log('🏁 Google Login attempt started...');

        if (!idToken) {
            console.error('❌ No ID Token received in request body');
            return res.status(400).json({ message: 'ID token is required' });
        }

        console.log('🔑 Verifying ID Token with Client ID:', process.env.GOOGLE_CLIENT_ID);

        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        console.log('✅ Token verified successfully');

        const payload = ticket.getPayload();
        const { email, name } = payload;

        console.log(`👤 User identified: ${email}`);

        let user = await User.findOne({ email });

        if (!user) {
            // Create new user if they don't exist
            // Note: Password-less login for Google users
            user = await User.create({
                name,
                email,
                role: role || 'donor', // Defaulting to donor if not specified in first-time Oauth
                password: Math.random().toString(36).slice(-10), // Random dummy password
                phone: '',
                organizationName: '',
                location: { type: 'Point', coordinates: [80.2707, 13.0827] } // Default Chennai
            });
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });

        res.json({
            token,
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            organizationName: user.organizationName,
        });
    } catch (err) {
        console.error('❌ Google Auth Error Detail:', err);
        res.status(401).json({
            message: 'Google authentication failed',
            detail: err.message,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        });
    }
};

module.exports = { register, login, getMe, googleLogin };
