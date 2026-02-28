const EnvironmentLayer = require('../models/EnvironmentLayer');

// Shared io reference — set via init()
let io;
const init = (socketIo) => { io = socketIo; };

const emitEnvironmentUpdate = (action, layer) => {
    if (io) io.emit('environment', { action, layer });
};

// @GET /api/environment — all active layers (public/read-only)
const getLayers = async (req, res) => {
    try {
        const layers = await EnvironmentLayer.find({ isActive: true })
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 });
        res.json(layers);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @POST /api/environment — government creates a layer
const createLayer = async (req, res) => {
    try {
        const { type, geometry, severity, label } = req.body;

        if (!type || !geometry) {
            return res.status(400).json({ message: 'type and geometry are required' });
        }
        if (type === 'flood' && geometry.type !== 'Polygon') {
            return res.status(400).json({ message: 'Flood layers must use Polygon geometry' });
        }
        if (type === 'roadblock' && geometry.type !== 'LineString') {
            return res.status(400).json({ message: 'Roadblock layers must use LineString geometry' });
        }

        const layer = await EnvironmentLayer.create({
            type,
            geometry,
            severity: type === 'flood' ? (parseInt(severity) || 1) : null,
            label: label || '',
            createdBy: req.user._id,
        });

        const populated = await layer.populate('createdBy', 'name');
        emitEnvironmentUpdate('created', populated);
        res.status(201).json(populated);
    } catch (err) {
        console.error('Create environment layer error:', err);
        res.status(500).json({ message: err.message });
    }
};

// @PUT /api/environment/:id — government updates a layer (e.g. reshape)
const updateLayer = async (req, res) => {
    try {
        const { geometry, severity, label } = req.body;
        const layer = await EnvironmentLayer.findByIdAndUpdate(
            req.params.id,
            { geometry, severity, label },
            { new: true }
        ).populate('createdBy', 'name');

        if (!layer) return res.status(404).json({ message: 'Layer not found' });

        emitEnvironmentUpdate('updated', layer);
        res.json(layer);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @PATCH /api/environment/:id/deactivate — soft delete
const deactivateLayer = async (req, res) => {
    try {
        const layer = await EnvironmentLayer.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        ).populate('createdBy', 'name');

        if (!layer) return res.status(404).json({ message: 'Layer not found' });

        emitEnvironmentUpdate('deleted', layer);
        res.json({ message: 'Layer deactivated', layer });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = { init, getLayers, createLayer, updateLayer, deactivateLayer };
