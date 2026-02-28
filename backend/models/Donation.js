const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema(
    {
        donorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        foodName: { type: String, required: true, trim: true },
        description: { type: String, required: true, trim: true },
        foodType: { type: String, enum: ['veg', 'non-veg'], required: true },
        servings: { type: Number, required: true, min: 1 },
        pickupLocation: {
            type: { type: String, default: 'Point' },
            coordinates: { type: [Number], required: true }, // [lng, lat]
        },
        address: { type: String, required: true, trim: true },
        status: { type: String, enum: ['available', 'claimed'], default: 'available' },
        claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        claimedAt: { type: Date, default: null },
        deliveryStatus: {
            type: String,
            enum: ['waiting_for_delivery', 'accepted_by_delivery', 'picked_up', 'delivered'],
            default: null
        },
        deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        expiryTime: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) }, // 24h default
        imageUrl: { type: String, default: null },
    },
    { timestamps: true }
);

// 2dsphere index — REQUIRED for $geoNear aggregation
donationSchema.index({ pickupLocation: '2dsphere' });

module.exports = mongoose.model('Donation', donationSchema);
