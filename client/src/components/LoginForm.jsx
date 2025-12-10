import { useState } from 'react';
import PropTypes from 'prop-types';

const LoginForm = ({ onSubmit, loading, error }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit({ email, password });
  };

  return (
    <form onSubmit={handleSubmit} className="auth-card">
      <h2>Вход</h2>
      <label className="field">
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        Пароль
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <div className="form-error">{error}</div>}
      <button type="submit" className="primary-btn" disabled={loading}>
        {loading ? 'Входим...' : 'Войти'}
      </button>
    </form>
  );
};

LoginForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  loading: PropTypes.bool,
  error: PropTypes.string,
};

LoginForm.defaultProps = {
  loading: false,
  error: null,
};

export default LoginForm;
