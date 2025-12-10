const Chat = require('../models/Chat');
const ChatAudit = require('../models/ChatAudit');

const ensureAuditAccess = (chat, actorId, actorRole) => {
  if (!chat || chat.type !== 'group') {
    const error = new Error('Аудит доступен только для групповых чатов');
    error.status = 400;
    throw error;
  }

  const isGroupAdmin =
    (chat.admins || []).some((id) => id.toString() === actorId.toString()) ||
    (chat.createdBy && chat.createdBy.toString() === actorId.toString());
  const isGlobalAdmin = actorRole === 'admin';

  if (!isGroupAdmin && !isGlobalAdmin) {
    const error = new Error('Недостаточно прав для просмотра аудита');
    error.status = 403;
    throw error;
  }
};

const logEvent = async ({ chatId, actorId, type, meta = {} }) => {
  if (!chatId || !actorId || !type) return null;
  return ChatAudit.create({ chatId, actorId, type, meta });
};

const listEvents = async ({ chatId, actorId, actorRole, limit = 50 }) => {
  const chat = await Chat.findById(chatId);
  if (!chat) {
    const error = new Error('Чат не найден');
    error.status = 404;
    throw error;
  }

  ensureAuditAccess(chat, actorId, actorRole);

  const cappedLimit = Math.min(Number(limit) || 50, 100);
  const events = await ChatAudit.find({ chatId })
    .sort({ createdAt: -1 })
    .limit(cappedLimit);

  return events.map((event) => ({
    id: event._id.toString(),
    chatId: event.chatId.toString(),
    actorId: event.actorId ? event.actorId.toString() : null,
    type: event.type,
    meta: event.meta || {},
    createdAt: event.createdAt,
  }));
};

module.exports = { logEvent, listEvents };
