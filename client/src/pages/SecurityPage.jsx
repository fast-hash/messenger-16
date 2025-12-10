import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { setupMfa, enableMfa, disableMfa, fetchBackupCodes } from '../api/authApi';
import { requestE2EIdentityReset, fetchE2EIdentityReset } from '../api/securityApi';
import { useAuthStore } from '../store/authStore';

const SecurityPage = () => {
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const [setupInfo, setSetupInfo] = useState(null);
  const [enableCode, setEnableCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [resetRequest, setResetRequest] = useState(null);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  useEffect(() => {
    fetchE2EIdentityReset()
      .then(({ request }) => setResetRequest(request || null))
      .catch(() => setResetRequest(null));
  }, []);

  const startSetup = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await setupMfa();
      setSetupInfo(data);
      setBackupCodes([]);
      setMessage('Секрет создан. Отсканируйте QR и подтвердите код.');
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось начать настройку 2FA');
    } finally {
      setLoading(false);
    }
  };

  const handleEnable = async (event) => {
    event.preventDefault();
    if (!enableCode) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const { user: updatedUser, backupCodes: codes } = await enableMfa(enableCode);
      setUser(updatedUser);
      setBackupCodes(codes || []);
      setSetupInfo(null);
      setEnableCode('');
      setMessage('Двухфакторная аутентификация включена');
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось включить 2FA');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async (event) => {
    event.preventDefault();
    if (!disableCode) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const { user: updatedUser } = await disableMfa(disableCode);
      setUser(updatedUser);
      setBackupCodes([]);
      setDisableCode('');
      setMessage('Двухфакторная аутентификация отключена');
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось отключить 2FA');
    } finally {
      setLoading(false);
    }
  };

  const loadBackupCodes = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const { codes } = await fetchBackupCodes();
      setBackupCodes(codes || []);
      if (!codes?.length) {
        setMessage('Резервные коды отсутствуют, включите MFA заново для генерации.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось загрузить резервные коды');
    } finally {
      setLoading(false);
    }
  };

  const requestReset = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const { request } = await requestE2EIdentityReset();
      setResetRequest(request || null);
      setMessage('Запрос на сброс E2E отправлен. Дождитесь одобрения администратора.');
    } catch (err) {
      setError(err.response?.data?.message || 'Не удалось отправить запрос на сброс E2E');
    } finally {
      setLoading(false);
    }
  };

  const header = (
    <div className="header-content">
      <div>
        <div className="app-title">Безопасность</div>
        <div className="app-subtitle">Управление двухфакторной аутентификацией</div>
      </div>
      <div className="header-user">
        <button type="button" className="secondary-btn" onClick={() => navigate('/chats')}>
          Назад к чатам
        </button>
      </div>
    </div>
  );

  return (
    <Layout header={header}>
      <div className="page-container">
      <div className="card">
        <div className="card__header">
          <div>
            <h3>Статус 2FA</h3>
            <p className="muted">Дополнительная защита учетной записи через одноразовые коды.</p>
            </div>
            <div>
              {user?.mfaEnabled ? (
                <span className="badge badge-success">2FA ON</span>
              ) : (
                <span className="badge">2FA OFF</span>
              )}
            </div>
          </div>

          {message && <div className="form-success">{message}</div>}
          {error && <div className="form-error">{error}</div>}

          {!user?.mfaEnabled && (
            <div className="grid two-cols">
              <div>
                <h4>Шаг 1. Создайте секрет</h4>
                <p className="muted">Нажмите кнопку, чтобы сгенерировать секрет и QR-код для приложения (Google Authenticator, 1Password и др.).</p>
                <button type="button" className="secondary-btn" onClick={startSetup} disabled={loading}>
                  Сгенерировать секрет
                </button>
                {setupInfo && (
                  <div className="card qr-card">
                    <h5>QR-код для сканирования</h5>
                    <img src={setupInfo.qrCodeDataURL} alt="QR для 2FA" className="qr-image" />
                    <p className="muted">Ручной ввод: {setupInfo.secret}</p>
                  </div>
                )}
              </div>
              <div>
                <h4>Шаг 2. Подтвердите код</h4>
                <p className="muted">Введите текущий код из приложения, чтобы включить защиту.</p>
                <form onSubmit={handleEnable} className="stacked-form">
                  <input
                    type="text"
                    value={enableCode}
                    onChange={(e) => setEnableCode(e.target.value.trim())}
                    placeholder="6-значный код"
                    maxLength={10}
                    required
                    disabled={loading}
                  />
                  <button type="submit" className="primary-btn" disabled={loading || !enableCode}>
                    {loading ? 'Сохраняем...' : 'Включить 2FA'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {user?.mfaEnabled && (
            <div className="grid two-cols">
              <div>
                <h4>Резервные коды</h4>
                <p className="muted">Сохраните эти коды в безопасном месте. Каждый код можно использовать один раз.</p>
                <div className="backup-codes">
                  {backupCodes.map((code) => (
                    <code key={code} className="backup-code">
                      {code}
                    </code>
                  ))}
                  {!backupCodes.length && <div className="muted">Нажмите кнопку, чтобы отобразить резервные коды.</div>}
                </div>
                <button type="button" className="secondary-btn" onClick={loadBackupCodes} disabled={loading}>
                  Показать резервные коды
                </button>
              </div>
              <div>
                <h4>Отключить 2FA</h4>
                <p className="muted">Введите код из приложения или резервный код, чтобы отключить MFA.</p>
                <form onSubmit={handleDisable} className="stacked-form">
                  <input
                    type="text"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.trim())}
                    placeholder="Код 2FA"
                    maxLength={10}
                    required
                    disabled={loading}
                  />
                  <button type="submit" className="danger-btn" disabled={loading || !disableCode}>
                    {loading ? 'Отключаем...' : 'Выключить 2FA'}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card danger-card">
        <div className="card__header">
          <div>
            <h3>Опасная зона</h3>
            <p className="muted">
              Запрос на сброс ключей шифрования. Вы потеряете доступ к старой истории E2E на этом устройстве.
            </p>
          </div>
          <div>
            {resetRequest?.status === 'pending' && <span className="badge">Запрос отправлен</span>}
            {resetRequest?.status === 'approved' && <span className="badge badge-success">Одобрено</span>}
            {resetRequest?.status === 'rejected' && <span className="badge badge-error">Отклонено</span>}
          </div>
        </div>
        <div className="stacked-form">
          <div className="warning-text">
            Это действие сбросит вашу текущую E2E-личность. Сообщения, зашифрованные старыми ключами, могут стать
            недоступными на этом устройстве.
          </div>
          {resetRequest?.status === 'pending' ? (
            <div className="muted">Ожидается подтверждение администратора...</div>
          ) : (
            <button type="button" className="danger-btn" onClick={requestReset} disabled={loading}>
              {loading ? 'Отправляем...' : 'Запросить сброс шифрования'}
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default SecurityPage;
