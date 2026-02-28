import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import LandingPage from './pages/LandingPage';
import RolePage from './pages/RolePage';
import AuthPage from './pages/AuthPage';
import DonorDashboard from './pages/DonorDashboard';
import NgoDashboard from './pages/NgoDashboard';
import DeliveryDashboard from './pages/DeliveryDashboard';
import GovernmentDashboard from './pages/GovernmentDashboard';

const DashboardRedirect = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  if (user.role === 'donor') return <Navigate to="/donor" replace />;
  if (user.role === 'ngo') return <Navigate to="/ngo" replace />;
  if (user.role === 'delivery') return <Navigate to="/delivery" replace />;
  if (user.role === 'government') return <Navigate to="/government" replace />;
  return <Navigate to="/" replace />;
};

const AppRoutes = () => {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/role" element={<RolePage />} />
        <Route path="/auth/:role" element={<AuthPage />} />
        <Route path="/dashboard" element={<DashboardRedirect />} />
        <Route
          path="/donor"
          element={
            <ProtectedRoute role="donor">
              <DonorDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ngo"
          element={
            <ProtectedRoute role="ngo">
              <NgoDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/delivery"
          element={
            <ProtectedRoute role="delivery">
              <DeliveryDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/government"
          element={
            <ProtectedRoute role="government">
              <GovernmentDashboard />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};

import { GoogleOAuthProvider } from '@react-oauth/google';

const App = () => {
  return (
    <GoogleOAuthProvider clientId="97861407440-p7lfq1ojs3hvvq6rhq7u6elj0sfk3502.apps.googleusercontent.com">
      <AuthProvider>
        <Router>
          <AppRoutes />
        </Router>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
};

export default App;
