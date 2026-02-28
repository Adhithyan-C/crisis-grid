import axios from 'axios';

const API = axios.create({
    baseURL: 'http://localhost:5000/api',
});

// Auto-attach JWT token to every request
API.interceptors.request.use((config) => {
    const token = localStorage.getItem('ff_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// Auth
export const registerUser = (data) => API.post('/auth/register', data);
export const loginUser = (data) => API.post('/auth/login', data);
export const googleLogin = (idToken, role) => API.post('/auth/google', { idToken, role });
export const getMe = () => API.get('/auth/me');

// Donations
export const createDonation = (data) => API.post('/donations', data);
export const getMyDonations = () => API.get('/donations/my');
export const searchDonations = (params) => API.get('/donations/search', { params });
export const claimDonation = (id) => API.patch(`/donations/${id}/claim`);
export const getStats = () => API.get('/donations/stats');

// Missions / Logistics
export const getAvailableMissions = () => API.get('/donations/missions/available');
export const acceptMission = (id) => API.patch(`/donations/missions/${id}/accept`);
export const updateMissionStatus = (id, status) => API.patch(`/donations/missions/${id}/status`, { status });
export const getDeliveryHistory = () => API.get('/donations/missions/history');
export const getActiveMission = () => API.get('/donations/missions/active');

// AI
export const parseQuery = (query) => API.post('/ai/parse', { query });
export const geocodeHint = (q) => API.get('/ai/geocode', { params: { q } });

// Environment (Flood / Roadblock)
export const getEnvironmentLayers = () => API.get('/environment');
export const createEnvironmentLayer = (data) => API.post('/environment', data);
export const updateEnvironmentLayer = (id, data) => API.put(`/environment/${id}`, data);
export const deactivateEnvironmentLayer = (id) => API.patch(`/environment/${id}/deactivate`);

export default API;
