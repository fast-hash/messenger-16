import { useState } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import RegisterForm from '../components/RegisterForm';

const RegisterPage = ({ onRegister }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState('');

  const handleSubmit = async (payload) => {
    try {
      setLoading(true);
      setError(null);
      setSuccess('');
      const { message } = await onRegister(payload);
      setSuccess(message || 'Заявка отправлена администратору');
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось зарегистрироваться');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="auth-panel">
        <h1>Создайте рабочий профиль</h1>
        <p className="auth-subtitle">Укажите роль и отдел, чтобы коллеги нашли вас быстрее.</p>
        <RegisterForm onSubmit={handleSubmit} loading={loading} error={error} successMessage={success} />
        <p className="auth-switch">
          Уже есть аккаунт? <Link to="/login">Войдите</Link>
        </p>
      </div>
    </div>
  );
};

RegisterPage.propTypes = {
  onRegister: PropTypes.func.isRequired,
};

export default RegisterPage;
