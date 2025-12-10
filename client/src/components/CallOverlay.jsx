import { useEffect, useRef } from 'react';
import { useCallStore } from '../store/callStore';

const CallOverlay = () => {
  const {
    status,
    peerUser,
    error,
    muted,
    remoteStream,
    localStream,
    acceptIncoming,
    declineIncoming,
    cancelOutgoing,
    hangup,
    toggleMute,
    clearError,
  } = useCallStore();

  const remoteAudioRef = useRef(null);
  const localAudioRef = useRef(null);

  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localAudioRef.current && localStream) {
      localAudioRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const renderBanner = () => {
    if (status === 'incoming') {
      return (
        <div className="call-banner">
          <div>
            <div className="call-banner__title">Входящий звонок</div>
            <div className="call-banner__subtitle">{peerUser?.name || 'Собеседник'}</div>
          </div>
          <div className="call-banner__actions">
            <button type="button" className="primary-btn" onClick={acceptIncoming}>
              Принять
            </button>
            <button type="button" className="danger-btn" onClick={declineIncoming}>
              Отклонить
            </button>
          </div>
        </div>
      );
    }

    if (status === 'outgoing') {
      return (
        <div className="call-banner">
          <div>
            <div className="call-banner__title">Идёт вызов…</div>
            <div className="call-banner__subtitle">{peerUser?.name || 'Собеседник'}</div>
          </div>
          <div className="call-banner__actions">
            <button type="button" className="secondary-btn" onClick={cancelOutgoing}>
              Отменить
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <>
      {error && (
        <div className="call-toast">
          <span>{error}</span>
          <button type="button" className="icon-btn" onClick={clearError} aria-label="Закрыть">
            ✕
          </button>
        </div>
      )}

      {status !== 'idle' && renderBanner()}

      {status === 'in-call' && (
        <div className="call-window">
          <div className="call-window__header">MediChat</div>
          <div className="call-window__body">
            <div className="call-window__title">Аудио-звонок</div>
            <div className="call-window__peer">{peerUser?.name || 'Собеседник'}</div>
            <div className="call-window__status">Звонок активен</div>
          </div>
          <div className="call-window__controls">
            <button type="button" className="secondary-btn" onClick={toggleMute}>
              {muted ? 'Включить микрофон' : 'Выключить звук у себя'}
            </button>
            <button type="button" className="danger-btn" onClick={hangup}>
              Завершить
            </button>
          </div>
          <audio ref={remoteAudioRef} autoPlay />
          <audio ref={localAudioRef} autoPlay muted />
        </div>
      )}
    </>
  );
};

export default CallOverlay;
