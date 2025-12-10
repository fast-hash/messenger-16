import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import UserPicker from './UserPicker';
import { formatRole } from '../utils/roleLabels';
import { getGroupDetails, addParticipant, removeParticipant, renameGroup, approveJoin, rejectJoin } from '../api/chatApi';

const GroupManageModal = ({ isOpen, chatId, onClose, users, onUpdated, openConfirm, onUpdateModeration }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [selectedToAdd, setSelectedToAdd] = useState([]);
  const [canManage, setCanManage] = useState(false);

  const load = async () => {
    if (!chatId) return;
    setLoading(true);
    setError('');
    try {
      const res = await getGroupDetails(chatId);
      setData(res.chat);
      setTitle(res.chat.title || '');
      setCanManage(!!res.canManage);
      onUpdated(res.chat);
    } catch (err) {
      setError('Не удалось загрузить данные группы');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      load();
    }
  }, [isOpen, chatId]);

  if (!isOpen) return null;

  const handleRename = async () => {
    try {
      await renameGroup(chatId, title);
      await load();
    } catch (err) {
      console.error(err);
      setError('Не удалось сохранить название группы');
    }
  };

  const handleAdd = async () => {
    if (!selectedToAdd.length) return;
    const userId = selectedToAdd[0];
    try {
      await addParticipant(chatId, userId);
      await load();
    } catch (err) {
      console.error(err);
      setError('Не удалось добавить участника. Попробуйте ещё раз.');
    } finally {
      setSelectedToAdd([]);
    }
  };

  const handleModerationUpdate = (payload) => {
    if (!chatId) return;
    setError('');
    openConfirm('Сохранить настройки модерации?', async () => {
      try {
        await onUpdateModeration(chatId, payload);
        await load();
      } catch (err) {
        setError('Не удалось обновить модерацию');
      }
    });
  };

  const handleMutePreset = async (minutes) => {
    const until = minutes ? new Date(Date.now() + minutes * 60 * 1000).toISOString() : null;
    await handleModerationUpdate({ muteUntil: until });
  };

  const handleRateLimitPreset = async (limit) => {
    await handleModerationUpdate({ rateLimitPerMinute: limit });
  };

  const handleRemove = async (participant) => {
    openConfirm(
      `Удалить участника ${participant.displayName || participant.username} из группы?`,
      async () => {
        await removeParticipant(chatId, participant.id);
        await load();
      }
    );
  };

  const handleApprove = async (req) => {
    try {
      await approveJoin(chatId, req.id);
      await load();
    } catch (err) {
      console.error(err);
      setError('Не удалось принять заявку');
    }
  };

  const handleReject = async (req) => {
    try {
      await rejectJoin(chatId, req.id);
      await load();
    } catch (err) {
      console.error(err);
      setError('Не удалось отклонить заявку');
    }
  };

  const muteUntilText = data?.muteUntil ? new Date(data.muteUntil).toLocaleString() : null;
  const rateLimitPerMinute = data?.rateLimitPerMinute || null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal large" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>Управление группой</h3>
          <button type="button" className="secondary-btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {loading && <p className="muted">Загрузка...</p>}
        {error && <p className="warning">{error}</p>}
        {data && (
          <div className="modal-body-scroll">
            <div className="group-manage-grid">
              <div className="group-manage-column">
                <div className="group-manage-card">
                  <label className="field">
                    Название группы
                    <input
                      type="text"
                      className="field-input"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => openConfirm(`Переименовать группу в "${title}"?`, handleRename)}
                  >
                    Сохранить название
                  </button>
                </div>

                {canManage && (
                  <div className="group-manage-card">
                    <div className="chat-window__moderation">
                      <div className="chat-window__moderation-title">Модерация</div>
                      <div className="chat-window__moderation-row">
                        <span>Mute:</span>
                        <button type="button" className="secondary-btn" onClick={() => handleMutePreset(15)}>
                          15 мин
                        </button>
                        <button type="button" className="secondary-btn" onClick={() => handleMutePreset(60)}>
                          1 час
                        </button>
                        <button type="button" className="secondary-btn" onClick={() => handleMutePreset(null)}>
                          Снять
                        </button>
                        {muteUntilText && <span className="muted">до {muteUntilText}</span>}
                      </div>

                      <div className="chat-window__moderation-row">
                        <span>Лимит:</span>
                        {[1, 2, 5].map((limit) => (
                          <button
                            key={`limit-${limit}`}
                            type="button"
                            className={`secondary-btn ${rateLimitPerMinute === limit ? 'secondary-btn--active' : ''}`}
                            onClick={() => handleRateLimitPreset(limit)}
                          >
                            {limit}/мин
                          </button>
                        ))}
                        <button type="button" className="secondary-btn" onClick={() => handleRateLimitPreset(null)}>
                          Без лимита
                        </button>
                        {rateLimitPerMinute && <span className="muted">текущий: {rateLimitPerMinute}/мин</span>}
                      </div>
                    </div>
                  </div>
                )}

                <div className="group-manage-card">
                  <h4>Заявки на вступление</h4>
                  <div className="list-scroll">
                    {data.joinRequests?.length ? (
                      data.joinRequests.map((req) => (
                        <div key={req.id} className="participant-row">
                          <div>
                            <div className="participant-name">{req.displayName || req.username}</div>
                            <div className="participant-meta">{formatRole(req.role)} · {req.email}</div>
                          </div>
                          <div className="btn-row">
                            <button type="button" className="primary-btn" onClick={() => handleApprove(req)}>
                              Принять
                            </button>
                            <button type="button" className="secondary-btn" onClick={() => handleReject(req)}>
                              Отклонить
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="muted">Заявок нет</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="group-manage-column">
                <div className="group-manage-card">
                  <h4>Участники</h4>
                  <div className="list-scroll">
                    {data.participants.map((participant) => {
                      const isCreator = participant.id === data.createdBy;
                      const isAdmin = (data.admins || []).includes(participant.id);
                      const canRemove = !isCreator && !isAdmin;
                      return (
                        <div key={participant.id} className="participant-row">
                          <div>
                            <div className="participant-name">{participant.displayName || participant.username}</div>
                            <div className="participant-meta">
                              {formatRole(participant.role)} · {participant.department || 'Отдел не указан'} · {participant.email}
                            </div>
                          </div>
                          {canRemove && (
                            <button type="button" className="secondary-btn" onClick={() => handleRemove(participant)}>
                              Удалить
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {!data.participants.length && <p className="muted">Нет участников</p>}
                  </div>
                </div>

                <div className="group-manage-card">
                  <h4>Добавить участника</h4>
                  <UserPicker
                    mode="single"
                    users={users}
                    selectedIds={selectedToAdd}
                    onChange={(ids) => setSelectedToAdd(ids)}
                    excludeIds={data.participants.map((p) => p.id)}
                  />
                  <button type="button" className="primary-btn" onClick={handleAdd} disabled={!selectedToAdd.length}>
                    Добавить
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

GroupManageModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  chatId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  users: PropTypes.arrayOf(PropTypes.object).isRequired,
  onUpdated: PropTypes.func,
  openConfirm: PropTypes.func.isRequired,
  onUpdateModeration: PropTypes.func,
};

GroupManageModal.defaultProps = {
  chatId: null,
  onUpdated: () => {},
  onUpdateModeration: () => {},
};

export default GroupManageModal;
