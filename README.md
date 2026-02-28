# Crisis Grid 🌍
AI-powered real-time disaster relief logistics and resource coordination platform.

Crisis Grid connects **Food Donors, NGOs, Delivery Assistants, and Government Authorities** into a single operational map to enable fast, intelligent, and transparent last-mile relief delivery during emergencies.

---

## 🚀 Core Idea

During disasters:

- Food exists but doesn’t reach people
- NGOs don’t know where resources are
- Volunteers don’t know where to go
- Roads are blocked or flooded
- There is no real-time visibility

Crisis Grid converts **unstructured relief efforts → mission-driven logistics with live spatial intelligence.**

---

## 👥 User Roles

### 🥗 Food Donor
- Upload surplus food
- Provide quantity, expiry time, pickup location
- Track impact (people served, missions completed)

### 🏥 NGO / Relief Organization
- Request food using natural workflow
- View nearby available resources
- Trigger delivery missions

### 🚚 Delivery Assistant
- View prioritized missions
- Accept and execute missions
- Navigate using obstacle-aware routing
- See live environment alerts on map

### 🏛 Government Authority
- Draw flood zones (polygons)
- Mark blocked roads (polylines)
- Real-time control-room style disaster updates

---

## 🗺 Key Features

### 📍 Mission-Based Logistics
When a mission is accepted:

Delivery → Donor → NGO

System shows:

- Live delivery location
- Optimized route
- Flood & roadblock aware navigation

---

### 🌊 Disaster Intelligence Map

Live layers:

- Flood zones (severity based)
- Blocked roads
- Resource locations
- Active missions
- Request density heatmap

All updates sync in **real time using Socket.IO**.

---

### 🧠 Intelligent Route Selection

Routes are selected based on:

- Distance
- Flood severity penalty
- Roadblock avoidance
- Mission urgency

---

### ⏱ Food Expiry Countdown

Once a mission is accepted:

- Expiry timer starts
- Delivery is prioritized accordingly

---

### 📡 Real-Time Tracking

Public tracking link shows:

- Current delivery location
- Pickup point
- Destination
- Mission status

---

## 🏗 Tech Stack

### Frontend
- React
- Leaflet.js
- Leaflet Draw
- Socket.IO Client

### Backend
- Node.js
- Express.js
- MongoDB Atlas
- Mongoose
- Socket.IO

### Maps & Routing
- OpenStreetMap
- OSRM (routing engine)

---

## 🗄 Database Design

### Core Collections

**Users**
- donor | ngo | delivery | government

**Donations**
- Food details
- Pickup GeoJSON
- Status tracking

**Missions**
- Delivery lifecycle
- Assigned delivery assistant

**EnvironmentLayers**
- flood / roadblock
- GeoJSON geometry
- Severity
- isActive flag

---

## 🔄 Real-Time Architecture

1. Government draws flood / roadblock
2. Backend stores GeoJSON
3. Socket event emitted
4. All delivery dashboards update instantly

---

## 🧭 Application Flow

### Food Donation Flow
Donor → Upload food → Appears on map → NGO claims → Mission created

### Mission Execution Flow
Delivery accepts → Route computed → Pickup → Drop → Impact updated

### Government Control Flow
Draw alert → Save → Live update on all maps

---

## ⚙️ Local Setup

### 1️⃣ Clone repo

```bash
git clone https://github.com/Adhithyan-C/crisis-grid.git
cd crisis-grid

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
