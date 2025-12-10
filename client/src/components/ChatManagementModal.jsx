import { useState } from 'react';
import PropTypes from 'prop-types';
import { formatRole } from '../utils/roleLabels';

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

const describeBlocks = (chat) => {
  if (!chat.blocks?.length) return 'Блокировок нет';
  const [first, second] = chat.participants || [];
  if (!first || !second) return 'Участники не найдены';
  const byFirst = chat.blocks.some((b) => b.by === first.id && b.target === second.id);
  const bySecond = chat.blocks.some((b) => b.by === second.id && b.target === first.id);

  if (byFirst && bySecond) return 'Взаимная блокировка';
  if (byFirst) return `${first.displayName || first.username} заблокировал(а) ${second.displayName || second.username}`;
  if (bySecond) return `${second.displayName || second.username} заблокировал(а) ${first.displayName || first.username}`;
  return 'Блокировки не активны';
};

const ChatManagementModal = ({
  isOpen,
  onClose,
  groups,
  groupsLoading,
  onOpenGroup,
  onManageGroup,
  directChats,
  directLoading,
  onClearBlocks,
  adminUsers,
  adminUsersLoading,
  registrationRequests,
  registrationLoading,
  onDisableUser,
  onEnableUser,
  onAllowNextDevice,
  onResetMfa,
  onApproveRequest,
  onRejectRequest,
  notice,
}) => {
  const [tab, setTab] = useState('groups');

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal large" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="header-actions">
            <button
              type="button"
              className={`secondary-btn ${tab === 'groups' ? 'active' : ''}`}
              onClick={() => setTab('groups')}
            >
              Группы
            </button>
            <button
              type="button"
              className={`secondary-btn ${tab === 'direct' ? 'active' : ''}`}
              onClick={() => setTab('direct')}
            >
              Личные чаты
            </button>
            <button
              type="button"
              className={`secondary-btn ${tab === 'users' ? 'active' : ''}`}
              onClick={() => setTab('users')}
            >
              Пользователи
            </button>
            <button
              type="button"
              className={`secondary-btn ${tab === 'requests' ? 'active' : ''}`}
              onClick={() => setTab('requests')}
            >
              Заявки на регистрацию
            </button>
          </div>
          <button type="button" className="secondary-btn" onClick={onClose}>
            Закрыть
          </button>
        </div>
        {notice && <div className="notice-banner">{notice}</div>}
        {tab === 'groups' && (
          <div className="modal-body-scroll">
            {groupsLoading && <p className="muted">Загрузка групп...</p>}
            {!groupsLoading && (
              <div className="group-list group-list-scroll">
                {groups.map((group) => (
                  <div key={group.id} className="group-card">
                    <div>
                      <div className="group-card__title">{group.title}</div>
                      <div className="group-card__meta">Участников: {group.participantsCount}</div>
                      <div className="group-card__meta">Статус: {statusLabel(group.membershipStatus)}</div>
                    </div>
                    <div className="btn-row">
                      <button type="button" className="primary-btn" onClick={() => onOpenGroup(group.id)}>
                        Открыть
                      </button>
                      <button type="button" className="secondary-btn" onClick={() => onManageGroup(group.id)}>
                        Управлять
                      </button>
                    </div>
                  </div>
                ))}
                {!groups.length && <p className="muted">Группы пока не созданы</p>}
              </div>
            )}
          </div>
        )}

        {tab === 'direct' && (
          <div className="modal-body-scroll">
            {directLoading && <p className="muted">Загрузка личных чатов...</p>}
            {!directLoading && (
              <div className="group-list">
                {directChats.map((chat) => (
                  <div key={chat.id} className="group-card">
                    <div>
                      <div className="group-card__title">
                        {(chat.participants || [])
                          .map((p) => p.displayName || p.username)
                          .filter(Boolean)
                          .join(' — ')}
                      </div>
                      <div className="group-card__meta">
                        {(chat.participants || []).map((p) => formatRole(p.role)).join(' · ')}
                      </div>
                      <div className="group-card__meta">{describeBlocks(chat)}</div>
                    </div>
                    <div className="btn-row">
                      {chat.blocks?.length ? (
                        <button type="button" className="secondary-btn" onClick={() => onClearBlocks(chat.id)}>
                          Снять блокировку
                        </button>
                      ) : (
                        <span className="muted">Блокировок нет</span>
                      )}
                    </div>
                  </div>
                ))}
                {!directChats.length && <p className="muted">Личные чаты отсутствуют</p>}
              </div>
            )}
          </div>
        )}

        {tab === 'users' && (
          <div className="modal-body-scroll">
            {adminUsersLoading && <p className="muted">Загрузка пользователей...</p>}
            {!adminUsersLoading && (
              <div className="group-list group-list-scroll">
                {adminUsers.map((item) => (
                  <div key={item.id} className="group-card">
                    <div>
                      <div className="group-card__title">{item.displayName || item.username}</div>
                      <div className="group-card__meta">{item.email}</div>
                      <div className="group-card__meta">{formatRole(item.role)} · {item.department || 'Отдел не указан'}</div>
                      <div className="group-card__meta">Статус: {item.accessDisabled ? 'Доступ ограничен' : 'Активен'}</div>
                      <div className="group-card__meta">
                        MFA:{' '}
                        {item.mfaEnabled ? (
                          <span className="badge badge-success">2FA ON</span>
                        ) : (
                          <span className="badge">2FA OFF</span>
                        )}
                      </div>
                      {item.forceTrustNextDevice && (
                        <div className="group-card__meta">Следующее устройство будет доверенным автоматически</div>
                      )}
                    </div>
                    <div className="btn-row">
                      <button type="button" className="secondary-btn" onClick={() => onAllowNextDevice(item)}>
                        Сброс доверия
                      </button>
                      {item.mfaEnabled && (
                        <button type="button" className="secondary-btn" onClick={() => onResetMfa(item)}>
                          Сбросить MFA
                        </button>
                      )}
                      {item.accessDisabled ? (
                        <button type="button" className="primary-btn" onClick={() => onEnableUser(item)}>
                          Вернуть доступ
                        </button>
                      ) : (
                        <button type="button" className="secondary-btn" onClick={() => onDisableUser(item)}>
                          Отключить от системы
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!adminUsers.length && <p className="muted">Пользователи не найдены</p>}
              </div>
            )}
          </div>
        )}

        {tab === 'requests' && (
          <div className="modal-body-scroll">
            {registrationLoading && <p className="muted">Загрузка заявок...</p>}
            {!registrationLoading && (
              <div className="group-list group-list-scroll">
                {registrationRequests.map((req) => (
                  <div key={req.id} className="group-card">
                    <div>
                      <div className="group-card__title">{req.displayName || req.username}</div>
                      <div className="group-card__meta">{formatRole(req.role)} · {req.department || 'Отдел не указан'}</div>
                      <div className="group-card__meta">{req.email}</div>
                      <div className="group-card__meta">Отправлена: {new Date(req.createdAt).toLocaleString()}</div>
                    </div>
                    <div className="btn-row">
                      <button type="button" className="primary-btn" onClick={() => onApproveRequest(req)}>
                        Принять
                      </button>
                      <button type="button" className="secondary-btn" onClick={() => onRejectRequest(req)}>
                        Отклонить
                      </button>
                    </div>
                  </div>
                ))}
                {!registrationRequests.length && <p className="muted">Заявок нет</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

ChatManagementModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  groups: PropTypes.arrayOf(PropTypes.object),
  groupsLoading: PropTypes.bool,
  onOpenGroup: PropTypes.func,
  onManageGroup: PropTypes.func,
  directChats: PropTypes.arrayOf(PropTypes.object),
  directLoading: PropTypes.bool,
  onClearBlocks: PropTypes.func,
  adminUsers: PropTypes.arrayOf(PropTypes.object),
  adminUsersLoading: PropTypes.bool,
  registrationRequests: PropTypes.arrayOf(PropTypes.object),
  registrationLoading: PropTypes.bool,
  onDisableUser: PropTypes.func,
  onEnableUser: PropTypes.func,
  onAllowNextDevice: PropTypes.func,
  onResetMfa: PropTypes.func,
  onApproveRequest: PropTypes.func,
  onRejectRequest: PropTypes.func,
  notice: PropTypes.string,
};

ChatManagementModal.defaultProps = {
  groups: [],
  groupsLoading: false,
  onOpenGroup: () => {},
  onManageGroup: () => {},
  directChats: [],
  directLoading: false,
  onClearBlocks: () => {},
  adminUsers: [],
  adminUsersLoading: false,
  registrationRequests: [],
  registrationLoading: false,
  onDisableUser: () => {},
  onEnableUser: () => {},
  onAllowNextDevice: () => {},
  onResetMfa: () => {},
  onApproveRequest: () => {},
  onRejectRequest: () => {},
  notice: '',
};

export default ChatManagementModal;
