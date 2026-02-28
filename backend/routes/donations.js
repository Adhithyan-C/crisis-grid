const express = require('express');
const router = express.Router();
const {
    createDonation,
    searchDonations,
    getMyDonations,
    claimDonation,
    getStats,
} = require('../controllers/donationController');
const { protect, donorOnly, ngoOnly } = require('../middleware/auth');

router.get('/stats', getStats);                       // Public — for landing page
router.post('/', protect, donorOnly, createDonation); // Donors add donations
router.get('/search', protect, searchDonations);      // NGOs search
router.get('/my', protect, donorOnly, getMyDonations);// Donor's own donations
router.patch('/:id/claim', protect, ngoOnly, claimDonation); // Atomic claim

// Logistics / Delivery Partner Routes
const {
    getAvailableMissions,
    acceptMission,
    updateMissionStatus,
    getDeliveryHistory,
    getActiveMission,
} = require('../controllers/donationController');
const { deliveryOnly } = require('../middleware/auth');

router.get('/missions/available', protect, deliveryOnly, getAvailableMissions);
router.get('/missions/active', protect, deliveryOnly, getActiveMission);
router.patch('/missions/:id/accept', protect, deliveryOnly, acceptMission);
router.patch('/missions/:id/status', protect, deliveryOnly, updateMissionStatus);
router.get('/missions/history', protect, deliveryOnly, getDeliveryHistory);

module.exports = router;
