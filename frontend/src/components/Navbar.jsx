import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar = () => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    return (
        <nav className="navbar">
            <div className="navbar-inner">
                <Link to="/" className="navbar-logo">
                    <img src={`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/uploads/logo.webp`} alt="" className="navbar-logo-img" />
                    Crisis<span>Grid</span>
                </Link>
                <div className="navbar-actions">
                    {user ? (
                        <>
                            <div className="navbar-user">
                                <span className="navbar-user-name">{user.name?.split(' ')[0]}</span>
                                <span className={`navbar-user-role ${user.role === 'donor' ? 'role-donor' : user.role === 'ngo' ? 'role-ngo' : 'role-delivery'}`}>
                                    {user.role}
                                </span>
                            </div>
                            <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
                                Sign Out
                            </button>
                        </>
                    ) : (
                        <>
                            <Link to="/" className="btn btn-ghost btn-sm">Home</Link>
                            <Link to="/role" className="btn btn-primary btn-sm">Get Started</Link>
                        </>
                    )}
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
