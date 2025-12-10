const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const User = require('../models/User');
const Message = require('../models/Message');
const auditService = require('./auditService');
const { getIo } = require('../sockets');
const { Types } = mongoose;

const toObjectId = (value) => {
  if (!value) return null;

  if (value instanceof Types.ObjectId) {
    return value;
  }

  if (typeof value === 'object' && value._id) {
    return toObjectId(value._id);
  }

  if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
    return new Types.ObjectId(value);
  }

  throw new Error(`Invalid ObjectId value: ${JSON.stringify(value)}`);
};

const buildParticipantsKey = (userIdA, userIdB) => {
  const [first, second] = [userIdA.toString(), userIdB.toString()].sort();
  return `${first}:${second}`;
};

const mapUser = (user) => ({
  id: user._id ? user._id.toString() : user.toString(),
  username: user.username,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  department: user.department,
  jobTitle: user.jobTitle,
  dndEnabled: user.dndEnabled || false,
  dndUntil: user.dndUntil || null,
});

const ensureChatParticipant = (chat, userId) => {
  const participantIds = (chat.participants || []).map((p) => (p._id ? p._id.toString() : p.toString()));
  if (!participantIds.includes(userId.toString())) {
    const error = new Error('Недостаточно прав для операции');
    error.status = 403;
    throw error;
  }
};

const findReadState = (chatDoc, userId) =>
  (chatDoc.readState || []).find((entry) => entry.user && entry.user.toString() === userId.toString());

const normalizeObjectIds = (list = []) => {
  const arr = Array.isArray(list) ? list : [list];
  const normalized = arr
    .map((value) => {
      try {
        return toObjectId(value);
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean)
    .map((id) => id.toString());

  return Array.from(new Set(normalized)).map((id) => new Types.ObjectId(id));
};

const cleanJoinRequests = (requests = []) =>
  requests.filter((req) => req && req.user && mongoose.isValidObjectId(req.user));

const toChatDto = (chatDoc, currentUserId, extra = {}) => {
  const participantIds = (chatDoc.participants || []).map((p) =>
    p._id ? p._id.toString() : p.toString()
  );
  const removedParticipants = (chatDoc.removedParticipants || []).map((id) =>
    id._id ? id._id.toString() : id.toString()
  );

  const isRemoved = (() => {
    if (!currentUserId) return false;
    const idStr = currentUserId.toString();
    if (chatDoc.type !== 'group') return false;
    if (!participantIds.includes(idStr)) return true;
    if ((chatDoc.removedFor || []).some((id) => id.toString() === idStr)) return true;
    return removedParticipants.includes(idStr);
  })();

  const dto = {
    id: chatDoc._id.toString(),
    type: chatDoc.type || 'direct',
    title: chatDoc.type === 'group' ? chatDoc.title : null,
    createdBy: chatDoc.createdBy ? chatDoc.createdBy.toString() : null,
    admins: (chatDoc.admins || []).map((admin) =>
      admin._id ? admin._id.toString() : admin.toString()
    ),
    participants: (chatDoc.participants || []).map(mapUser),
    removedParticipants,
    blocks: (chatDoc.blocks || []).map((block) => ({
      by: block.by ? block.by.toString() : null,
      target: block.target ? block.target.toString() : null,
      createdAt: block.createdAt,
    })),
    createdAt: chatDoc.createdAt,
    lastMessage: isRemoved
      ? null
      : chatDoc.lastMessage
      ? {
          text: chatDoc.lastMessage.text,
          senderId: chatDoc.lastMessage.sender
            ? chatDoc.lastMessage.sender.toString()
            : null,
          createdAt: chatDoc.lastMessage.createdAt,
        }
      : null,
    updatedAt: chatDoc.updatedAt,
    removed: isRemoved,
    notificationsEnabled: chatDoc.notificationsEnabled !== false,
    lastReadAt: currentUserId ? findReadState(chatDoc, currentUserId)?.lastReadAt || null : null,
    pinnedMessageIds: (chatDoc.pinnedMessageIds || []).map((id) =>
      id._id ? id._id.toString() : id.toString()
    ),
    muteUntil: chatDoc.muteUntil,
    rateLimitPerMinute: chatDoc.rateLimitPerMinute ?? null,
    unreadCount: extra.unreadCount ?? 0,
  };

  dto.unreadCount = isRemoved ? 0 : dto.unreadCount;

  return dto;
};

const computeUnreadCount = async (chat, userId) => {
  const state = (chat.readState || []).find((entry) => entry.user && entry.user.toString() === userId.toString());
  const lastReadAt = state ? state.lastReadAt : null;
  const userObjectId = toObjectId(userId);

  const baseQuery = { chat: chat._id, sender: { $ne: userObjectId } };

  if (!lastReadAt) {
    return Message.countDocuments(baseQuery);
  }

  return Message.countDocuments({ ...baseQuery, createdAt: { $gt: lastReadAt } });
};

const getOrCreateDirectChat = async ({ userId, otherUserId }) => {
  if (!userId || !otherUserId) {
    const error = new Error('Both userId and otherUserId are required');
    error.status = 400;
    throw error;
  }

  if (userId.toString() === otherUserId.toString()) {
    const error = new Error('Cannot create chat with yourself');
    error.status = 400;
    throw error;
  }

  const participantsKey = buildParticipantsKey(userId, otherUserId);

  let chat = await Chat.findOne({ participantsKey, type: 'direct' }).populate('participants');

  if (!chat) {
    chat = await Chat.create({
      type: 'direct',
      participants: [userId, otherUserId],
      participantsKey,
    });
    await chat.populate('participants');
  }

  return toChatDto(chat, userId);
};

const getUserChats = async ({ userId }) => {
  const chats = await Chat.find({ $or: [{ participants: userId }, { removedFor: userId }] })
    .sort({ updatedAt: -1 })
    .populate('participants')
    .populate('admins');

  const withUnread = await Promise.all(
    chats.map(async (chat) => {
      const unreadCount = await computeUnreadCount(chat, userId);
      const dto = toChatDto(chat, userId, { unreadCount });
      dto.unreadCount = dto.removed ? 0 : unreadCount;
      return dto;
    })
  );

  return withUnread;
};

const checkGroupTitleAvailability = async (title) => {
  if (!title || !title.trim()) return false;

  const escaped = title.trim().replace(/[.*+?^${}()|[\\]\]/g, '\$&');
  const existing = await Chat.findOne({
    type: 'group',
    title: { $regex: new RegExp(`^${escaped}$`, 'i') },
  });

  return !existing;
};

const createGroupChat = async ({ title, creatorId, participantIds = [] }) => {
  if (!title || !title.trim()) {
    const error = new Error('Название группы обязательно');
    error.status = 400;
    throw error;
  }

  const creator = await User.findById(creatorId);
  if (!creator || creator.role !== 'admin') {
    const error = new Error('Создавать группы может только администратор');
    error.status = 403;
    throw error;
  }

  const allParticipants = normalizeObjectIds([creatorId, ...(participantIds || [])]);

  let chat;
  try {
    chat = await Chat.create({
      type: 'group',
      title: title.trim(),
      createdBy: creatorId,
      admins: normalizeObjectIds([creatorId]),
      participants: allParticipants,
      joinRequests: [],
      removedFor: [],
    });
  } catch (err) {
    if (err.code === 11000) {
      const error = new Error('Похоже, такая группа уже существует. Попробуйте другое название.');
      error.status = 409;
      throw error;
    }
    throw err;
  }

  await chat.populate([
    { path: 'participants', select: 'username email displayName role department jobTitle' },
    { path: 'admins', select: 'username email displayName role department jobTitle' },
  ]);
  return {
    chat: toChatDto(chat, creatorId),
    isAdmin: true,
  };
};

const listGroupsForUser = async ({ userId }) => {
  const groups = await Chat.find({ type: 'group' })
    .populate('participants')
    .populate('admins');

  return groups.map((group) => {
    const isAdmin = group.admins.some((id) => id.toString() === userId.toString());
    const isMember = group.participants.some((id) => id.toString() === userId.toString());
    const isPending = (group.joinRequests || []).some(
      (req) => req.user && req.user.toString() === userId.toString()
    );

    let membershipStatus = 'none';
    if (group.createdBy && group.createdBy.toString() === userId.toString()) membershipStatus = 'owner';
    else if (isAdmin) membershipStatus = 'admin';
    else if (isMember) membershipStatus = 'member';
    else if (isPending) membershipStatus = 'pending';

    return {
      id: group._id.toString(),
      type: 'group',
      title: group.title,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      participantsCount: group.participants.length,
      membershipStatus,
    };
  });
};

const mapJoinRequest = (request) => {
  if (!request || !request.user) return null;
  const base = mapUser(request.user);
  return { ...base, createdAt: request.createdAt };
};

const getGroupDetails = async ({ chatId, userId }) => {
  const chat = await Chat.findById(chatId)
    .populate('participants')
    .populate('admins')
    .populate('joinRequests.user');

  if (!chat || chat.type !== 'group') {
    const error = new Error('Группа не найдена');
    error.status = 404;
    throw error;
  }

  const canManage =
    chat.admins.some((id) => id.toString() === userId.toString()) ||
    (chat.createdBy && chat.createdBy.toString() === userId.toString());

  if (!canManage) {
    const error = new Error('Недостаточно прав для управления группой');
    error.status = 403;
    throw error;
  }

  return {
    chat: {
      ...toChatDto(chat, userId),
      joinRequests: cleanJoinRequests(chat.joinRequests).map(mapJoinRequest).filter(Boolean),
    },
    canManage,
  };
};

const ensureGroupAdmin = (chat, adminId) => {
  const isAdmin =
    (chat.admins || []).some((id) => id.toString() === adminId.toString()) ||
    (chat.createdBy && chat.createdBy.toString() === adminId.toString());
  if (!isAdmin) {
    const error = new Error('Требуются права администратора группы');
    error.status = 403;
    throw error;
  }
};

const groupAddParticipant = async ({ chatId, adminId, userId }) => {
  let participantObjectId;
  try {
    participantObjectId = toObjectId(userId);
  } catch (e) {
    const error = new Error('Некорректный идентификатор пользователя для добавления');
    error.status = 400;
    throw error;
  }

  const chat = await Chat.findById(toObjectId(chatId))
    .populate('participants')
    .populate('admins')
    .populate('joinRequests.user');
  if (!chat || chat.type !== 'group') {
    const error = new Error('Группа не найдена');
    error.status = 404;
    throw error;
  }

  ensureGroupAdmin(chat, adminId);

  const hasParticipant = (chat.participants || []).some((p) =>
    p instanceof Types.ObjectId
      ? p.equals(participantObjectId)
      : p._id
      ? p._id.equals(participantObjectId)
      : p.toString() === participantObjectId.toString()
  );

  if (!hasParticipant) {
    chat.participants.push(participantObjectId);
  }

  chat.joinRequests = cleanJoinRequests(chat.joinRequests).filter(
    (req) => req.user && req.user.toString() !== participantObjectId.toString()
  );

  chat.removedParticipants = (chat.removedParticipants || []).filter(
    (id) => id.toString() !== participantObjectId.toString()
  );
  chat.removedFor = (chat.removedFor || []).filter(
    (id) => id.toString() !== participantObjectId.toString()
  );

  await chat.save();
  await chat.populate([
    { path: 'participants', select: 'username email displayName role department jobTitle' },
    { path: 'admins', select: 'username email displayName role department jobTitle' },
    { path: 'joinRequests.user', select: 'username email displayName role department jobTitle' },
  ]);

  return { ok: true, ...(await getGroupDetails({ chatId, userId: adminId })) };
};

const groupRemoveParticipant = async ({ chatId, adminId, userId }) => {
  let participantObjectId;
  try {
    participantObjectId = toObjectId(userId);
  } catch (e) {
    const error = new Error('Некорректный идентификатор пользователя для удаления');
    error.status = 400;
    throw error;
  }

  const chat = await Chat.findById(toObjectId(chatId))
    .populate('participants')
    .populate('admins')
    .populate('joinRequests.user');
  if (!chat || chat.type !== 'group') {
    const error = new Error('Группа не найдена');
    error.status = 404;
    throw error;
  }

  ensureGroupAdmin(chat, adminId);

  if (adminId.toString() === participantObjectId.toString()) {
    const error = new Error('Нельзя удалить себя');
    error.status = 400;
    throw error;
  }

  const isCreator = chat.createdBy && chat.createdBy.toString() === participantObjectId.toString();
  const isAdmin = (chat.admins || []).some((admin) => admin.toString() === participantObjectId.toString());

  if (isCreator || isAdmin) {
    const error = new Error('Нельзя удалить администратора или создателя группы');
    error.status = 400;
    throw error;
  }

  chat.participants = (chat.participants || []).filter((p) => {
    if (p instanceof Types.ObjectId) return !p.equals(participantObjectId);
    if (p._id) return !p._id.equals(participantObjectId);
    return p.toString() !== participantObjectId.toString();
  });

  chat.removedFor = Array.from(
    new Set([...(chat.removedFor || []).map((id) => id.toString()), participantObjectId.toString()])
  );
  chat.removedParticipants = Array.from(
    new Set(
      [...(chat.removedParticipants || []).map((id) => id.toString()), participantObjectId.toString()]
    )
  );
  await chat.save();
  const io = getIo();

  if (io) {
    io.to(`user:${participantObjectId.toString()}`).emit('chat:removed', {
      chatId: chat._id.toString(),
      reason: 'You have been removed from this group',
    });
  }
  await chat.populate([
    { path: 'participants', select: 'username email displayName role department jobTitle' },
    { path: 'admins', select: 'username email displayName role department jobTitle' },
    { path: 'joinRequests.user', select: 'username email displayName role department jobTitle' },
  ]);

  return { ok: true, ...(await getGroupDetails({ chatId, userId: adminId })) };
};

const groupRename = async ({ chatId, adminId, title }) => {
  if (!title || !title.trim()) {
    const error = new Error('Название группы обязательно');
    error.status = 400;
    throw error;
  }

  const chat = await Chat.findById(chatId).populate('admins');
  if (!chat || chat.type !== 'group') {
    const error = new Error('Группа не найдена');
    error.status = 404;
    throw error;
  }

  ensureGroupAdmin(chat, adminId);
  chat.title = title.trim();
  await chat.save();

  await chat.populate('participants');
  return getGroupDetails({ chatId, userId: adminId });
};

const groupRequestJoin = async ({ chatId, userId }) => {
  const chat = await Chat.findById(chatId);
  if (!chat || chat.type !== 'group') {
    const error = new Error('Группа не найдена');
    error.status = 404;
    throw error;
  }

  chat.joinRequests = cleanJoinRequests(chat.joinRequests);
  chat.participants = normalizeObjectIds(chat.participants);

  const alreadyParticipant = chat.participants.some((p) => p.toString() === userId.toString());
  if (alreadyParticipant) {
    return { ok: true, status: 'member' };
  }

  const alreadyPending = (chat.joinRequests || []).some(
    (req) => req.user && req.user.toString() === userId.toString()
  );
  if (alreadyPending) {
    return { ok: true, status: 'already_requested' };
  }

  chat.joinRequests = [...(chat.joinRequests || []), { user: userId, createdAt: new Date() }];
  await chat.save();

  return { ok: true, status: 'requested' };
};

const groupApproveRequest = async ({ chatId, adminId, userId }) => {
  const chat = await Chat.findById(chatId).populate('admins');
  if (!chat || chat.type !== 'group') {
    const error = new Error('Группа не найдена');
    error.status = 404;
    throw error;
  }

  ensureGroupAdmin(chat, adminId);

  chat.joinRequests = cleanJoinRequests(chat.joinRequests).filter(
    (req) => req.user && req.user.toString() !== userId.toString()
  );
  chat.participants = normalizeObjectIds([...(chat.participants || []), userId]);
  chat.removedParticipants = (chat.removedParticipants || []).filter(
    (id) => id.toString() !== userId.toString()
  );
  chat.removedFor = (chat.removedFor || []).filter((id) => id.toString() !== userId.toString());
  await chat.save();

  return getGroupDetails({ chatId, userId: adminId });
};

const groupRejectRequest = async ({ chatId, adminId, userId }) => {
  const chat = await Chat.findById(chatId).populate('admins');
  if (!chat || chat.type !== 'group') {
    const error = new Error('Группа не найдена');
    error.status = 404;
    throw error;
  }

  ensureGroupAdmin(chat, adminId);
  chat.joinRequests = cleanJoinRequests(chat.joinRequests).filter(
    (req) => req.user && req.user.toString() !== userId.toString()
  );
  await chat.save();

  return getGroupDetails({ chatId, userId: adminId });
};

const blockUserInDirectChat = async (chatId, blockerId) => {
  const chat = await Chat.findById(chatId);
  if (!chat || chat.type !== 'direct') {
    const error = new Error('Чат не найден');
    error.status = 404;
    throw error;
  }

  const participantIds = (chat.participants || []).map((id) => id.toString());
  if (!participantIds.includes(blockerId.toString())) {
    const error = new Error('Недостаточно прав для операции');
    error.status = 403;
    throw error;
  }

  const otherId = participantIds.find((id) => id !== blockerId.toString());

  await Chat.updateOne({ _id: chatId }, { $pull: { blocks: { by: blockerId, target: otherId } } });
  await Chat.updateOne(
    { _id: chatId },
    {
      $push: {
        blocks: { by: blockerId, target: otherId, createdAt: new Date() },
      },
    }
  );

  const updated = await Chat.findById(chatId).populate('participants');
  return toChatDto(updated, blockerId);
};

const unblockUserInDirectChat = async (chatId, blockerId) => {
  const chat = await Chat.findById(chatId);
  if (!chat || chat.type !== 'direct') {
    const error = new Error('Чат не найден');
    error.status = 404;
    throw error;
  }

  const participantIds = (chat.participants || []).map((id) => id.toString());
  if (!participantIds.includes(blockerId.toString())) {
    const error = new Error('Недостаточно прав для операции');
    error.status = 403;
    throw error;
  }

  const otherId = participantIds.find((id) => id !== blockerId.toString());

  await Chat.updateOne(
    { _id: chatId },
    {
      $pull: {
        blocks: { by: blockerId, target: otherId },
      },
    }
  );

  const updated = await Chat.findById(chatId).populate('participants');
  return toChatDto(updated, blockerId);
};

const listDirectChatsForAdmin = async () => {
  const chats = await Chat.find({ type: 'direct' }).populate('participants');
  return chats.map((chat) => ({
    id: chat._id.toString(),
    participants: (chat.participants || []).map(mapUser),
    blocks: (chat.blocks || []).map((block) => ({
      by: block.by ? block.by.toString() : null,
      target: block.target ? block.target.toString() : null,
      createdAt: block.createdAt,
    })),
  }));
};

const removeAllBlocksFromDirectChat = async (chatId) => {
  const chat = await Chat.findById(chatId);
  if (!chat || chat.type !== 'direct') {
    const error = new Error('Чат не найден');
    error.status = 404;
    throw error;
  }

  chat.blocks = [];
  await chat.save();
  await chat.populate('participants');
  return toChatDto(chat, null);
};

const markChatRead = async ({ chatId, userId }) => {
  const chat = await Chat.findById(chatId);
  if (!chat) {
    const error = new Error('Чат не найден');
    error.status = 404;
    throw error;
  }

  const now = new Date();
  const existing = (chat.readState || []).find((entry) => entry.user && entry.user.toString() === userId.toString());

  if (existing) {
    existing.lastReadAt = now;
  } else {
    chat.readState.push({ user: userId, lastReadAt: now });
  }

  await chat.save();
  return { ok: true, lastReadAt: now };
};

const assertMessageInChat = async ({ chatId, messageId }) => {
  const message = await Message.findById(messageId);
  if (!message || message.chat.toString() !== chatId.toString()) {
    const error = new Error('Сообщение не найдено в этом чате');
    error.status = 400;
    throw error;
  }
};

const ensurePinPermission = (chat, userId) => {
  if (chat.type === 'group') {
    ensureGroupAdmin(chat, userId);
  } else {
    ensureChatParticipant(chat, userId);
  }
};

const pinMessage = async ({ chatId, userId, messageId }) => {
  const chat = await Chat.findById(chatId);
  if (!chat) {
    const error = new Error('Чат не найден');
    error.status = 404;
    throw error;
  }

  ensurePinPermission(chat, userId);
  await assertMessageInChat({ chatId, messageId });

  const existing = (chat.pinnedMessageIds || []).map((id) => id.toString());
  if (!existing.includes(messageId.toString())) {
    chat.pinnedMessageIds.push(messageId);
    await chat.save();
    if (chat.type === 'group') {
      await auditService.logEvent({
        chatId,
        actorId: userId,
        type: 'PIN_ADDED',
        meta: { messageId: messageId.toString() },
      });
    }
  }

  return { pinnedMessageIds: (chat.pinnedMessageIds || []).map((id) => id.toString()) };
};

const unpinMessage = async ({ chatId, userId, messageId }) => {
  const chat = await Chat.findById(chatId);
  if (!chat) {
    const error = new Error('Чат не найден');
    error.status = 404;
    throw error;
  }

  ensurePinPermission(chat, userId);
  chat.pinnedMessageIds = (chat.pinnedMessageIds || []).filter(
    (id) => id.toString() !== messageId.toString()
  );
  await chat.save();

  if (chat.type === 'group') {
    await auditService.logEvent({
      chatId,
      actorId: userId,
      type: 'PIN_REMOVED',
      meta: { messageId: messageId.toString() },
    });
  }

  return { pinnedMessageIds: (chat.pinnedMessageIds || []).map((id) => id.toString()) };
};

const listPins = async ({ chatId, userId }) => {
  const chat = await Chat.findById(chatId);
  if (!chat) {
    const error = new Error('Чат не найден');
    error.status = 404;
    throw error;
  }

  ensureChatParticipant(chat, userId);
  return { pinnedMessageIds: (chat.pinnedMessageIds || []).map((id) => id.toString()) };
};

const updateModeration = async ({ chatId, actorId, actorRole, muteUntil, rateLimitPerMinute }) => {
  const chat = await Chat.findById(chatId);
  if (!chat) {
    const error = new Error('Чат не найден');
    error.status = 404;
    throw error;
  }

  if (chat.type !== 'group') {
    const error = new Error('Модерация доступна только для групповых чатов');
    error.status = 400;
    throw error;
  }

  const isGroupAdmin =
    (chat.admins || []).some((id) => id.toString() === actorId.toString()) ||
    (chat.createdBy && chat.createdBy.toString() === actorId.toString());

  const isGlobalAdmin = actorRole === 'admin';

  if (!isGroupAdmin && !isGlobalAdmin) {
    const error = new Error('Недостаточно прав для управления модерацией чата');
    error.status = 403;
    throw error;
  }

  const prevMute = chat.muteUntil;
  const prevRate = chat.rateLimitPerMinute;

  if (muteUntil !== undefined) {
    chat.muteUntil = muteUntil ? new Date(muteUntil) : null;
  }

  if (rateLimitPerMinute !== undefined) {
    chat.rateLimitPerMinute = Number.isFinite(rateLimitPerMinute)
      ? rateLimitPerMinute
      : rateLimitPerMinute === 0 || rateLimitPerMinute === null
      ? null
      : chat.rateLimitPerMinute ?? null;
  }

  await chat.save();

  if (muteUntil !== undefined && (prevMute || chat.muteUntil)) {
    await auditService.logEvent({
      chatId,
      actorId,
      type: chat.muteUntil ? 'MUTE_SET' : 'MUTE_CLEARED',
      meta: { muteUntil: chat.muteUntil },
    });
  }

  if (rateLimitPerMinute !== undefined && (prevRate || chat.rateLimitPerMinute)) {
    await auditService.logEvent({
      chatId,
      actorId,
      type: chat.rateLimitPerMinute ? 'RATE_LIMIT_SET' : 'RATE_LIMIT_CLEARED',
      meta: { rateLimitPerMinute: chat.rateLimitPerMinute ?? null },
    });
  }

  return {
    chatId: chat._id.toString(),
    muteUntil: chat.muteUntil,
    rateLimitPerMinute: chat.rateLimitPerMinute ?? null,
  };
};

module.exports = {
  getOrCreateDirectChat,
  getUserChats,
  checkGroupTitleAvailability,
  createGroupChat,
  listGroupsForUser,
  getGroupDetails,
  groupAddParticipant,
  groupRemoveParticipant,
  groupRename,
  groupRequestJoin,
  groupApproveRequest,
  groupRejectRequest,
  blockUserInDirectChat,
  unblockUserInDirectChat,
  listDirectChatsForAdmin,
  removeAllBlocksFromDirectChat,
  markChatRead,
  pinMessage,
  unpinMessage,
  listPins,
  updateModeration,
};
