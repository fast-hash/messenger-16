import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ChatsPage from './pages/ChatsPage';
import DevicesPage from './pages/DevicesPage';
import SecurityPage from './pages/SecurityPage';
import { useAuthStore } from './store/authStore';
import { initNotificationSound } from './utils/notifications';
import './styles.css';

const AppContent = () => {
  const { user, loading, fetchCurrentUser, login, register, verifyMfaLogin } = useAuthStore();

  useEffect(() => {
    fetchCurrentUser();
    initNotificationSound();
  }, [fetchCurrentUser]);

  if (loading) {
    return <div className="centered muted">Загрузка...</div>;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={!user ? <LoginPage onLogin={login} onVerifyMfa={verifyMfaLogin} /> : <Navigate to="/chats" replace />}
      />
      <Route
        path="/register"
        element={!user ? <RegisterPage onRegister={register} /> : <Navigate to="/chats" replace />}
      />
      <Route path="/chats" element={user ? <ChatsPage /> : <Navigate to="/login" replace />} />
      <Route path="/devices" element={user ? <DevicesPage /> : <Navigate to="/login" replace />} />
      <Route path="/security" element={user ? <SecurityPage /> : <Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to={user ? '/chats' : '/login'} replace />} />
    </Routes>
  );
};

const App = () => (
  <BrowserRouter>
    <AppContent />
  </BrowserRouter>
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
