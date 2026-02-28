import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStats } from '../api/index';

const LandingPage = () => {
    const [stats, setStats] = useState({ totalDonations: 0, claimedDonations: 0, mealsRescued: 0 });

    useEffect(() => {
        getStats()
            .then((res) => setStats(res.data))
            .catch(() => { });
    }, []);

    return (
        <div className="page-wrapper">
            {/* Hero */}
            <section className="hero">
                <div className="hero-bg" />
                <div className="hero-eyebrow">
                    🤖 AI-Powered Food Rescue Platform
                </div>
                <h1 className="hero-title">
                    No Food<br />
                    Should Go<br />
                    <span className="accent">to Waste.</span>
                </h1>
                <p className="hero-subtitle">
                    CrisisGrid connects food donors with NGOs using AI-powered natural language search
                    and real-time geolocation matching — orchestrating food logistics, not just listings.
                </p>
                <div className="hero-cta">
                    <Link to="/auth/donor" className="btn btn-primary btn-lg">
                        🍱 Start Donating
                    </Link>
                    <Link to="/auth/ngo" className="btn btn-secondary btn-lg">
                        🏥 I'm an NGO
                    </Link>
                    <Link to="/auth/delivery" className="btn btn-delivery btn-lg">
                        🚚 Delivery Partner Login
                    </Link>
                    <Link to="/auth/government" className="btn btn-ghost btn-sm" style={{ opacity: 0.65, fontSize: '0.82rem' }}>
                        🏛️ Government Portal
                    </Link>
                </div>

                {/* Impact Stats */}
                <div className="stats-bar fade-in">
                    <div className="stat-item">
                        <div className="stat-number">{stats.totalDonations}+</div>
                        <div className="stat-label">Donations Listed</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-number">{stats.claimedDonations}+</div>
                        <div className="stat-label">Food Rescued</div>
                    </div>
                    <div className="stat-item">
                        <div className="stat-number">{stats.mealsRescued}+</div>
                        <div className="stat-label">Meals Served</div>
                    </div>
                </div>
            </section>

            {/* How it works */}
            <section className="how-it-works container">
                <h2 className="section-title">How It Works</h2>
                <p className="section-subtitle">AI extracts intent. Our engine does the matching.</p>
                <div className="steps-grid">
                    <div className="step-card fade-in">
                        <div className="step-number">1</div>
                        <div className="step-title">Donors List Food</div>
                        <p className="step-desc">
                            Restaurants, hotels, and event organizers submit surplus food with address and details.
                            We geocode the location automatically.
                        </p>
                    </div>
                    <div className="step-card fade-in" style={{ animationDelay: '0.1s' }}>
                        <div className="step-number">2</div>
                        <div className="step-title">NGOs Describe Needs</div>
                        <p className="step-desc">
                            NGOs type in plain language: "Need veg food for 50 people near Anna Nagar urgently."
                            Our LLaMA-powered AI extracts structured filters.
                        </p>
                    </div>
                    <div className="step-card fade-in" style={{ animationDelay: '0.2s' }}>
                        <div className="step-number">3</div>
                        <div className="step-title">Geospatial Matching</div>
                        <p className="step-desc">
                            MongoDB's <code>$geoNear</code> pipeline ranks nearby donations by distance.
                            NGOs claim atomically — no double-claiming ever.
                        </p>
                    </div>
                </div>
            </section>

            {/* Architecture callout */}
            <section className="container" style={{ paddingBottom: '80px' }}>
                <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '16px' }}>🏗️</div>
                    <h3 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '12px' }}>
                        Production-Ready Architecture
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', maxWidth: '520px', margin: '0 auto 28px', lineHeight: 1.7 }}>
                        Built on React + Node.js + MongoDB Atlas with JWT authentication,
                        GeoJSON 2dsphere indexes, and concurrency-safe atomic updates.
                    </p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        {['React', 'Node.js', 'MongoDB Atlas', 'JWT Auth', 'Groq LLaMA', 'Leaflet Maps'].map((t) => (
                            <span key={t} className="badge badge-available">{t}</span>
                        ))}
                    </div>
                </div>
            </section>
        </div>
    );
};

export default LandingPage;
