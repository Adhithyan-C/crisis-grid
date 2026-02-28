/**
 * routing.js — OSRM routing with Turf.js obstacle-aware scoring
 *
 * OSRM is called with alternatives=true, overview=full, geometries=geojson.
 * All coordinates internally are [lat, lng] — converted to [lng, lat] only
 * when calling OSRM and Turf (GeoJSON standard).
 *
 * Obstacle rules:
 *  - Roadblock polylines → route is REJECTED (non-traversable)
 *  - Flood polygons with severity > 3 → heavy penalty (effectively rejected)
 *  - Flood polygons with severity ≤ 3 → moderate penalty
 *  - Among valid candidates pick lowest travel time, then shortest distance
 *
 * If all alternatives are invalid, generates bypass waypoints around the
 * obstacle bounding box and retries (max 3 attempts).
 */

import * as turf from '@turf/turf';

// ─── Config ──────────────────────────────────────────────────────────────────
const OSRM_BASE = 'https://router.project-osrm.org/route/v1';
const MAX_BYPASS = 3;
const FLOOD_HIGH_PENALTY = 999999;  // seconds added for sev > 3
const FLOOD_LOW_PENALTY = 600;      // seconds added for sev ≤ 3

// ─── Vehicle helpers ─────────────────────────────────────────────────────────
export const vehicleProfile = (v) =>
    v === 'bike' ? 'cycling' : 'driving';

export const vehicleSpeedFactor = (v) =>
    v === 'bike' ? 0.85 : v === 'truck' ? 0.65 : 1.0;

// ─── Coord converters ────────────────────────────────────────────────────────
// [lat,lng] → "lng,lat" for OSRM URL
const toOSRM = ([lat, lng]) => `${lng},${lat}`;
// GeoJSON [lng,lat] → [lat,lng]
const fromGeoJSON = ([lng, lat]) => [lat, lng];
// [lat,lng] → GeoJSON [lng,lat]
const toGeoJSON = ([lat, lng]) => [lng, lat];

// ─── OSRM fetch ──────────────────────────────────────────────────────────────
/**
 * Call OSRM and return ALL alternative routes.
 * waypoints: [[lat,lng], ...]
 * Returns array of { coords: [[lat,lng]...], distance_m, duration_s }
 */
async function fetchOSRM(profile, waypoints) {
    try {
        const coordStr = waypoints.map(toOSRM).join(';');
        const url = `${OSRM_BASE}/${profile}/${coordStr}?overview=full&geometries=geojson&alternatives=true`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.code !== 'Ok' || !json.routes?.length) return [];
        return json.routes.map(r => ({
            coords: r.geometry.coordinates.map(fromGeoJSON),
            distance_m: r.distance,
            duration_s: r.duration,
        }));
    } catch (e) {
        console.error('[routing] OSRM fetch failed:', e);
        return [];
    }
}

// ─── Obstacle checking ──────────────────────────────────────────────────────
/**
 * Score a route against obstacles.
 * Returns { valid: boolean, penalty: number, warnings: string[] }
 */
function scoreRoute(routeCoords, envLayers) {
    if (routeCoords.length < 2) return { valid: false, penalty: Infinity, warnings: ['Route has no segments'] };

    const line = turf.lineString(routeCoords.map(toGeoJSON));
    let penalty = 0;
    const warnings = [];

    for (const layer of envLayers) {
        if (!layer.isActive) continue;

        // ── Roadblocks: fully non-traversable ──
        if (layer.type === 'roadblock' && layer.geometry?.type === 'LineString') {
            try {
                const blocked = turf.lineString(layer.geometry.coordinates);
                if (turf.booleanIntersects(line, blocked)) {
                    return { valid: false, penalty: Infinity, warnings: ['Route crosses a blocked road'] };
                }
            } catch { /* malformed geometry, skip */ }
        }

        // ── Floods ──
        if (layer.type === 'flood' && layer.geometry?.type === 'Polygon') {
            try {
                const poly = turf.polygon(layer.geometry.coordinates);
                if (turf.booleanIntersects(line, poly)) {
                    if (layer.severity > 3) {
                        // Non-routable
                        return { valid: false, penalty: Infinity, warnings: [`Route crosses severe flood zone (Severity ${layer.severity})`] };
                    } else {
                        penalty += FLOOD_LOW_PENALTY;
                        warnings.push(`Route passes through minor flood zone (Severity ${layer.severity})`);
                    }
                }
            } catch { /* malformed geometry, skip */ }
        }
    }

    return { valid: true, penalty, warnings };
}

// ─── Bypass waypoints ────────────────────────────────────────────────────────
function generateBypasses(origin, destination, envLayers) {
    // Find first blocking obstacle
    const fakeRoute = [origin, destination];
    const line = turf.lineString(fakeRoute.map(toGeoJSON));
    const bypasses = [];

    for (const layer of envLayers) {
        if (!layer.isActive) continue;
        let geom, intersects = false;
        try {
            if (layer.type === 'flood' && layer.severity > 3 && layer.geometry?.type === 'Polygon') {
                geom = turf.polygon(layer.geometry.coordinates);
                intersects = turf.booleanIntersects(line, geom);
            } else if (layer.type === 'roadblock' && layer.geometry?.type === 'LineString') {
                geom = turf.lineString(layer.geometry.coordinates);
                intersects = turf.booleanIntersects(line, geom);
            }
        } catch { continue; }

        if (intersects && geom) {
            const [minLng, minLat, maxLng, maxLat] = turf.bbox(geom);
            const pad = 0.004; // ~400m
            const corners = [
                [minLat - pad, minLng - pad],
                [maxLat + pad, minLng - pad],
                [minLat - pad, maxLng + pad],
                [maxLat + pad, maxLng + pad],
            ];
            corners.forEach(c => bypasses.push([origin, c, destination]));
            if (bypasses.length >= MAX_BYPASS * 4) break;
        }
    }

    return bypasses.slice(0, MAX_BYPASS * 3);
}

// ─── Compute a single leg ────────────────────────────────────────────────────
/**
 * Returns best valid route for one leg, or the best-effort route with warning.
 * Result: { coords, distance_m, duration_s, rerouted, warning }
 */
async function computeLeg(profile, origin, destination, envLayers) {
    // 1. Fetch alternatives for direct route
    const routes = await fetchOSRM(profile, [origin, destination]);
    if (!routes.length) {
        return {
            coords: [origin, destination],
            distance_m: 0,
            duration_s: 0,
            rerouted: false,
            warning: '⚠️ Routing service unavailable',
        };
    }

    // 2. Score each alternative
    const scored = routes.map(r => {
        const s = scoreRoute(r.coords, envLayers);
        return { ...r, ...s, effectiveCost: r.duration_s + s.penalty };
    });

    // 3. Pick best valid route
    const valid = scored.filter(r => r.valid).sort((a, b) => a.effectiveCost - b.effectiveCost || a.distance_m - b.distance_m);
    if (valid.length > 0) {
        const best = valid[0];
        return {
            coords: best.coords,
            distance_m: best.distance_m,
            duration_s: best.duration_s,
            rerouted: false,
            warning: best.warnings.length ? best.warnings[0] : null,
        };
    }

    // 4. All alternatives blocked — try bypass waypoints
    const bypasses = generateBypasses(origin, destination, envLayers);
    const bypassCandidates = [];

    for (const waypoints of bypasses) {
        const bypassRoutes = await fetchOSRM(profile, waypoints);
        for (const br of bypassRoutes) {
            const s = scoreRoute(br.coords, envLayers);
            if (s.valid) {
                bypassCandidates.push({
                    ...br, ...s,
                    effectiveCost: br.duration_s + s.penalty,
                });
            }
        }
    }

    if (bypassCandidates.length > 0) {
        const best = bypassCandidates.sort((a, b) => a.effectiveCost - b.effectiveCost)[0];
        const warnType = scored[0]?.warnings?.[0]?.includes('flood') ? 'flood zone' : 'road block';
        return {
            coords: best.coords,
            distance_m: best.distance_m,
            duration_s: best.duration_s,
            rerouted: true,
            warning: `Rerouted to avoid ${warnType}`,
        };
    }

    // 5. No valid route at all — return best original with warning
    const fallback = scored.sort((a, b) => a.effectiveCost - b.effectiveCost)[0];
    return {
        coords: fallback.coords,
        distance_m: fallback.distance_m,
        duration_s: fallback.duration_s,
        rerouted: false,
        warning: `⚠️ No safe route — ${fallback.warnings[0] || 'obstacle on path'}`,
    };
}

// ─── Main export: compute full mission route ─────────────────────────────────
/**
 * @param {[lat,lng]} agentPos
 * @param {[lat,lng]} donorPos
 * @param {[lat,lng]} ngoPos
 * @param {string}    vehicleType
 * @param {object[]}  envLayers
 */
export async function computeMissionRoute(agentPos, donorPos, ngoPos, vehicleType, envLayers) {
    const profile = vehicleProfile(vehicleType);
    const active = envLayers.filter(l => l.isActive);

    const [leg1, leg2] = await Promise.all([
        computeLeg(profile, agentPos, donorPos, active),
        computeLeg(profile, donorPos, ngoPos, active),
    ]);

    return {
        leg1,
        leg2,
        totalDistance_m: leg1.distance_m + leg2.distance_m,
        totalDuration_s: leg1.duration_s + leg2.duration_s,
        rerouted: leg1.rerouted || leg2.rerouted,
        warning: leg1.warning || leg2.warning || null,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function calcBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
        Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

export function lerpPoint([lat1, lng1], [lat2, lng2], t) {
    return [lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t];
}

export function fmtDuration(secs) {
    if (!secs || secs <= 0) return '0s';
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return m === 0 ? `${s}s` : `${m}m`;
}

export function fmtDistance(meters) {
    if (!meters || meters <= 0) return '0m';
    return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}
