import { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import UserPicker from './UserPicker';
import httpClient from '../api/httpClient';

const statusLabel = (status) => {
  switch (status) {
    case 'owner':
      return 'владелец';
    case 'admin':
      return 'администратор';
    case 'member':
      return 'участник';
    case 'pending':
      return 'заявка отправлена';
    default:
      return 'можно присоединиться';
  }
};

const GroupDirectoryModal = ({
  isOpen,
  onClose,
  isAdmin,
  users,
  groups,
  loading,
  selectedIds,
  onChangeSelected,
  onCreateGroup,
  onRequestJoin,
  onOpenChat,
  onManage,
  groupTitle,
  onTitleChange,
  currentUserId,
  onConfirm,
  onBack,
}) => {
  if (!isOpen) return null;

  const isMemberStatuses = new Set(['owner', 'admin', 'member']);
  const availableGroups = groups.filter((group) => !isMemberStatuses.has(group.membershipStatus));
  const [titleStatus, setTitleStatus] = useState('idle');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredGroups = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return availableGroups;
    return availableGroups.filter((group) => (group.title || '').toLowerCase().includes(query));
  }, [availableGroups, searchTerm]);

  useEffect(() => {
    const trimmed = groupTitle.trim();
    if (!trimmed) {
      setTitleStatus('idle');
      return undefined;
    }

    setTitleStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const { data } = await httpClient.post('/api/chats/check-title', { title: trimmed });
        setTitleStatus(data.isAvailable ? 'available' : 'taken');
      } catch (error) {
        console.error(error);
        setTitleStatus('idle');
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [groupTitle]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal large" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header modal__header--with-back">
          <div className="header-actions">
            {onBack && (
              <button type="button" className="secondary-btn" onClick={onBack}>
                Назад
              </button>
            )}
            <h3>Групповые чаты</h3>
          </div>
          <button type="button" className="secondary-btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {loading && <p className="muted">Загрузка групп...</p>}
        {!loading && (
          <div className="modal-body-scroll">
            {isAdmin ? (
              <div className="group-column">
                <h4>Создать группу</h4>
                <label className="field">
                  Название группы
                  <input
                    type="text"
                    className="field-input"
                    style={{
                      borderColor:
                        titleStatus === 'taken'
                          ? '#ef4444'
                          : titleStatus === 'available'
                          ? '#22c55e'
                          : undefined,
                    }}
                    value={groupTitle}
                    onChange={(e) => onTitleChange(e.target.value)}
                  />
                  {titleStatus === 'checking' && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Проверка...
                    </div>
                  )}
                  {titleStatus === 'available' && (
                    <div style={{ color: '#22c55e', fontSize: 12 }}>Название свободно</div>
                  )}
                  {titleStatus === 'taken' && (
                    <div style={{ color: '#ef4444', fontSize: 12 }}>Данная группа уже существует</div>
                  )}
                </label>
                <UserPicker
                  mode="multi"
                  users={users}
                  selectedIds={selectedIds}
                  onChange={onChangeSelected}
                  excludeIds={[currentUserId]}
                />
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() =>
                    onConfirm(`Вы действительно хотите создать группу "${groupTitle}"?`, onCreateGroup)
                  }
                  disabled={!groupTitle.trim() || titleStatus !== 'available'}
                >
                  Создать группу
                </button>
              </div>
            ) : (
              <div className="group-list single-column group-list-scroll">
                <p className="muted">
                  Вы можете подать заявку на вступление в рабочие группы вашей клиники.
                </p>
                <input
                  type="text"
                  className="field-input"
                  placeholder="Поиск по группам"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ marginBottom: 12 }}
                />
                {filteredGroups.map((group) => {
                  const isPending = group.membershipStatus === 'pending';
                  return (
                    <div key={group.id} className="group-card">
                      <div>
                        <div className="group-card__title">{group.title}</div>
                        <div className="group-card__meta">Участников: {group.participantsCount}</div>
                      </div>
                      <div className="btn-row">
                        <button
                          type="button"
                          className={`secondary-btn${isPending ? ' disabled' : ''}`}
                          onClick={() => onRequestJoin(group)}
                          disabled={isPending}
                        >
                          {isPending ? 'Заявка отправлена' : 'Отправить заявку'}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {!filteredGroups.length && (
                  <p className="muted">Нет доступных групп для подачи заявки.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

GroupDirectoryModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  isAdmin: PropTypes.bool.isRequired,
  users: PropTypes.arrayOf(PropTypes.object).isRequired,
  groups: PropTypes.arrayOf(PropTypes.object).isRequired,
  loading: PropTypes.bool,
  selectedIds: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChangeSelected: PropTypes.func.isRequired,
  onCreateGroup: PropTypes.func.isRequired,
  onRequestJoin: PropTypes.func.isRequired,
  onOpenChat: PropTypes.func.isRequired,
  onManage: PropTypes.func.isRequired,
  groupTitle: PropTypes.string.isRequired,
  onTitleChange: PropTypes.func.isRequired,
  currentUserId: PropTypes.string.isRequired,
  onConfirm: PropTypes.func.isRequired,
  onBack: PropTypes.func,
};

GroupDirectoryModal.defaultProps = {
  loading: false,
  onBack: null,
};

export default GroupDirectoryModal;
