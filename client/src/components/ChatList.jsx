import PropTypes from 'prop-types';
import { formatRole } from '../utils/roleLabels';

const formatTime = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const ChatList = ({ chats, selectedChatId, onSelect }) => {
  const safeChats = Array.isArray(chats) ? chats : [];

  if (!safeChats.length) {
    return <p className="empty-state">Чатов пока нет. Создайте первый.</p>;
  }

  return (
    <ul className="chat-list">
      {safeChats.map((chat) => {
        const isActive = chat.id === selectedChatId;
        const lastMessage = chat.lastMessage?.text || 'Нет сообщений';
        const lastTime = chat.lastMessage?.createdAt ? formatTime(chat.lastMessage.createdAt) : '';
        const title =
          chat.type === 'group'
            ? chat.title || 'Групповой чат'
            : chat.otherUser?.displayName || chat.otherUser?.username;
        const statusClass =
          chat.type === 'group'
            ? 'status status--group'
            : chat.isOnline
            ? chat.otherUser?.dndEnabled
              ? 'status status--dnd'
              : 'status status--online'
            : 'status status--offline';
        const showBadge = chat.unreadCount > 0 && !chat.removed;

        return (
          <li key={chat.id}>
            <button
              type="button"
              className={`chat-list__item ${isActive ? 'chat-list__item--active' : ''}`}
              onClick={() => onSelect(chat.id)}
            >
              <div className="chat-list__avatar">
                <span className={statusClass} title={chat.type === 'group' ? 'Группа' : undefined} />
              </div>
              <div className="chat-list__body">
                <div className="chat-list__top">
                  <div>
                    <div className="chat-list__title">{title}</div>
                    {chat.type === 'group' ? (
                      <div className="chat-list__meta">Участников: {chat.participants?.length || 0}</div>
                    ) : (
                      <div className="chat-list__meta">
                        {formatRole(chat.otherUser?.role)} · {chat.otherUser?.department || 'Отдел не указан'}
                      </div>
                    )}
                  </div>
                  <div className="chat-list__time-block">
                    <span className="chat-list__time">{lastTime}</span>
                    {showBadge && <span className="chat-list__badge">{chat.unreadCount}</span>}
                  </div>
                </div>
                <div className="chat-list__last">
                  {lastMessage}
                  {!chat.notificationsEnabled && <span className="muted-flag"> · без уведомлений</span>}
                  {chat.removed && chat.type === 'group' && <span className="muted-flag"> · вас удалили</span>}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

ChatList.propTypes = {
  chats: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      otherUser: PropTypes.object,
      type: PropTypes.string,
      title: PropTypes.string,
      lastMessage: PropTypes.shape({
        text: PropTypes.string,
        senderId: PropTypes.string,
        createdAt: PropTypes.string,
      }),
      updatedAt: PropTypes.string,
      isOnline: PropTypes.bool,
      notificationsEnabled: PropTypes.bool,
      unreadCount: PropTypes.number,
    })
  ).isRequired,
  selectedChatId: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
};

ChatList.defaultProps = {
  selectedChatId: null,
};

export default ChatList;
