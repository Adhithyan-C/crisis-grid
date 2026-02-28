# CrisisGrid – AI-Powered Food Rescue Platform

> **React + Node.js + MongoDB Atlas + Groq LLaMA 3.1**

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 18
- MongoDB Atlas account (free tier works)
- Groq API key (optional — fallback keyword parser works without it)

---

### 1. Configure Backend

Edit `backend/.env`:
```
MONGO_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/crisisgrid?retryWrites=true&w=majority
JWT_SECRET=your_random_secret_string
GROQ_API_KEY=your_groq_key_here   # optional
PORT=5000
```

### 2. Start Backend
```bash
cd backend
npm install
npm run dev
# → http://localhost:5000
```

### 3. Start Frontend
```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

---

## 📁 Project Structure

```
crisisgrid-web/
├── backend/
│   ├── models/          # User.js, Donation.js (Mongoose + 2dsphere)
│   ├── routes/          # auth.js, donations.js, ai.js
│   ├── controllers/     # authController, donationController, aiController
│   ├── middleware/      # JWT auth + role guards
│   └── server.js
└── frontend/
    └── src/
        ├── api/         # Axios client + all endpoint helpers
        ├── context/     # AuthContext (JWT + user state)
        ├── pages/       # LandingPage, RolePage, AuthPage, DonorDashboard, NgoDashboard
        └── components/  # Navbar, MapView, ProtectedRoute
```

## 🏗️ Architecture

```
NGO types: "Need veg food for 40 people near Anna Nagar urgently"
    ↓
POST /api/ai/parse → Groq LLaMA 3.1 → { foodType, quantityPeople, locationHint, urgency }
    ↓
GET /api/ai/geocode?q=Anna Nagar → { lat, lng }
    ↓
GET /api/donations/search?lat=&lng=&foodType=veg&minServings=40
    ↓
MongoDB $geoNear aggregation → sorted by distance
    ↓
NGO clicks Claim → PATCH /api/donations/:id/claim
    ↓
findOneAndUpdate({ status: "available" }) → atomic, prevents double-claiming
```

## 🌐 Deployment

| Layer    | Platform    |
|----------|-------------|
| Frontend | Vercel      |
| Backend  | Render / Railway |
| Database | MongoDB Atlas |
