import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import PropTypes from 'prop-types';
import LoginForm from '../components/LoginForm';

const LoginPage = ({ onLogin, onVerifyMfa }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mfaStep, setMfaStep] = useState(false);
  const [tempToken, setTempToken] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.state?.accessDisabled) {
      setError('Доступ ограничен администратором');
      navigate('/login', { replace: true, state: {} });
    }
  }, [location.state, navigate]);

  const handleSubmit = async (credentials) => {
    try {
      setLoading(true);
      setError(null);
      const result = await onLogin(credentials);
      if (result?.mfaRequired) {
        setMfaStep(true);
        setTempToken(result.tempToken);
        return;
      }

      navigate('/chats');
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'ACCESS_DISABLED') {
        setError('Доступ ограничен администратором');
      } else {
        setError(err.response?.data?.error || 'Не удалось войти');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (event) => {
    event.preventDefault();
    if (!tempToken) return;

    try {
      setLoading(true);
      setError(null);
      await onVerifyMfa({ tempToken, code: mfaCode });
      navigate('/chats');
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'ACCESS_DISABLED') {
        setError('Доступ ограничен администратором');
      } else {
        setError(err.response?.data?.error || 'Не удалось подтвердить код');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="auth-panel">
        <h1>Добро пожаловать в MediChat</h1>
        <p className="auth-subtitle">Войдите под корпоративным аккаунтом, чтобы продолжить общение.</p>
        {!mfaStep && <LoginForm onSubmit={handleSubmit} loading={loading} error={error} />}
        {mfaStep && (
          <form onSubmit={handleMfaSubmit} className="auth-card">
            <h2>Подтверждение входа</h2>
            <p className="muted">Введите 6-значный код из приложения-аутентификатора или резервный код.</p>
            <label className="field">
              Код 2FA
              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.trim())}
                required
                maxLength={10}
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <div className="btn-row">
              <button type="button" className="secondary-btn" onClick={() => window.location.reload()} disabled={loading}>
                Назад
              </button>
              <button type="submit" className="primary-btn" disabled={loading || !mfaCode}>
                {loading ? 'Проверяем...' : 'Подтвердить'}
              </button>
            </div>
          </form>
        )}
        <p className="auth-switch">
          Нет аккаунта? <Link to="/register">Зарегистрируйтесь</Link>
        </p>
      </div>
    </div>
  );
};

LoginPage.propTypes = {
  onLogin: PropTypes.func.isRequired,
  onVerifyMfa: PropTypes.func.isRequired,
};

export default LoginPage;
