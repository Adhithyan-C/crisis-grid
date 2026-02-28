import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { registerUser, loginUser, googleLogin } from '../api/index';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';

const AuthPage = () => {
    const { role } = useParams(); // 'donor' | 'ngo' | 'delivery' | 'government'
    const { login } = useAuth();
    const navigate = useNavigate();
    const isDonor = role === 'donor';
    const isNgo = role === 'ngo';
    const isDelivery = role === 'delivery';
    const isGov = role === 'government';

    // All roles can register; government defaults to register tab like any other role
    const [tab, setTab] = useState('register');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [form, setForm] = useState({
        name: '', email: '', password: '', phone: '', organizationName: '',
        vehicleType: 'bike', vehicleCapacity: '',
    });

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
        setError('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            let res;
            if (tab === 'register') {
                res = await registerUser({ ...form, role });
            } else {
                res = await loginUser({ email: form.email, password: form.password });
            }
            const { token, ...userData } = res.data;
            login(userData, token);

            let path = '/donor';
            if (userData.role === 'ngo') path = '/ngo';
            if (userData.role === 'delivery') path = '/delivery';
            if (userData.role === 'government') path = '/government';

            navigate(path, { replace: true });
        } catch (err) {
            setError(err.response?.data?.message || 'Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSuccess = async (credentialResponse) => {
        setLoading(true);
        setError('');
        try {
            const res = await googleLogin(credentialResponse.credential, role);
            const { token, ...userData } = res.data;
            login(userData, token);

            let path = '/donor';
            if (userData.role === 'ngo') path = '/ngo';
            if (userData.role === 'delivery') path = '/delivery';

            navigate(path, { replace: true });
        } catch (err) {
            setError(err.response?.data?.detail || err.response?.data?.message || 'Google login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page page-wrapper">
            <div className="auth-card fade-in">
                {/* Role badge */}
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                    <span style={{ fontSize: '2.5rem' }}>
                        {isDonor ? '🍱' : isNgo ? '🏥' : isDelivery ? '🚚' : '🏛️'}
                    </span>
                    <h2 style={{ fontWeight: 800, fontSize: '1.5rem', marginTop: '10px' }}>
                        {isDonor ? 'Donor' : isNgo ? 'NGO' : isDelivery ? 'Delivery Partner' : 'Government'} Portal
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '4px' }}>
                        {isDonor ? 'Share your surplus food' :
                            isNgo ? 'Find food for your community' :
                                isDelivery ? 'Deliver food and make an impact' :
                                    'Manage flood zones & road alerts'}
                    </p>
                    {isGov && (
                        <div style={{ marginTop: '10px', padding: '6px 14px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: '0.78rem', fontWeight: 600, display: 'inline-block' }}>
                            🔒 Restricted Access
                        </div>
                    )}
                </div>

                {/* Tabs — shown for ALL roles including government */}
                <div className="auth-tabs">
                    <button className={`auth-tab ${tab === 'register' ? 'active' : ''}`} onClick={() => setTab('register')}>
                        Register
                    </button>
                    <button className={`auth-tab ${tab === 'login' ? 'active' : ''}`} onClick={() => setTab('login')}>
                        Login
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    {tab === 'register' && (
                        <>
                            <div className="form-group">
                                <label className="form-label">
                                    {isDonor ? 'Your Name / Business Name' : isGov ? 'Full Name' : 'Contact Person Name'}
                                </label>
                                <input
                                    className="form-input" name="name" required
                                    placeholder={isDonor ? 'e.g., ABC Restaurant' : isGov ? 'e.g., Arjun Kumar' : 'e.g., John Doe'}
                                    value={form.name} onChange={handleChange}
                                />
                            </div>
                            {/* Org name — only for NGO, not for gov or delivery */}
                            {isNgo && (
                                <>
                                    <div className="form-group">
                                        <label className="form-label">NGO / Organization Name</label>
                                        <input
                                            className="form-input" name="organizationName" required
                                            placeholder="e.g., Helping Hands Foundation"
                                            value={form.organizationName} onChange={handleChange}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Organization Address</label>
                                        <input
                                            className="form-input" name="address" required
                                            placeholder="e.g., Anna Nagar, Chennai"
                                            value={form.address} onChange={handleChange}
                                        />
                                    </div>
                                </>
                            )}

                            {isDelivery && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div className="form-group">
                                        <label className="form-label">Vehicle Type</label>
                                        <select
                                            className="form-input" name="vehicleType"
                                            value={form.vehicleType} onChange={handleChange}
                                        >
                                            <option value="bike">Bike</option>
                                            <option value="car">Car</option>
                                            <option value="truck">Truck</option>
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Capacity (servings)</label>
                                        <input
                                            className="form-input" name="vehicleCapacity" type="number" required
                                            placeholder="e.g. 50"
                                            value={form.vehicleCapacity} onChange={handleChange}
                                        />
                                    </div>
                                    <div className="form-group dashboard-full">
                                        <label className="form-label">Base Location (Address)</label>
                                        <input
                                            className="form-input" name="address" required
                                            placeholder="e.g. T. Nagar, Chennai"
                                            value={form.address} onChange={handleChange}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Phone — only for donor/ngo/delivery, not gov */}
                            {!isGov && (
                                <div className="form-group">
                                    <label className="form-label">Phone Number</label>
                                    <input
                                        className="form-input" name="phone" type="tel"
                                        placeholder="9876543210"
                                        value={form.phone} onChange={handleChange}
                                    />
                                </div>
                            )}
                        </>
                    )}

                    <div className="form-group">
                        <label className="form-label">Email</label>
                        <input
                            className="form-input" name="email" type="email" required
                            placeholder="you@example.com"
                            value={form.email} onChange={handleChange}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <input
                            className="form-input" name="password" type="password" required minLength={6}
                            placeholder="Minimum 6 characters"
                            value={form.password} onChange={handleChange}
                        />
                    </div>

                    {error && (
                        <div className="form-error" style={{ marginBottom: '16px', fontSize: '0.875rem', textAlign: 'center' }}>
                            ⚠️ {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        className={`btn btn-primary btn-full ${loading ? 'btn-loading' : ''}`}
                        disabled={loading}
                        style={{ marginTop: '4px' }}
                    >
                        {!loading && (tab === 'register' ? 'Create Account' : 'Sign In')}
                    </button>

                    {/* Google Login — only for non-government roles */}
                    {!isGov && (
                        <>
                            <div className="auth-divider">
                                <span>OR</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <GoogleLogin
                                    onSuccess={handleGoogleSuccess}
                                    onError={() => setError('Google Authentication Failed')}
                                    theme="filled_black"
                                    text={tab === 'register' ? 'signup_with' : 'signin_with'}
                                    shape="pill"
                                    width="100%"
                                />
                            </div>
                        </>
                    )}
                </form>

                <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Wrong portal?{' '}
                    <button
                        onClick={() => navigate('/roles')}
                        style={{ color: 'var(--orange)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                        Switch Role
                    </button>
                </p>
            </div>
        </div>
    );
};

export default AuthPage;
