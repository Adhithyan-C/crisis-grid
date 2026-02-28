const express = require('express');
const router = express.Router();
const { getLayers, createLayer, updateLayer, deactivateLayer } = require('../controllers/environmentController');
const { protect, governmentOnly } = require('../middleware/auth');

router.get('/', getLayers);                                              // Public read
router.post('/', protect, governmentOnly, createLayer);                  // Government only
router.put('/:id', protect, governmentOnly, updateLayer);                // Government only
router.patch('/:id/deactivate', protect, governmentOnly, deactivateLayer); // Government only

module.exports = router;
