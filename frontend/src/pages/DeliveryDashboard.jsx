import { useState, useEffect, useCallback, useRef } from 'react';
import { getAvailableMissions, acceptMission, updateMissionStatus, getDeliveryHistory, getActiveMission, getEnvironmentLayers } from '../api/index';
import { useAuth } from '../context/AuthContext';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { io } from 'socket.io-client';
import NavigationMap from '../components/NavigationMap';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const makeIcon = (color) => new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

const blueIcon = makeIcon('blue');
const redIcon = makeIcon('red');
const greenIcon = makeIcon('green');
const orangeIcon = makeIcon('orange');

const SOCKET_URL = 'http://localhost:5000';

// Severity colors for flood overlays
const severityColor = (s) => {
    const c = ['', '#3b82f6', '#60a5fa', '#f59e0b', '#f97316', '#ef4444'];
    return c[s] || '#3b82f6';
};

// Renders environment layers (flood polygons + roadblock polylines) imperatively
const EnvLayerRenderer = ({ layers }) => {
    const map = useMap();
    const groupRef = useRef(null);
    useEffect(() => {
        if (!groupRef.current) {
            groupRef.current = L.featureGroup().addTo(map);
        }
        groupRef.current.clearLayers();
        layers.forEach(lyr => {
            if (lyr.type === 'flood' && lyr.geometry?.type === 'Polygon') {
                const color = severityColor(lyr.severity);
                L.polygon(
                    lyr.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]),
                    { color, fillColor: color, fillOpacity: 0.2, weight: 2 }
                ).bindPopup(`<strong>🌊 Flood Zone</strong><br/>Severity: ${lyr.severity}/5${lyr.label ? '<br/>' + lyr.label : ''}`)
                    .addTo(groupRef.current);
            } else if (lyr.type === 'roadblock' && lyr.geometry?.type === 'LineString') {
                L.polyline(
                    lyr.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
                    { color: '#ef4444', weight: 4, dashArray: '8,6' }
                ).bindPopup(`<strong>🚧 Road Block</strong>${lyr.label ? '<br/>' + lyr.label : ''}`)
                    .addTo(groupRef.current);
            }
        });
    }, [layers, map]);
    return null;
};

// Component to imperatively pan the map
const MapController = ({ center }) => {
    const map = useMap();
    useEffect(() => {
        if (center) map.flyTo(center, 14, { duration: 1 });
    }, [center, map]);
    return null;
};

// Haversine distance in km
const haversine = (lat1, lng1, lat2, lng2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const normalize = (val, min, max) => max === min ? 0 : (val - min) / (max - min);

// Compute priority score for each mission (lower = higher priority)
const computePriorityScores = (missions, baseLat, baseLng) => {
    const now = Date.now();

    const enriched = missions.map(m => {
        // Pickup location from donation's pickupLocation field
        const donorLng = m.pickupLocation?.coordinates?.[0] ?? null;
        const donorLat = m.pickupLocation?.coordinates?.[1] ?? null;
        // NGO drop location from claimedBy.location
        const ngoLng = m.claimedBy?.location?.coordinates?.[0] ?? null;
        const ngoLat = m.claimedBy?.location?.coordinates?.[1] ?? null;

        let impactPerKm = 999;
        if (baseLat && baseLng && donorLat && ngoLat) {
            const d1 = haversine(baseLat, baseLng, donorLat, donorLng);
            const d2 = haversine(donorLat, donorLng, ngoLat, ngoLng);
            const total = d1 + d2;
            impactPerKm = total > 0 ? total / m.servings : 0;
        }

        const hoursRemaining = m.expiryTime
            ? Math.max(0, (new Date(m.expiryTime) - now) / 3600000)
            : 48; // treat as 48h if unknown

        const ngoWaitHours = m.claimedAt
            ? (now - new Date(m.claimedAt)) / 3600000
            : 0;

        return { ...m, _calc: { impactPerKm, hoursRemaining, ngoWaitHours } };
    });

    if (enriched.length === 0) return [];

    // Min-Max normalize each dimension
    const impactVals = enriched.map(m => m._calc.impactPerKm);
    const perishVals = enriched.map(m => m._calc.hoursRemaining);
    const waitVals = enriched.map(m => m._calc.ngoWaitHours);

    const minMax = (arr) => ({ min: Math.min(...arr), max: Math.max(...arr) });
    const impactMM = minMax(impactVals);
    const perishMM = minMax(perishVals);
    const waitMM = minMax(waitVals);

    return enriched.map(m => {
        const { impactPerKm, hoursRemaining, ngoWaitHours } = m._calc;
        // higher impactPerKm = worse → normalize as-is (higher normalized = worse)
        const nImpact = normalize(impactPerKm, impactMM.min, impactMM.max);
        // lower hoursRemaining = more urgent → invert (1 - normalized)
        const nPerish = 1 - normalize(hoursRemaining, perishMM.min, perishMM.max);
        // higher wait = more urgent → invert (1 - normalized)
        const nWait = 1 - normalize(ngoWaitHours, waitMM.min, waitMM.max);

        // NGO waiting time: 50%, perishability: 30%, impact/km: 20%
        const score = 0.5 * nWait + 0.3 * nPerish + 0.2 * nImpact;
        return { ...m, _score: score, _priorityRank: 0 };
    }).sort((a, b) => b._score - a._score) // higher score = higher priority
        .map((m, i) => ({ ...m, _priorityRank: i + 1 }));
};

const getExpiryLabel = (expiryTime) => {
    if (!expiryTime) return null;
    const diffMs = new Date(expiryTime) - Date.now();
    if (diffMs <= 0) return { label: 'Expired!', color: '#ef4444' };
    const totalHours = Math.floor(diffMs / 3600000);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const label = days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
    const color = totalHours <= 3 ? '#ef4444' : totalHours <= 12 ? '#f97316' : '#22c55e';
    return { label, color };
};

const getPriorityColor = (rank, total) => {
    if (total <= 1) return '#22c55e';
    const pct = rank / total;
    if (pct <= 0.33) return '#ef4444';
    if (pct <= 0.66) return '#f97316';
    return '#22c55e';
};

const DeliveryDashboard = () => {
    const { user } = useAuth();
    const [tab, setTab] = useState('available');
    const [missions, setMissions] = useState([]);      // priority-sorted
    const [activeMission, setActiveMission] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [toast, setToast] = useState(null);
    const [selectedMission, setSelectedMission] = useState(null);
    const [mapCenter, setMapCenter] = useState(null);
    const [envLayers, setEnvLayers] = useState([]);
    const socketRef = useRef(null);
    const gpsWatchRef = useRef(null);

    // agentPos: starts with base location (never null), upgraded to live GPS when available
    const baseLoc = user?.location?.coordinates;
    const [agentPos, setAgentPos] = useState(
        baseLoc?.[0] ? [baseLoc[1], baseLoc[0]] : [13.0827, 80.2707]
    );

    // Delivery base from user context
    const baseLat = user?.location?.coordinates?.[1] ?? null;
    const baseLng = user?.location?.coordinates?.[0] ?? null;

    const showToast = (msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    };

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [availRes, historyRes] = await Promise.all([
                getAvailableMissions(),
                getDeliveryHistory(),
            ]);

            const ranked = computePriorityScores(availRes.data, baseLat, baseLng);
            setMissions(ranked);
            setHistory(historyRes.data);

            const activeRes = await getActiveMission();
            if (activeRes.data) {
                setActiveMission(activeRes.data);
                setTab('active');
            }
        } catch (err) {
            console.error('Error fetching dashboard data:', err);
        } finally {
            setLoading(false);
        }
    }, [baseLat, baseLng]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Environment layers + socket
    const fetchEnvLayers = useCallback(async () => {
        try {
            const res = await getEnvironmentLayers();
            setEnvLayers(res.data);
        } catch { }
    }, []);

    useEffect(() => {
        fetchEnvLayers();
        socketRef.current = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
        socketRef.current.on('environment', fetchEnvLayers);
        return () => socketRef.current?.disconnect();
    }, [fetchEnvLayers]);

    // Live GPS tracking — watch position, keep agentPos updated
    useEffect(() => {
        if (!navigator.geolocation) return;
        gpsWatchRef.current = navigator.geolocation.watchPosition(
            (pos) => setAgentPos([pos.coords.latitude, pos.coords.longitude]),
            () => {
                // GPS unavailable — fall back to delivery base location
                if (baseLat) setAgentPos([baseLat, baseLng]);
            },
            { enableHighAccuracy: true, maximumAge: 5000 }
        );
        return () => {
            if (gpsWatchRef.current != null) navigator.geolocation.clearWatch(gpsWatchRef.current);
        };
    }, [baseLat, baseLng]);

    // Default map center: delivery base or Chennai
    const defaultCenter = baseLat ? [baseLat, baseLng] : [13.0827, 80.2707];

    const handleSelectMission = (m) => {
        setSelectedMission(m._id);
        const lat = m.pickupLocation?.coordinates?.[1];
        const lng = m.pickupLocation?.coordinates?.[0];
        if (lat && lng) setMapCenter([lat, lng]);
    };

    const handleAccept = async (id) => {
        try {
            const res = await acceptMission(id);
            // Attach vehicle type from logged-in user to the mission object
            const enriched = { ...res.data, vehicleType: user?.vehicleType || 'car' };
            setActiveMission(enriched);
            localStorage.setItem('cg_active_mission_id', enriched._id);
            setMissions(prev => prev.filter(m => m._id !== id));
            setTab('active');
            showToast('🚚 Mission accepted! Navigation mode active.');
        } catch (err) {
            showToast(err.response?.data?.message || 'Failed to accept mission', 'error');
        }
    };

    const handleStatusUpdate = async (status) => {
        if (!activeMission) return;
        try {
            const res = await updateMissionStatus(activeMission._id, status);
            setActiveMission(status === 'delivered' ? null : { ...res.data, vehicleType: user?.vehicleType || 'car' });
            if (status === 'delivered') {
                localStorage.removeItem('cg_active_mission_id');
                setTab('history');
                fetchData();
                showToast('✅ Mission completed! Great job.');
            } else {
                showToast(`📦 Status updated: ${status.replace('_', ' ')}`);
            }
        } catch (err) {
            showToast('Failed to update status', 'error');
        }
    };

    const vehicleEmoji = user?.vehicleType === 'bike' ? '🏍️' : user?.vehicleType === 'car' ? '🚗' : user?.vehicleType === 'truck' ? '🚛' : '🚐';

    return (
        <div className="page-wrapper">
            <div className="dashboard">
                <div className="dashboard-header">
                    <div>
                        <h1 className="dashboard-title">🚴 Logistics Portal</h1>
                        <p className="dashboard-subtitle">Active Support for {user?.name}</p>
                    </div>
                    <div className="vehicle-badge">
                        {vehicleEmoji}
                        <span>{user?.vehicleType?.toUpperCase()} ({user?.vehicleCapacity} servings)</span>
                    </div>
                </div>

                <div className="auth-tabs" style={{ marginBottom: '24px' }}>
                    <button className={`auth-tab ${tab === 'available' ? 'active' : ''}`} onClick={() => setTab('available')}>
                        Missions ({missions.length})
                    </button>
                    <button className={`auth-tab ${tab === 'active' ? 'active' : ''}`} onClick={() => setTab('active')}>
                        Active {activeMission ? '🔴' : ''}
                    </button>
                    <button className={`auth-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
                        History
                    </button>
                </div>

                {loading ? (
                    <div className="spinner-wrap"><div className="spinner" /></div>
                ) : (
                    <div>
                        {/* ─── AVAILABLE MISSIONS: split list + map ─── */}
                        {tab === 'available' && (
                            <div className="delivery-split-layout fade-in">
                                {/* LEFT — Priority List */}
                                <div className="delivery-list-panel">
                                    {missions.length === 0 ? (
                                        <div className="empty-state">
                                            <div className="empty-state-icon">🏁</div>
                                            <div className="empty-state-title">No missions available</div>
                                            <p>Check back later for new delivery requests.</p>
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ marginBottom: '12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                                ⚡ Sorted by priority — NGO wait time (50%) · Perishability (30%) · Impact/km (20%)
                                            </div>
                                            {missions.map(m => {
                                                const exp = getExpiryLabel(m.expiryTime);
                                                const rankColor = getPriorityColor(m._priorityRank, missions.length);
                                                const isSelected = selectedMission === m._id;
                                                const donorLat = m.pickupLocation?.coordinates?.[1];
                                                const donorLng = m.pickupLocation?.coordinates?.[0];
                                                const ngoLat = m.claimedBy?.location?.coordinates?.[1];
                                                const ngoLng = m.claimedBy?.location?.coordinates?.[0];
                                                let distInfo = null;
                                                if (baseLat && donorLat && ngoLat) {
                                                    const d1 = haversine(baseLat, baseLng, donorLat, donorLng).toFixed(1);
                                                    const d2 = haversine(donorLat, donorLng, ngoLat, ngoLng).toFixed(1);
                                                    distInfo = `${d1}km base→pickup + ${d2}km pickup→NGO`;
                                                }
                                                return (
                                                    <div
                                                        key={m._id}
                                                        className={`mission-list-card ${isSelected ? 'mission-selected' : ''}`}
                                                        onClick={() => handleSelectMission(m)}
                                                    >
                                                        <div className="mission-rank-badge" style={{ background: rankColor }}>
                                                            #{m._priorityRank}
                                                        </div>
                                                        <div className="mission-card-body">
                                                            <div className="mission-card-header">
                                                                <strong>{m.foodName}</strong>
                                                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                                    <span className={`badge ${m.foodType === 'veg' ? 'badge-veg' : 'badge-nonveg'}`}>
                                                                        {m.foodType === 'veg' ? '🥗' : '🍗'} {m.foodType}
                                                                    </span>
                                                                    {exp && (
                                                                        <span className="badge" style={{ background: exp.color + '22', color: exp.color, border: `1px solid ${exp.color}` }}>
                                                                            ⏰ {exp.label}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="mission-card-details">
                                                                <span>👥 {m.servings} servings</span>
                                                                <span>🚩 {m.address?.slice(0, 35)}{m.address?.length > 35 ? '…' : ''}</span>
                                                                <span>🏁 {m.claimedBy?.organizationName || 'NGO'}</span>
                                                                {distInfo && <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>📏 {distInfo}</span>}
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                                                                <button
                                                                    className="btn btn-primary btn-sm"
                                                                    onClick={(e) => { e.stopPropagation(); handleAccept(m._id); }}
                                                                >
                                                                    Accept Mission
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </>
                                    )}
                                </div>

                                {/* RIGHT — Map Panel */}
                                <div className="delivery-map-panel">
                                    <MapContainer
                                        center={defaultCenter}
                                        zoom={11}
                                        style={{ height: '100%', width: '100%' }}
                                    >
                                        <TileLayer
                                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        />
                                        {mapCenter && <MapController center={mapCenter} />}

                                        {/* Delivery Base */}
                                        {baseLat && (
                                            <Marker position={[baseLat, baseLng]} icon={blueIcon}>
                                                <Popup><strong>🔵 Your Base Location</strong><br />{user?.name}</Popup>
                                            </Marker>
                                        )}

                                        {/* Environment layers (flood + roadblock overlays) */}
                                        <EnvLayerRenderer layers={envLayers} />

                                        {/* Donor pickup pins */}
                                        {missions.map(m => {
                                            const lat = m.pickupLocation?.coordinates?.[1];
                                            const lng = m.pickupLocation?.coordinates?.[0];
                                            if (!lat) return null;
                                            return (
                                                <Marker key={`pickup-${m._id}`} position={[lat, lng]} icon={redIcon}>
                                                    <Popup>
                                                        <strong>🔴 Pickup #{m._priorityRank}: {m.foodName}</strong><br />
                                                        👥 {m.servings} servings<br />
                                                        📍 {m.address}<br />
                                                        👤 Donor: {m.donorId?.name}
                                                    </Popup>
                                                </Marker>
                                            );
                                        })}

                                        {/* NGO drop pins */}
                                        {missions.map(m => {
                                            const lat = m.claimedBy?.location?.coordinates?.[1];
                                            const lng = m.claimedBy?.location?.coordinates?.[0];
                                            if (!lat) return null;
                                            return (
                                                <Marker key={`ngo-${m._id}`} position={[lat, lng]} icon={greenIcon}>
                                                    <Popup>
                                                        <strong>🟢 Drop: {m.claimedBy?.organizationName}</strong><br />
                                                        📦 For: {m.foodName}
                                                    </Popup>
                                                </Marker>
                                            );
                                        })}
                                    </MapContainer>
                                    <div className="map-legend">
                                        <span><span className="legend-dot" style={{ background: '#2563eb' }}></span>Your Base</span>
                                        <span><span className="legend-dot" style={{ background: '#dc2626' }}></span>Pickup</span>
                                        <span><span className="legend-dot" style={{ background: '#16a34a' }}></span>NGO Drop</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ─── ACTIVE MISSION ─── */}
                        {tab === 'active' && (
                            <div className="fade-in">
                                {!activeMission ? (
                                    <div className="empty-state">
                                        <div className="empty-state-icon">📍</div>
                                        <div className="empty-state-title">No active mission</div>
                                        <p>Accept a mission from the "Missions" tab to start.</p>
                                    </div>
                                ) : (
                                    <div className="active-mission-grid">
                                        <div className="card card-body">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                                                <h3 style={{ fontWeight: 800 }}>📦 Active Mission</h3>
                                                <span className="badge badge-claimed">{activeMission.deliveryStatus.replace(/_/g, ' ').toUpperCase()}</span>
                                            </div>

                                            {/* Expiry warning */}
                                            {activeMission.expiryTime && (() => {
                                                const exp = getExpiryLabel(activeMission.expiryTime);
                                                return exp ? (
                                                    <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '16px', background: exp.color + '18', color: exp.color, fontWeight: 600, fontSize: '0.88rem' }}>
                                                        ⏰ {exp.label}
                                                    </div>
                                                ) : null;
                                            })()}

                                            <div className="mission-steps">
                                                <div className={`mission-step ${['accepted_by_delivery', 'picked_up', 'delivered'].includes(activeMission.deliveryStatus) ? 'done' : ''}`}>
                                                    <div className="step-point">1</div>
                                                    <div className="step-info">
                                                        <strong>Pickup from Donor</strong>
                                                        <p>{activeMission.donorId?.name} • {activeMission.address}</p>
                                                        <p style={{ color: 'var(--orange)', fontWeight: 600 }}>📞 {activeMission.donorId?.phone}</p>
                                                    </div>
                                                </div>
                                                <div className={`mission-step ${['picked_up', 'delivered'].includes(activeMission.deliveryStatus) ? 'done' : ''}`}>
                                                    <div className="step-point">2</div>
                                                    <div className="step-info">
                                                        <strong>Drop at NGO</strong>
                                                        <p>{activeMission.claimedBy?.organizationName} • {activeMission.claimedBy?.address || 'NGO Office'}</p>
                                                        <p style={{ color: 'var(--blue)', fontWeight: 600 }}>📞 {activeMission.claimedBy?.phone}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="mission-actions" style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                                                {activeMission.deliveryStatus === 'accepted_by_delivery' && (
                                                    <button className="btn btn-primary btn-full" onClick={() => handleStatusUpdate('picked_up')}>
                                                        Mark as Picked Up
                                                    </button>
                                                )}
                                                {activeMission.deliveryStatus === 'picked_up' && (
                                                    <button className="btn btn-primary btn-full" style={{ background: 'var(--green)' }} onClick={() => handleStatusUpdate('delivered')}>
                                                        Mark as Delivered
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        <div className="card" style={{ height: '480px', overflow: 'hidden', borderRadius: '20px', position: 'relative' }}>
                                            <NavigationMap
                                                mission={activeMission}
                                                envLayers={envLayers}
                                                agentPos={agentPos}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ─── HISTORY ─── */}
                        {tab === 'history' && (
                            <div className="fade-in">
                                {history.length === 0 ? (
                                    <div className="empty-state">
                                        <div className="empty-state-icon">📋</div>
                                        <div className="empty-state-title">No history found</div>
                                        <p>Your completed deliveries will appear here.</p>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {history.map(h => (
                                            <div key={h._id} className="history-card">
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <strong>{h.foodName}</strong>
                                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                            {new Date(h.updatedAt).toLocaleDateString()} • {h.servings} servings
                                                        </p>
                                                    </div>
                                                    <span className="badge badge-veg">✅ DELIVERED</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {toast && <div className={`toast toast-${toast.type} fade-in`}>{toast.msg}</div>}

            <style>{`
                /* ── Split layout ── */
                .delivery-split-layout {
                    display: grid;
                    grid-template-columns: 420px 1fr;
                    gap: 20px;
                    min-height: 600px;
                }
                @media (max-width: 1024px) {
                    .delivery-split-layout { grid-template-columns: 1fr; }
                }
                .delivery-list-panel {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    max-height: 680px;
                    overflow-y: auto;
                    padding-right: 4px;
                }
                .delivery-map-panel {
                    position: relative;
                    border-radius: 20px;
                    overflow: hidden;
                    min-height: 500px;
                    border: 1px solid var(--border-color);
                }

                /* ── Mission list card ── */
                .mission-list-card {
                    display: flex;
                    gap: 12px;
                    background: var(--card-bg);
                    border: 1px solid var(--border-color);
                    border-radius: 16px;
                    padding: 14px;
                    cursor: pointer;
                    transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
                    position: relative;
                }
                .mission-list-card:hover {
                    border-color: var(--orange);
                    box-shadow: 0 4px 18px rgba(0,0,0,0.15);
                    transform: translateY(-2px);
                }
                .mission-selected {
                    border-color: var(--orange) !important;
                    box-shadow: 0 0 0 2px var(--orange) !important;
                }
                .mission-rank-badge {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.72rem;
                    font-weight: 800;
                    color: white;
                    flex-shrink: 0;
                    margin-top: 2px;
                }
                .mission-card-body { flex: 1; min-width: 0; }
                .mission-card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    gap: 8px;
                    margin-bottom: 8px;
                    flex-wrap: wrap;
                }
                .mission-card-details {
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                    font-size: 0.83rem;
                    color: var(--text-secondary);
                }

                /* ── Map legend ── */
                .map-legend {
                    position: absolute;
                    bottom: 12px;
                    left: 12px;
                    z-index: 1000;
                    background: rgba(15, 20, 30, 0.85);
                    backdrop-filter: blur(8px);
                    border-radius: 10px;
                    padding: 8px 12px;
                    display: flex;
                    gap: 14px;
                    font-size: 0.78rem;
                    font-weight: 600;
                    color: white;
                    border: 1px solid rgba(255,255,255,0.1);
                }
                .legend-dot {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    margin-right: 4px;
                    vertical-align: middle;
                }

                /* ── Shared from original ── */
                .vehicle-badge {
                    background: var(--card-bg);
                    padding: 8px 16px;
                    border-radius: 99px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 0.9rem;
                    font-weight: 700;
                    border: 1px solid var(--border-color);
                    box-shadow: var(--shadow-sm);
                }
                .active-mission-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 24px;
                }
                @media (max-width: 900px) {
                    .active-mission-grid { grid-template-columns: 1fr; }
                }
                .mission-steps {
                    display: flex;
                    flex-direction: column;
                    gap: 32px;
                    position: relative;
                    padding-left: 20px;
                }
                .mission-steps::before {
                    content: '';
                    position: absolute;
                    left: 29px;
                    top: 10px;
                    bottom: 10px;
                    width: 2px;
                    background: var(--border-color);
                }
                .mission-step {
                    display: flex;
                    gap: 24px;
                    position: relative;
                }
                .step-point {
                    width: 20px;
                    height: 20px;
                    background: var(--card-bg);
                    border: 2px solid var(--border-color);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.7rem;
                    font-weight: 800;
                    flex-shrink: 0;
                }
                .mission-step.done .step-point {
                    border-color: var(--orange);
                    background: var(--orange);
                    color: white;
                }
                .step-info p {
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                    margin: 4px 0;
                }
                .history-card {
                    background: var(--card-bg);
                    padding: 16px 20px;
                    border-radius: 16px;
                    border: 1px solid var(--border-color);
                }
                .btn-sm {
                    padding: 6px 14px;
                    font-size: 0.8rem;
                }
            `}</style>
        </div>
    );
};

export default DeliveryDashboard;
