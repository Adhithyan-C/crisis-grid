const mongoose = require('mongoose');

const environmentLayerSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['flood', 'roadblock'],
            required: true,
        },
        geometry: {
            type: { type: String, enum: ['Polygon', 'LineString'], required: true },
            coordinates: { type: mongoose.Schema.Types.Mixed, required: true },
        },
        severity: {
            type: Number,
            min: 1,
            max: 5,
            default: null, // only used for flood
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        label: {
            type: String,
            trim: true,
            default: '',
        },
    },
    { timestamps: true }
);

// Note: no 2dsphere index — user-drawn polygons may not satisfy MongoDB's strict
// GeoJSON validity requirements (non-self-intersecting, closed rings, < hemisphere).
// We fetch all active layers at once so geospatial indexing isn't needed.

module.exports = mongoose.model('EnvironmentLayer', environmentLayerSchema);
