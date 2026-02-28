import { useState } from 'react';
import { parseQuery, geocodeHint, searchDonations, claimDonation } from '../api/index';
import { useAuth } from '../context/AuthContext';
import MapView from '../components/MapView';

const NgoDashboard = () => {
    const { user } = useAuth();
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState(null);
    const [filters, setFilters] = useState(null);
    const [view, setView] = useState('list'); // 'list' | 'map'
    const [claiming, setClaiming] = useState(null);
    const [toast, setToast] = useState(null);
    const [error, setError] = useState('');

    const showToast = (msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    };

    const handleSearch = async () => {
        if (!query.trim()) return;
        setSearching(true);
        setResults(null);
        setError('');
        setFilters(null);

        try {
            // Step 1: AI parse
            const aiRes = await parseQuery(query);
            const parsed = aiRes.data.filters;
            setFilters(parsed);

            // Step 2: Geocode locationHint
            let lat = 13.0827;
            let lng = 80.2707; // Default: Chennai
            if (parsed.locationHint) {
                try {
                    // Append region context to improve geocoding accuracy
                    const geoRes = await geocodeHint(`${parsed.locationHint}, Chennai`);
                    lat = geoRes.data.lat;
                    lng = geoRes.data.lng;
                } catch {
                    // geocoding failed; use defaults
                }
            }

            // Step 3: Search MongoDB via $geoNear
            const params = {
                lat, lng,
                ...(parsed.foodType && { foodType: parsed.foodType }),
                ...(parsed.quantityPeople && { minServings: parsed.quantityPeople }),
            };
            const searchRes = await searchDonations(params);
            setResults(searchRes.data);
        } catch (err) {
            setError(err.response?.data?.message || 'Search failed. Please try again.');
            setResults([]);
        } finally {
            setSearching(false);
        }
    };

    const handleClaim = async (id, foodName) => {
        setClaiming(id);
        try {
            await claimDonation(id);
            setResults((prev) => prev.filter((d) => d._id !== id));
            showToast(`✅ Successfully claimed: ${foodName}`);
        } catch (err) {
            showToast(err.response?.data?.message || 'Failed to claim donation', 'error');
        } finally {
            setClaiming(null);
        }
    };

    return (
        <div className="page-wrapper">
            <div className="dashboard">
                {/* Header */}
                <div className="dashboard-header">
                    <h1 className="dashboard-title">🔍 NGO Smart Search</h1>
                    <p className="dashboard-subtitle">
                        Welcome, {user?.organizationName || user?.name} — describe your food needs in plain language
                    </p>
                </div>

                {/* AI Search Bar */}
                <div className="ai-searchbar-wrap">
                    <div className="ai-searchbar-label">
                        🤖 AI-Powered Natural Language Search
                    </div>
                    <div className="ai-searchbar-input-row">
                        <textarea
                            className="ai-searchbar-input"
                            rows={2}
                            placeholder='e.g., "Need veg food for 50 people near Anna Nagar urgently"'
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSearch())}
                        />
                        <button
                            className={`btn btn-primary ${searching ? 'btn-loading' : ''}`}
                            onClick={handleSearch}
                            disabled={searching || !query.trim()}
                            style={{ alignSelf: 'stretch', minWidth: '120px' }}
                        >
                            {!searching && '🔍 Search'}
                        </button>
                    </div>

                    {/* Filter chips from AI response */}
                    {filters && (
                        <div className="filter-chips">
                            <span className="filter-chip">🤖 AI Extracted:</span>
                            {filters.foodType && (
                                <span className={`filter-chip ${filters.foodType === 'veg' ? 'chip-green' : 'chip-red'}`}>
                                    {filters.foodType === 'veg' ? '🥗 Veg' : '🍗 Non-Veg'}
                                </span>
                            )}
                            {filters.quantityPeople && (
                                <span className="filter-chip chip-blue">👥 {filters.quantityPeople} people</span>
                            )}
                            {filters.locationHint && (
                                <span className="filter-chip chip-orange">📍 {filters.locationHint}</span>
                            )}
                            {filters.urgency === 'urgent' && (
                                <span className="badge badge-urgent">⚡ Urgent</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Results header */}
                {results !== null && (
                    <div className="results-header">
                        <div className="results-count">
                            Found <strong>{results.length}</strong> donation{results.length !== 1 ? 's' : ''}, sorted by distance
                        </div>
                        <div className="view-toggle">
                            <button
                                className={`view-btn ${view === 'list' ? 'active' : ''}`}
                                onClick={() => setView('list')}
                            >☰ List</button>
                            <button
                                className={`view-btn ${view === 'map' ? 'active' : ''}`}
                                onClick={() => setView('map')}
                            >🗺 Map</button>
                        </div>
                    </div>
                )}

                {/* Loading */}
                {searching && <div className="spinner-wrap"><div className="spinner" /></div>}

                {/* Error */}
                {error && (
                    <div className="empty-state">
                        <div className="empty-state-icon">⚠️</div>
                        <div className="empty-state-title">Search Error</div>
                        <p>{error}</p>
                    </div>
                )}

                {/* No results yet */}
                {results === null && !searching && !error && (
                    <div className="empty-state">
                        <div className="empty-state-icon">🤖</div>
                        <div className="empty-state-title">Describe what you need</div>
                        <p>AI will extract food type, quantity, and location — then find the nearest matches.</p>
                    </div>
                )}

                {/* Empty results */}
                {results !== null && results.length === 0 && !searching && (
                    <div className="empty-state">
                        <div className="empty-state-icon">📭</div>
                        <div className="empty-state-title">No matching donations found</div>
                        <p>Try adjusting your search — different area, fewer quantity, or different food type.</p>
                    </div>
                )}

                {/* Results */}
                {results !== null && results.length > 0 && !searching && (
                    <>
                        {/* Map View */}
                        {view === 'map' && (
                            <div style={{ marginBottom: '24px' }}>
                                <MapView donations={results} onClaim={handleClaim} />
                            </div>
                        )}

                        {/* List View */}
                        {view === 'list' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                {results.map((d, i) => (
                                    <div key={d._id} className="donation-card fade-in" style={{ animationDelay: `${i * 0.05}s` }}>
                                        <div className="donation-card-top">
                                            {d.imageUrl && (
                                                <img
                                                    src={`http://localhost:5000${d.imageUrl}`}
                                                    alt={d.foodName}
                                                    className="donation-card-img"
                                                />
                                            )}
                                            <div className="donation-card-content">
                                                <div className="donation-card-title">{d.foodName}</div>
                                                <div className="donation-card-meta">{d.description}</div>
                                                {d.donor?.name && (
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                        By: {d.donor.name}
                                                        {d.donor.phone ? ` · 📞 ${d.donor.phone}` : ''}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="donation-card-badges">
                                                <span className="badge badge-available">🟢 Available</span>
                                                <span className={`badge ${d.foodType === 'veg' ? 'badge-veg' : 'badge-nonveg'}`}>
                                                    {d.foodType === 'veg' ? '🥗 Veg' : '🍗 Non-Veg'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="donation-card-footer">
                                            <div className="donation-card-details">
                                                <div className="donation-detail">👥 <strong>{d.servings}</strong> servings</div>
                                                <div className="donation-detail">📍 {d.address?.slice(0, 35)}{d.address?.length > 35 ? '...' : ''}</div>
                                                <div className="donation-detail">🕐 ~{d.etaMinutes} min ETA</div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div className="donation-distance">📡 {d.distanceKm} km</div>
                                                <button
                                                    className={`btn btn-primary btn-sm ${claiming === d._id ? 'btn-loading' : ''}`}
                                                    onClick={() => handleClaim(d._id, d.foodName)}
                                                    disabled={claiming !== null}
                                                >
                                                    {claiming !== d._id && '✅ Claim'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Toast */}
            {toast && (
                <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
            )}
        </div>
    );
};

export default NgoDashboard;
