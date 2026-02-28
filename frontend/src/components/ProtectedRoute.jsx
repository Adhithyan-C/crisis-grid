import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ children, role }) => {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="spinner-wrap" style={{ minHeight: '100vh' }}>
                <div className="spinner" />
            </div>
        );
    }

    if (!user) return <Navigate to="/" replace />;
    if (role && user.role !== role) {
        const roleHome = { donor: '/donor', ngo: '/ngo', delivery: '/delivery', government: '/government' };
        return <Navigate to={roleHome[user.role] || '/'} replace />;
    }

    return children;
};

export default ProtectedRoute;
