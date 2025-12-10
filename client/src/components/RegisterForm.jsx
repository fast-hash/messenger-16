import { useState } from 'react';
import PropTypes from 'prop-types';
import { ROLE_OPTIONS } from '../utils/roleLabels';

const RegisterForm = ({ onSubmit, loading, error, successMessage }) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('staff');
  const [department, setDepartment] = useState('');
  const [jobTitle, setJobTitle] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit({ username, email, password, displayName, role, department, jobTitle });
  };

  return (
    <form onSubmit={handleSubmit} className="auth-card">
      <h2>Регистрация</h2>
      <label className="field">
        Имя пользователя
        <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label className="field">
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        Пароль
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <label className="field">
        Отображаемое имя
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="field">
        Роль
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Отдел
        <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Кардиология, Регистратура" />
      </label>
      <label className="field">
        Должность
        <input type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Кардиолог, Регистратор" />
      </label>
      {successMessage && <div className="form-success">{successMessage}</div>}
      {error && <div className="form-error">{error}</div>}
      <button type="submit" className="primary-btn" disabled={loading}>
        {loading ? 'Регистрируем...' : 'Зарегистрироваться'}
      </button>
    </form>
  );
};

RegisterForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  loading: PropTypes.bool,
  error: PropTypes.string,
  successMessage: PropTypes.string,
};

RegisterForm.defaultProps = {
  loading: false,
  error: null,
  successMessage: '',
};

export default RegisterForm;
