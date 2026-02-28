const express = require('express');
const router = express.Router();
const { parseQuery, geocodeHint } = require('../controllers/aiController');

router.post('/parse', parseQuery);
router.get('/geocode', geocodeHint);

module.exports = router;
