/**
 * NavigationMap.jsx — Mission route visualization for delivery assistants
 *
 * Shows on the map after accepting a mission:
 *   📍 Green marker  = Delivery assistant (live GPS or base location)
 *   📍 Yellow marker = Food donor pickup
 *   📍 Blue marker   = NGO drop-off
 *   🟠 Orange polyline = Leg 1 (Delivery → Donor)
 *   🟢 Green polyline  = Leg 2 (Donor → NGO)
 *
 * Animated route "computed" effect: polyline draws progressively
 * Full cleanup on unmount — no duplicate layers
 * Recomputes on environment layer changes (Socket.IO)
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
    computeMissionRoute,
    calcBearing,
    lerpPoint,
    vehicleSpeedFactor,
    fmtDuration,
    fmtDistance,
} from '../utils/routing';

// ─── Marker factories ────────────────────────────────────────────────────────
const makeIcon = (color) => L.icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${color}.png`,
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});
const greenIcon = makeIcon('green');
const yellowIcon = makeIcon('gold');
const blueIcon = makeIcon('blue');

function createVehicleIcon(type, rotation = 0) {
    const emoji = type === 'bike' ? '🏍️' : type === 'truck' ? '🚛' : '🚗';
    return L.divIcon({
        className: '',
        html: `<div style="font-size:24px;transform:rotate(${rotation}deg);
            transform-origin:center;transition:transform 0.15s linear;
            filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">${emoji}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 15],
    });
}

// ─── Haversine (metres) ──────────────────────────────────────────────────────
function distM(lat1, lng1, lat2, lng2) {
    const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Animated polyline draw (progressive reveal) ─────────────────────────────
function animatePolyline(map, coords, options, durationMs, onDone) {
    const steps = 60;
    const interval = durationMs / steps;
    let step = 0;
    const polyline = L.polyline([], options).addTo(map);
    const timer = setInterval(() => {
        step++;
        const idx = Math.min(Math.floor((step / steps) * coords.length), coords.length);
        polyline.setLatLngs(coords.slice(0, idx));
        if (step >= steps) {
            clearInterval(timer);
            polyline.setLatLngs(coords);
            if (onDone) onDone();
        }
    }, interval);
    return { polyline, timer };
}

// ─── Constants ───────────────────────────────────────────────────────────────
const ANIM_INTERVAL = 50;
const SIG_MOVE_M = 30;

// ─── Inner map logic (needs useMap) ──────────────────────────────────────────
const NavMapInner = ({ mission, envLayers, agentPos, onRouteComputed }) => {
    const map = useMap();

    // All Leaflet objects tracked for cleanup
    const layerGroupRef = useRef(null);
    const animMarkRef = useRef(null);
    const animTimerRef = useRef(null);
    const leg1CoordsRef = useRef([]);
    const leg2CoordsRef = useRef([]);
    const leg1DurRef = useRef(0);
    const leg2DurRef = useRef(0);
    const animStateRef = useRef({ leg: 1, idx: 0, frac: 0 });
    const prevPosRef = useRef(agentPos);
    const computeIdRef = useRef(0);   // cancel stale computations
    const drawTimersRef = useRef([]);  // animated draw timers

    // ── Cleanup ALL map layers ──
    const clearAll = useCallback(() => {
        drawTimersRef.current.forEach(t => clearInterval(t));
        drawTimersRef.current = [];
        if (animTimerRef.current) clearInterval(animTimerRef.current);
        if (layerGroupRef.current) {
            layerGroupRef.current.clearLayers();
        }
        if (animMarkRef.current) {
            map.removeLayer(animMarkRef.current);
            animMarkRef.current = null;
        }
    }, [map]);

    // ── Init layer group ──
    useEffect(() => {
        layerGroupRef.current = L.layerGroup().addTo(map);
        return () => {
            clearAll();
            if (layerGroupRef.current) {
                map.removeLayer(layerGroupRef.current);
            }
        };
    }, [map, clearAll]);

    // ── Start marker animation ──
    const startMarkerAnim = useCallback((vehicleType) => {
        if (animTimerRef.current) clearInterval(animTimerRef.current);
        const speed = vehicleSpeedFactor(vehicleType);
        animStateRef.current = { leg: 1, idx: 0, frac: 0 };

        animTimerRef.current = setInterval(() => {
            const st = animStateRef.current;
            const coords = st.leg === 1 ? leg1CoordsRef.current : leg2CoordsRef.current;
            if (!coords || coords.length < 2) return;

            const dur = st.leg === 1 ? leg1DurRef.current : leg2DurRef.current;
            const baseMs = dur > 0 ? (dur * 1000) / (coords.length - 1) : 500;
            const stepMs = baseMs * speed;

            st.frac += ANIM_INTERVAL / Math.max(stepMs, 30);
            if (st.frac >= 1) {
                st.frac = 0;
                st.idx++;
                if (st.idx >= coords.length - 1) {
                    if (st.leg === 1) {
                        st.leg = 2;
                        st.idx = 0;
                    } else {
                        clearInterval(animTimerRef.current);
                        return;
                    }
                }
            }

            const c = st.leg === 1 ? leg1CoordsRef.current : leg2CoordsRef.current;
            const p1 = c[st.idx], p2 = c[st.idx + 1];
            if (!p1 || !p2) return;

            const pos = lerpPoint(p1, p2, st.frac);
            const brg = calcBearing(p1[0], p1[1], p2[0], p2[1]);

            if (!animMarkRef.current) {
                animMarkRef.current = L.marker(pos, {
                    icon: createVehicleIcon(vehicleType, brg),
                    zIndexOffset: 1000,
                }).addTo(map);
            } else {
                animMarkRef.current.setLatLng(pos);
                animMarkRef.current.setIcon(createVehicleIcon(vehicleType, brg));
            }
        }, ANIM_INTERVAL);
    }, [map]);

    // ── Compute & render route ──
    const computeAndRender = useCallback(async (position) => {
        const id = ++computeIdRef.current;
        const vType = mission.vehicleType || 'car';

        // ── Extract donor location (from Donation.pickupLocation) ──
        let donorLat = mission.pickupLocation?.coordinates?.[1];
        let donorLng = mission.pickupLocation?.coordinates?.[0];

        // ── Extract NGO location (from User.location via populate) ──
        let ngoLat = mission.claimedBy?.location?.coordinates?.[1];
        let ngoLng = mission.claimedBy?.location?.coordinates?.[0];

        // ── Detect [0,0] as "not set" and geocode fallback ──
        const isZero = (lat, lng) => (!lat && !lng) || (lat === 0 && lng === 0);

        if (isZero(ngoLat, ngoLng)) {
            const ngoAddr = mission.claimedBy?.address || mission.claimedBy?.organizationName;
            if (ngoAddr) {
                console.log('[NavigationMap] NGO location is [0,0], geocoding:', ngoAddr);
                try {
                    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(ngoAddr)}&format=json&limit=1`);
                    const d = await r.json();
                    if (d?.[0]) { ngoLat = parseFloat(d[0].lat); ngoLng = parseFloat(d[0].lon); }
                } catch (e) { console.warn('[NavigationMap] NGO geocode failed:', e); }
            }
        }

        if (isZero(donorLat, donorLng)) {
            const donorAddr = mission.address;
            if (donorAddr) {
                console.log('[NavigationMap] Donor location is [0,0], geocoding:', donorAddr);
                try {
                    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(donorAddr)}&format=json&limit=1`);
                    const d = await r.json();
                    if (d?.[0]) { donorLat = parseFloat(d[0].lat); donorLng = parseFloat(d[0].lon); }
                } catch (e) { console.warn('[NavigationMap] Donor geocode failed:', e); }
            }
        }

        console.log('[NavigationMap] Computing route:', {
            agent: position,
            donor: donorLat && donorLng ? [donorLat, donorLng] : 'MISSING',
            ngo: ngoLat && ngoLng ? [ngoLat, ngoLng] : 'MISSING',
            vehicle: vType,
            envLayers: envLayers.length,
        });

        if (!position || !donorLat || !ngoLat) {
            console.warn('[NavigationMap] Missing coordinates after fallback. Mission data:', mission);
            onRouteComputed?.({
                leg1: { coords: [], distance_m: 0, duration_s: 0 },
                leg2: { coords: [], distance_m: 0, duration_s: 0 },
                warning: '⚠️ Missing location data — check donor/NGO addresses',
            });
            return;
        }

        let routeData;
        try {
            routeData = await computeMissionRoute(
                position, [donorLat, donorLng], [ngoLat, ngoLng], vType, envLayers
            );
        } catch (err) {
            console.error('[NavigationMap] routing error:', err);
            onRouteComputed?.({
                leg1: { coords: [], distance_m: 0, duration_s: 0 },
                leg2: { coords: [], distance_m: 0, duration_s: 0 },
                warning: '⚠️ Route calculation failed. Check network.',
            });
            return;
        }

        // Stale check
        if (id !== computeIdRef.current) return;

        // Clear old layers
        clearAll();

        // Save coords for animation
        leg1CoordsRef.current = routeData.leg1.coords;
        leg2CoordsRef.current = routeData.leg2.coords;
        leg1DurRef.current = routeData.leg1.duration_s;
        leg2DurRef.current = routeData.leg2.duration_s;

        const lg = layerGroupRef.current;
        if (!lg) return;

        // ── Markers ──
        // Delivery assistant (green)
        L.marker(position, { icon: greenIcon, zIndexOffset: 900 })
            .bindPopup(`<strong>🟢 Your Location</strong>`)
            .addTo(lg);

        // Donor (yellow)
        L.marker([donorLat, donorLng], { icon: yellowIcon, zIndexOffset: 800 })
            .bindPopup(`<strong>🟡 Pickup: ${mission.donorId?.name || 'Donor'}</strong><br/>${mission.address || ''}`)
            .addTo(lg);

        // NGO (blue)
        L.marker([ngoLat, ngoLng], { icon: blueIcon, zIndexOffset: 800 })
            .bindPopup(`<strong>🔵 Drop: ${mission.claimedBy?.organizationName || 'NGO'}</strong>`)
            .addTo(lg);

        // ── Animated polyline draw ──
        const timers = [];

        if (routeData.leg1.coords.length >= 2) {
            const { polyline: p1, timer: t1 } = animatePolyline(
                map, routeData.leg1.coords,
                { color: '#f97316', weight: 6, opacity: 0.9, lineJoin: 'round', lineCap: 'round' },
                800, null
            );
            lg.addLayer(p1);
            timers.push(t1);
        }

        if (routeData.leg2.coords.length >= 2) {
            const { polyline: p2, timer: t2 } = animatePolyline(
                map, routeData.leg2.coords,
                { color: '#22c55e', weight: 6, opacity: 0.9, lineJoin: 'round', lineCap: 'round' },
                800, null
            );
            lg.addLayer(p2);
            timers.push(t2);
        }

        drawTimersRef.current = timers;

        // ── Fit bounds ──
        const allCoords = [position, [donorLat, donorLng], [ngoLat, ngoLng],
            ...routeData.leg1.coords, ...routeData.leg2.coords];
        if (allCoords.length > 1) {
            try { map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50] }); } catch { }
        }

        // ── Start vehicle animation after polyline draws ──
        setTimeout(() => {
            if (id === computeIdRef.current) startMarkerAnim(vType);
        }, 900);

        // ── Report back ──
        onRouteComputed?.(routeData);
    }, [mission, envLayers, map, clearAll, startMarkerAnim, onRouteComputed]);

    // ── Initial render ──
    useEffect(() => {
        computeAndRender(agentPos);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Re-compute on envLayers change ──
    useEffect(() => {
        // Get current animated position (if animating) or use agentPos
        const st = animStateRef.current;
        const c = st.leg === 1 ? leg1CoordsRef.current : leg2CoordsRef.current;
        let pos = agentPos;
        if (c?.[st.idx] && c?.[st.idx + 1]) {
            pos = lerpPoint(c[st.idx], c[st.idx + 1], st.frac);
        }
        computeAndRender(pos);
    }, [envLayers]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Re-compute if GPS moves significantly (Leg 1 only) ──
    useEffect(() => {
        if (!agentPos) return;
        const prev = prevPosRef.current;
        if (!prev) { prevPosRef.current = agentPos; return; }
        const moved = distM(prev[0], prev[1], agentPos[0], agentPos[1]);
        if (moved > SIG_MOVE_M && animStateRef.current.leg === 1) {
            prevPosRef.current = agentPos;
            computeAndRender(agentPos);
        }
    }, [agentPos]); // eslint-disable-line react-hooks/exhaustive-deps

    return null;
};

// ─── ETA Panel ───────────────────────────────────────────────────────────────
const ETAPanel = ({ routeData, expiryTime, rerouteMsg }) => {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    if (!routeData) return (
        <div style={{
            position: 'absolute', top: '16px', right: '16px', zIndex: 1000,
            background: 'rgba(10,14,23,0.9)', borderRadius: '14px', padding: '16px',
            border: '1px solid rgba(255,255,255,0.1)', color: '#aaa', fontSize: '0.85rem',
            display: 'flex', alignItems: 'center', gap: '8px',
        }}>
            <span className="spinner" style={{ width: 16, height: 16 }}></span>
            Computing route...
        </div>
    );

    const expiryMs = expiryTime ? new Date(expiryTime) - now : null;
    const expiryLabel = expiryMs !== null
        ? expiryMs <= 0 ? { t: 'EXPIRED!', c: '#ef4444' }
            : expiryMs < 3600000 ? { t: `${Math.floor(expiryMs / 60000)}m left`, c: '#ef4444' }
                : { t: `${Math.floor(expiryMs / 3600000)}h ${Math.floor((expiryMs % 3600000) / 60000)}m left`, c: expiryMs < 10800000 ? '#f97316' : '#22c55e' }
        : null;

    return (
        <div style={{
            position: 'absolute', top: '16px', right: '16px', zIndex: 1000,
            background: 'rgba(10,14,23,0.92)', backdropFilter: 'blur(10px)',
            borderRadius: '16px', padding: '16px 18px', width: '230px',
            border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            color: '#fff', fontSize: '0.82rem',
        }}>
            {/* Leg 1 */}
            <div style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                    <span style={{ width: 12, height: 3, background: '#f97316', display: 'inline-block', borderRadius: 2 }}></span>
                    <span style={{ fontWeight: 700, color: '#f97316' }}>You → Pickup</span>
                </div>
                <div style={{ paddingLeft: '18px', color: '#aaa' }}>
                    ⏱ {fmtDuration(routeData.leg1?.duration_s)} &nbsp; 📏 {fmtDistance(routeData.leg1?.distance_m)}
                </div>
            </div>
            {/* Leg 2 */}
            <div style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                    <span style={{ width: 12, height: 3, background: '#22c55e', display: 'inline-block', borderRadius: 2 }}></span>
                    <span style={{ fontWeight: 700, color: '#22c55e' }}>Pickup → NGO</span>
                </div>
                <div style={{ paddingLeft: '18px', color: '#aaa' }}>
                    ⏱ {fmtDuration(routeData.leg2?.duration_s)} &nbsp; 📏 {fmtDistance(routeData.leg2?.distance_m)}
                </div>
            </div>
            {/* Total */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '8px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#777' }}>Total</span>
                <span style={{ fontWeight: 700 }}>
                    {fmtDuration((routeData.leg1?.duration_s || 0) + (routeData.leg2?.duration_s || 0))} &nbsp;
                    {fmtDistance((routeData.leg1?.distance_m || 0) + (routeData.leg2?.distance_m || 0))}
                </span>
            </div>
            {/* Expiry */}
            {expiryLabel && (
                <div style={{ marginTop: '8px', padding: '5px 10px', borderRadius: '8px', background: expiryLabel.c + '18', color: expiryLabel.c, fontWeight: 700, textAlign: 'center', fontSize: '0.8rem' }}>
                    ⏰ {expiryLabel.t}
                </div>
            )}
            {/* Warning */}
            {routeData.warning && (
                <div style={{ marginTop: '8px', padding: '5px 10px', borderRadius: '8px', background: 'rgba(239,68,68,0.12)', color: '#f87171', fontSize: '0.75rem', fontWeight: 600 }}>
                    {routeData.warning}
                </div>
            )}
            {/* Reroute flash */}
            {rerouteMsg && (
                <div style={{
                    marginTop: '8px', padding: '5px 10px', borderRadius: '8px',
                    background: 'rgba(59,130,246,0.15)', color: '#60a5fa',
                    fontSize: '0.75rem', fontWeight: 700, textAlign: 'center',
                    animation: 'navFadeOut 3.5s forwards',
                }}>
                    🔄 {rerouteMsg}
                </div>
            )}
        </div>
    );
};

// ─── Map Legend ───────────────────────────────────────────────────────────────
const MapLegend = () => (
    <div style={{
        position: 'absolute', bottom: '24px', left: '16px', zIndex: 1000,
        background: 'rgba(10,14,23,0.88)', backdropFilter: 'blur(6px)',
        borderRadius: '12px', padding: '10px 14px', border: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '0.75rem', color: '#ccc',
    }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png" alt="" style={{ height: 16 }} />
            You
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-gold.png" alt="" style={{ height: 16 }} />
            Food Donor
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <img src="https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png" alt="" style={{ height: 16 }} />
            NGO / Volunteer
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '2px 0' }} />
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ width: 14, height: 3, background: '#f97316', display: 'inline-block', borderRadius: 2 }}></span>
            Leg 1: You → Pickup
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ width: 14, height: 3, background: '#22c55e', display: 'inline-block', borderRadius: 2 }}></span>
            Leg 2: Pickup → NGO
        </div>
    </div>
);

// ─── Main Export ──────────────────────────────────────────────────────────────
const NavigationMap = ({ mission, envLayers, agentPos }) => {
    const [routeData, setRouteData] = useState(null);
    const [rerouteMsg, setRerouteMsg] = useState(null);
    const prevReroutedRef = useRef(false);

    const handleRouteComputed = useCallback((data) => {
        setRouteData(data);
        if (data.rerouted && !prevReroutedRef.current) {
            setRerouteMsg(data.warning?.includes('flood') ? 'Rerouted to avoid flood zone' : 'Rerouted to avoid road block');
            setTimeout(() => setRerouteMsg(null), 4000);
        }
        prevReroutedRef.current = data.rerouted;
    }, []);

    // Fallback center: agent position, or Chennai default
    const center = agentPos || [13.0827, 80.2707];

    return (
        <div style={{ position: 'relative', height: '100%', width: '100%' }}>
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
                />
                <NavMapInner
                    mission={mission}
                    envLayers={envLayers}
                    agentPos={agentPos || center}
                    onRouteComputed={handleRouteComputed}
                />
            </MapContainer>
            <ETAPanel routeData={routeData} expiryTime={mission?.expiryTime} rerouteMsg={rerouteMsg} />
            <MapLegend />
            <style>{`
                @keyframes navFadeOut { 0%{opacity:1} 70%{opacity:1} 100%{opacity:0} }
            `}</style>
        </div>
    );
};

export default NavigationMap;
