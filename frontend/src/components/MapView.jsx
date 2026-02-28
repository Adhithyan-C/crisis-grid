import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon path issue with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const greenIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34],
});

const MapView = ({ donations, onClaim }) => {
    const validDonations = donations.filter(
        (d) => d.pickupLocation?.coordinates?.length === 2
    );

    if (validDonations.length === 0) {
        return (
            <div className="map-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="empty-state">
                    <div className="empty-state-icon">🗺️</div>
                    <div className="empty-state-title">No locations to show</div>
                    <p>Search for donations to see them on the map</p>
                </div>
            </div>
        );
    }

    const firstDonation = validDonations[0];
    const center = [firstDonation.pickupLocation.coordinates[1], firstDonation.pickupLocation.coordinates[0]];

    return (
        <div className="map-container">
            <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {validDonations.map((d) => (
                    <Marker
                        key={d._id}
                        position={[d.pickupLocation.coordinates[1], d.pickupLocation.coordinates[0]]}
                        icon={greenIcon}
                    >
                        <Popup>
                            <div style={{ minWidth: '180px' }}>
                                {d.imageUrl && (
                                    <img
                                        src={`http://localhost:5000${d.imageUrl}`}
                                        alt={d.foodName}
                                        style={{ width: '100%', height: '100px', objectFit: 'cover', borderRadius: '8px', marginBottom: '8px' }}
                                    />
                                )}
                                <strong style={{ fontSize: '1rem' }}>{d.foodName}</strong>
                                <br /><span style={{ color: '#666', fontSize: '0.8rem' }}>{d.foodType?.toUpperCase()}</span>
                                <br />👥 {d.servings} servings
                                <br />📍 {d.distanceKm} km away
                                <br />
                                <button
                                    onClick={() => onClaim(d._id, d.foodName)}
                                    style={{
                                        marginTop: '8px', background: '#FC8019', color: 'white',
                                        border: 'none', padding: '6px 14px', borderRadius: '8px',
                                        cursor: 'pointer', fontWeight: 600, width: '100%'
                                    }}
                                >
                                    Claim
                                </button>
                            </div>
                        </Popup>
                    </Marker>
                ))}
            </MapContainer>
        </div>
    );
};

export default MapView;
