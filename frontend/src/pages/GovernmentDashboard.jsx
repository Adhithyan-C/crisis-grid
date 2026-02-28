import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import {
    getEnvironmentLayers,
    createEnvironmentLayer,
    updateEnvironmentLayer,
    deactivateEnvironmentLayer,
} from '../api/index';

// Fix Leaflet default icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const SOCKET_URL = 'http://localhost:5000';

// Severity colors for flood
const severityColor = (s) => {
    const colors = ['', '#3b82f6', '#60a5fa', '#f59e0b', '#f97316', '#ef4444'];
    return colors[s] || '#3b82f6';
};

// Component that manages the Leaflet Draw controls and layer rendering
const DrawController = ({ onLayerCreated, onLayerEdited, onLayerDeleted, layers, pendingDraw, setPendingDraw }) => {
    const map = useMap();
    const drawnItemsRef = useRef(null);
    const drawHandlerRef = useRef(null);

    // Initialize drawn items layer group
    useEffect(() => {
        if (!drawnItemsRef.current) {
            drawnItemsRef.current = new L.FeatureGroup();
            map.addLayer(drawnItemsRef.current);

            // Edit/Delete toolbar
            const drawControl = new L.Control.Draw({
                edit: {
                    featureGroup: drawnItemsRef.current,
                    poly: { allowIntersection: false },
                },
                draw: false, // We control drawing via buttons
            });
            map.addControl(drawControl);

            // Handle edit
            map.on(L.Draw.Event.EDITED, (e) => {
                e.layers.eachLayer((layer) => {
                    const id = layer.options._envId;
                    if (id) onLayerEdited(id, layer);
                });
            });

            // Handle delete
            map.on(L.Draw.Event.DELETED, (e) => {
                e.layers.eachLayer((layer) => {
                    const id = layer.options._envId;
                    if (id) onLayerDeleted(id);
                });
            });
        }
    }, [map, onLayerEdited, onLayerDeleted]);

    // Render environment layers on the map
    useEffect(() => {
        if (!drawnItemsRef.current) return;
        drawnItemsRef.current.clearLayers();

        layers.forEach((lyr) => {
            let leafletLayer;
            if (lyr.type === 'flood' && lyr.geometry.type === 'Polygon') {
                const color = severityColor(lyr.severity);
                leafletLayer = L.polygon(
                    lyr.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]),
                    {
                        color,
                        fillColor: color,
                        fillOpacity: 0.25,
                        weight: 2,
                        _envId: lyr._id,
                    }
                );
                leafletLayer.bindPopup(`<strong>🌊 Flood Zone</strong><br/>Severity: ${lyr.severity}/5<br/>${lyr.label || ''}`);
            } else if (lyr.type === 'roadblock' && lyr.geometry.type === 'LineString') {
                leafletLayer = L.polyline(
                    lyr.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
                    {
                        color: '#ef4444',
                        weight: 4,
                        dashArray: '8,6',
                        _envId: lyr._id,
                    }
                );
                leafletLayer.bindPopup(`<strong>🚧 Road Block</strong><br/>${lyr.label || ''}`);
            }
            if (leafletLayer) drawnItemsRef.current.addLayer(leafletLayer);
        });
    }, [layers]);

    // Activate draw tool when pendingDraw changes
    useEffect(() => {
        if (!pendingDraw) return;

        // Stop previous handler
        if (drawHandlerRef.current) {
            drawHandlerRef.current.disable();
            drawHandlerRef.current = null;
        }

        let handler;
        if (pendingDraw === 'flood') {
            handler = new L.Draw.Polygon(map, {
                shapeOptions: { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.25, weight: 2 },
            });
        } else if (pendingDraw === 'roadblock') {
            handler = new L.Draw.Polyline(map, {
                shapeOptions: { color: '#ef4444', weight: 4, dashArray: '8,6' },
            });
        }

        if (handler) {
            handler.enable();
            drawHandlerRef.current = handler;

            const onCreated = (e) => {
                map.off(L.Draw.Event.CREATED, onCreated);
                onLayerCreated(pendingDraw, e.layer);
                setPendingDraw(null);
                drawHandlerRef.current = null;
            };
            map.on(L.Draw.Event.CREATED, onCreated);
        }
    }, [pendingDraw, map, onLayerCreated, setPendingDraw]);

    return null;
};

const GovernmentDashboard = () => {
    const { user, logout } = useAuth();
    const [layers, setLayers] = useState([]);
    const [pendingDraw, setPendingDraw] = useState(null); // 'flood' | 'roadblock' | null
    const [severityModal, setSeverityModal] = useState(null); // { layer, severity }
    const [toast, setToast] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const socketRef = useRef(null);

    const showToast = (msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    };

    const fetchLayers = useCallback(async () => {
        try {
            const res = await getEnvironmentLayers();
            setLayers(res.data);
        } catch (err) {
            console.error('Failed to fetch layers', err);
        }
    }, []);

    useEffect(() => {
        fetchLayers();

        // Socket.IO — live updates
        socketRef.current = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
        socketRef.current.on('environment', () => fetchLayers());

        return () => socketRef.current?.disconnect();
    }, [fetchLayers]);

    // Called when Leaflet Draw finishes drawing
    const handleLayerCreated = useCallback((type, leafletLayer) => {
        if (type === 'flood') {
            // Show severity modal before saving
            setSeverityModal({ leafletLayer, type, severity: 3 });
        } else {
            // Roadblock — save immediately
            saveLayer(type, leafletLayer, null);
        }
    }, []);

    const saveLayer = async (type, leafletLayer, severity, label = '') => {
        try {
            let geometry;
            if (type === 'flood') {
                const latlngs = leafletLayer.getLatLngs()[0];
                const coords = latlngs.map(ll => [ll.lng, ll.lat]);
                coords.push(coords[0]); // close ring
                geometry = { type: 'Polygon', coordinates: [coords] };
            } else {
                const latlngs = leafletLayer.getLatLngs();
                geometry = { type: 'LineString', coordinates: latlngs.map(ll => [ll.lng, ll.lat]) };
            }
            await createEnvironmentLayer({ type, geometry, severity, label });
            showToast(type === 'flood' ? '🌊 Flood zone marked!' : '🚧 Roadblock marked!');
            await fetchLayers();
        } catch (err) {
            showToast('Failed to save layer', 'error');
        }
    };

    const handleLayerEdited = useCallback(async (id, leafletLayer) => {
        try {
            let geometry;
            const lyr = layers.find(l => l._id === id);
            if (!lyr) return;
            if (lyr.type === 'flood') {
                const coords = leafletLayer.getLatLngs()[0].map(ll => [ll.lng, ll.lat]);
                coords.push(coords[0]);
                geometry = { type: 'Polygon', coordinates: [coords] };
            } else {
                geometry = { type: 'LineString', coordinates: leafletLayer.getLatLngs().map(ll => [ll.lng, ll.lat]) };
            }
            await updateEnvironmentLayer(id, { geometry });
            showToast('✏️ Layer updated!');
            await fetchLayers();
        } catch (err) {
            showToast('Failed to update layer', 'error');
        }
    }, [layers, fetchLayers]);

    const handleLayerDeleted = useCallback(async (id) => {
        try {
            await deactivateEnvironmentLayer(id);
            showToast('🗑️ Layer removed!');
            await fetchLayers();
        } catch (err) {
            showToast('Failed to delete layer', 'error');
        }
    }, [fetchLayers]);

    const handleSeverityConfirm = () => {
        if (!severityModal) return;
        saveLayer(severityModal.type, severityModal.leafletLayer, severityModal.severity, severityModal.label || '');
        setSeverityModal(null);
    };

    const floodLayers = layers.filter(l => l.type === 'flood');
    const roadblockLayers = layers.filter(l => l.type === 'roadblock');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#0f141e' }}>
            {/* Top Bar */}
            <div style={{
                height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 20px', background: 'rgba(15,20,30,0.95)', borderBottom: '1px solid rgba(255,255,255,0.08)',
                zIndex: 1000, flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '1.4rem' }}>🏛️</span>
                    <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#fff' }}>CrisisGrid</span>
                    <span style={{ fontSize: '0.75rem', padding: '3px 10px', background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: '99px', border: '1px solid rgba(239,68,68,0.3)', fontWeight: 700 }}>
                        GOVERNMENT CONTROL
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* Draw controls */}
                    <button
                        onClick={() => setPendingDraw(pendingDraw === 'flood' ? null : 'flood')}
                        style={{
                            padding: '7px 14px', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', border: 'none',
                            background: pendingDraw === 'flood' ? '#3b82f6' : 'rgba(59,130,246,0.15)',
                            color: pendingDraw === 'flood' ? '#fff' : '#60a5fa',
                            transition: 'all 0.2s',
                        }}
                    >
                        🌊 {pendingDraw === 'flood' ? 'Drawing… (click map)' : 'Mark Flood Area'}
                    </button>
                    <button
                        onClick={() => setPendingDraw(pendingDraw === 'roadblock' ? null : 'roadblock')}
                        style={{
                            padding: '7px 14px', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', border: 'none',
                            background: pendingDraw === 'roadblock' ? '#ef4444' : 'rgba(239,68,68,0.15)',
                            color: pendingDraw === 'roadblock' ? '#fff' : '#f87171',
                            transition: 'all 0.2s',
                        }}
                    >
                        🚧 {pendingDraw === 'roadblock' ? 'Drawing… (click map)' : 'Mark Road Block'}
                    </button>
                    <button
                        onClick={() => setSidebarOpen(s => !s)}
                        style={{ padding: '7px 14px', borderRadius: '8px', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#ccc' }}
                    >
                        📋 Alerts {sidebarOpen ? '›' : '‹'}
                    </button>
                    <span style={{ color: '#aaa', fontSize: '0.82rem' }}>{user?.name}</span>
                    <button
                        onClick={logout}
                        style={{ padding: '6px 12px', borderRadius: '8px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#ccc' }}
                    >
                        Sign Out
                    </button>
                </div>
            </div>

            {/* Instruction bar when drawing */}
            {pendingDraw && (
                <div style={{
                    height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: pendingDraw === 'flood' ? 'rgba(59,130,246,0.15)' : 'rgba(239,68,68,0.15)',
                    color: pendingDraw === 'flood' ? '#60a5fa' : '#f87171',
                    fontSize: '0.83rem', fontWeight: 600, gap: '10px', flexShrink: 0,
                    borderBottom: `1px solid ${pendingDraw === 'flood' ? 'rgba(59,130,246,0.3)' : 'rgba(239,68,68,0.3)'}`,
                }}>
                    {pendingDraw === 'flood'
                        ? '🌊 Click to draw flood polygon — double-click to finish. Press ESC to cancel.'
                        : '🚧 Click to draw road block line — double-click to finish. Press ESC to cancel.'}
                    <button onClick={() => setPendingDraw(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 700 }}>✕ Cancel</button>
                </div>
            )}

            {/* Main area */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Map */}
                <div style={{ flex: 1, position: 'relative' }}>
                    <MapContainer
                        center={[13.0827, 80.2707]}
                        zoom={12}
                        style={{ height: '100%', width: '100%' }}
                        zoomControl={true}
                    >
                        <TileLayer
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        />
                        <DrawController
                            onLayerCreated={handleLayerCreated}
                            onLayerEdited={handleLayerEdited}
                            onLayerDeleted={handleLayerDeleted}
                            layers={layers}
                            pendingDraw={pendingDraw}
                            setPendingDraw={setPendingDraw}
                        />
                    </MapContainer>

                    {/* Map legend */}
                    <div style={{
                        position: 'absolute', bottom: '24px', left: '16px', zIndex: 1000,
                        background: 'rgba(15,20,30,0.88)', backdropFilter: 'blur(8px)',
                        borderRadius: '12px', padding: '10px 16px', border: '1px solid rgba(255,255,255,0.1)',
                        display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.78rem', color: '#ccc',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: 16, height: 10, background: '#3b82f6', display: 'inline-block', opacity: 0.7, borderRadius: 2 }}></span>
                            Flood Zone
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: 16, height: 3, background: '#ef4444', display: 'inline-block', borderRadius: 2 }}></span>
                            Road Block
                        </div>
                        <div style={{ marginTop: '4px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.72rem', color: '#777' }}>
                            Use Edit/Delete toolbar on map to modify
                        </div>
                    </div>
                </div>

                {/* Sidebar */}
                {sidebarOpen && (
                    <div style={{
                        width: '300px', background: 'rgba(15,20,30,0.97)', borderLeft: '1px solid rgba(255,255,255,0.08)',
                        display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            <h3 style={{ color: '#fff', fontWeight: 800, fontSize: '0.95rem', margin: 0 }}>Active Alerts</h3>
                            <p style={{ color: '#666', fontSize: '0.75rem', marginTop: '4px' }}>{layers.length} active layer{layers.length !== 1 ? 's' : ''}</p>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                            {/* Flood zones */}
                            {floodLayers.length > 0 && (
                                <div style={{ marginBottom: '16px' }}>
                                    <div style={{ color: '#60a5fa', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>
                                        🌊 Flood Zones ({floodLayers.length})
                                    </div>
                                    {floodLayers.map(l => (
                                        <div key={l._id} style={{
                                            background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
                                            borderRadius: '10px', padding: '10px 12px', marginBottom: '6px',
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>
                                                    {l.label || 'Flood Zone'}
                                                </span>
                                                <span style={{
                                                    fontSize: '0.7rem', padding: '2px 8px', borderRadius: '99px',
                                                    background: severityColor(l.severity) + '33',
                                                    color: severityColor(l.severity),
                                                    border: `1px solid ${severityColor(l.severity)}55`,
                                                    fontWeight: 700,
                                                }}>SEV {l.severity}</span>
                                            </div>
                                            <div style={{ color: '#666', fontSize: '0.72rem', marginTop: '4px' }}>
                                                By {l.createdBy?.name} • {new Date(l.createdAt).toLocaleDateString()}
                                            </div>
                                            <button
                                                onClick={() => handleLayerDeleted(l._id)}
                                                style={{ marginTop: '6px', background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', padding: '3px 10px', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}
                                            >
                                                Deactivate
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Road blocks */}
                            {roadblockLayers.length > 0 && (
                                <div>
                                    <div style={{ color: '#f87171', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>
                                        🚧 Road Blocks ({roadblockLayers.length})
                                    </div>
                                    {roadblockLayers.map(l => (
                                        <div key={l._id} style={{
                                            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
                                            borderRadius: '10px', padding: '10px 12px', marginBottom: '6px',
                                        }}>
                                            <span style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 600 }}>
                                                {l.label || 'Road Block'}
                                            </span>
                                            <div style={{ color: '#666', fontSize: '0.72rem', marginTop: '4px' }}>
                                                By {l.createdBy?.name} • {new Date(l.createdAt).toLocaleDateString()}
                                            </div>
                                            <button
                                                onClick={() => handleLayerDeleted(l._id)}
                                                style={{ marginTop: '6px', background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', padding: '3px 10px', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}
                                            >
                                                Deactivate
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {layers.length === 0 && (
                                <div style={{ textAlign: 'center', color: '#555', fontSize: '0.85rem', marginTop: '40px' }}>
                                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🗺️</div>
                                    No active alerts.<br />Use the buttons above to draw.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Severity Modal */}
            {severityModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: '#1a2235', borderRadius: '20px', padding: '32px', width: '360px',
                        border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                    }}>
                        <h3 style={{ color: '#fff', fontWeight: 800, marginBottom: '8px' }}>🌊 Set Flood Severity</h3>
                        <p style={{ color: '#888', fontSize: '0.85rem', marginBottom: '20px' }}>
                            Rate the severity of this flood zone (1 = minor, 5 = catastrophic)
                        </p>

                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                {[1, 2, 3, 4, 5].map(s => (
                                    <button
                                        key={s}
                                        onClick={() => setSeverityModal(m => ({ ...m, severity: s }))}
                                        style={{
                                            width: '48px', height: '48px', borderRadius: '12px', fontWeight: 800,
                                            fontSize: '1.1rem', cursor: 'pointer', border: 'none',
                                            background: severityModal.severity === s ? severityColor(s) : 'rgba(255,255,255,0.08)',
                                            color: severityModal.severity === s ? '#fff' : '#888',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                            <div style={{ textAlign: 'center', marginTop: '8px', color: severityColor(severityModal.severity), fontSize: '0.8rem', fontWeight: 600 }}>
                                {['', 'Minor flooding', 'Moderate flooding', 'Significant flooding', 'Severe flooding', 'Catastrophic'][severityModal.severity]}
                            </div>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ color: '#aaa', fontSize: '0.8rem', display: 'block', marginBottom: '6px' }}>Label (optional)</label>
                            <input
                                style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '10px 14px', color: '#fff', fontSize: '0.85rem', boxSizing: 'border-box' }}
                                placeholder="e.g. Near Adyar River"
                                value={severityModal.label || ''}
                                onChange={e => setSeverityModal(m => ({ ...m, label: e.target.value }))}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => setSeverityModal(null)}
                                style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#888', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSeverityConfirm}
                                style={{ flex: 2, padding: '12px', borderRadius: '12px', border: 'none', background: '#3b82f6', color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: '0.95rem' }}
                            >
                                Save Flood Zone
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div style={{
                    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
                    background: toast.type === 'error' ? '#ef4444' : '#22c55e',
                    color: '#fff', padding: '10px 24px', borderRadius: '99px', fontWeight: 700,
                    zIndex: 9999, boxShadow: '0 8px 30px rgba(0,0,0,0.3)', fontSize: '0.9rem',
                }}>
                    {toast.msg}
                </div>
            )}
        </div>
    );
};

export default GovernmentDashboard;
