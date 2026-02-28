const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true, minlength: 6 },
        role: { type: String, enum: ['donor', 'ngo', 'delivery', 'government'], required: true },
        phone: { type: String, trim: true },
        address: { type: String, trim: true },                  // Physical address (ngos, delivery base)
        organizationName: { type: String, trim: true }, // NGO only
        vehicleType: { type: String, enum: ['bike', 'car', 'van', 'truck'], trim: true }, // Delivery Partner
        vehicleCapacity: { type: Number, min: 1 }, // Delivery Partner (servings)
        location: {
            type: { type: String, default: 'Point' },
            coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
        },
    },
    { timestamps: true }
);

// 2dsphere index for geolocation queries
userSchema.index({ location: '2dsphere' });

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Compare password method
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
