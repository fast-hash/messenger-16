const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Attachment = require('../models/Attachment');
const cryptoService = require('./crypto/cryptoService');
const auditService = require('./auditService');
const { uploadsRoot } = require('./attachmentService');

const ensureParticipant = (chatDoc, userId, { allowRemoved = false } = {}) => {
  const participantIds = (chatDoc.participants || []).map((id) => id.toString());
  const removedIds = [
    ...(chatDoc.removedFor || []).map((id) => id.toString()),
    ...(chatDoc.removedParticipants || []).map((id) => id.toString()),
  ];
  const idStr = userId.toString();

  if (participantIds.includes(idStr)) {
    return;
  }

  if (allowRemoved && removedIds.includes(idStr)) {
    return;
  }

  const error = new Error('Not authorized for this chat');
  error.status = 403;
  throw error;
};

const unlinkAttachments = async (attachmentIds) => {
  if (!attachmentIds || attachmentIds.length === 0) return;

  const ids = attachmentIds.map((att) => (att?._id ? att._id : att));
  const docs = await Attachment.find({ _id: { $in: ids } });

  for (const doc of docs) {
    if (!doc.storageKey) continue;
    const fullPath = path.join(uploadsRoot, doc.storageKey);
    fs.unlink(fullPath, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.error('File delete error:', err);
      }
    });
  }
};

const toMessageDto = (messageDoc, text) => {
  const sender = messageDoc.sender || {};
  const senderDto = sender._id
    ? {
        id: sender._id.toString(),
        displayName: sender.displayName,
        username: sender.username,
        role: sender.role,
        department: sender.department,
        email: sender.email,
      }
    : { id: sender.toString() };

  const deletedById = messageDoc.deletedBy ? messageDoc.deletedBy.toString() : null;
  const attachmentsList = Array.isArray(messageDoc.attachments) ? messageDoc.attachments : [];
  const attachmentsDto = messageDoc.deletedForAll
    ? []
    : attachmentsList.map((attachment) => ({
        id: attachment._id ? attachment._id.toString() : attachment.toString(),
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        status: attachment.status,
      }));

  return {
    id: messageDoc._id.toString(),
    chatId: messageDoc.chat.toString(),
    senderId: senderDto.id,
    sender: senderDto,
    text: messageDoc.deletedForAll ? null : text,
    reactions: (messageDoc.reactions || []).map((reaction) => ({
      emoji: reaction.emoji,
      userId: reaction.userId ? reaction.userId.toString() : null,
    })),
    createdAt: messageDoc.createdAt ? messageDoc.createdAt.toISOString() : new Date().toISOString(),
    createdAtMs: messageDoc.createdAt ? messageDoc.createdAt.getTime() : Date.now(),
    mentions: (messageDoc.mentions || []).map((id) => id.toString()),
    deletedForAll: !!messageDoc.deletedForAll,
    deletedAt: messageDoc.deletedAt,
    deletedBy: deletedById,
    attachments: attachmentsDto,
  };
};

const sendMessage = async ({ chatId, senderId, senderRole, text, mentions = [], attachments = [] }) => {
  const hasText = typeof text === 'string' && text.trim().length > 0;
  const attachmentIds = Array.isArray(attachments)
    ? attachments.filter((id) => id && mongoose.Types.ObjectId.isValid(id)).map((id) => id.toString())
    : [];
  const uniqueAttachmentIds = [...new Set(attachmentIds)];

  if (!chatId || !senderId || (!hasText && uniqueAttachmentIds.length === 0)) {
    const error = new Error('chatId, senderId, and content are required');
    error.status = 400;
    throw error;
  }

  const trimmed = hasText ? text.trim() : '';

  const chat = await Chat.findById(chatId);
  if (!chat) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }

  if (chat.type === 'group') {
    const isParticipant = (chat.participants || []).some((id) => id.toString() === senderId.toString());
    if (!isParticipant) {
      const error = new Error('Вы больше не являетесь участником группы');
      error.status = 403;
      throw error;
    }
  }

  if (chat.type === 'direct') {
    const participantIds = (chat.participants || []).map((id) => id.toString());
    const otherId = participantIds.find((id) => id !== senderId.toString());
    const hasBlock = (chat.blocks || []).some(
      (b) =>
        (b.by && b.by.toString() === senderId.toString() && b.target && b.target.toString() === otherId) ||
        (b.by && b.by.toString() === otherId && b.target && b.target.toString() === senderId.toString())
    );

    if (hasBlock) {
      const error = new Error('Диалог заблокирован');
      error.status = 403;
      throw error;
    }
  }

  ensureParticipant(chat, senderId);

  if (chat.rateLimitPerMinute) {
    const windowMs = 60 * 1000;
    const since = new Date(Date.now() - windowMs);
    const recentMessages = await Message.find({
      chat: chatId,
      sender: senderId,
      createdAt: { $gt: since },
    })
      .sort({ createdAt: 1 })
      .limit(chat.rateLimitPerMinute);

    if (recentMessages.length >= chat.rateLimitPerMinute) {
      const retryAt = new Date(recentMessages[0].createdAt.getTime() + windowMs);
      const error = new Error('Превышен лимит отправки');
      error.status = 429;
      error.code = 'RATE_LIMITED';
      error.retryAt = retryAt;
      error.retryAfterMs = Math.max(retryAt.getTime() - Date.now(), 0);
      error.limit = chat.rateLimitPerMinute;
      throw error;
    }
  }

  const isChatAdmin =
    (chat.admins || []).some((id) => id.toString() === senderId.toString()) ||
    (chat.createdBy && chat.createdBy.toString() === senderId.toString());
  const isGlobalAdmin = senderRole === 'admin';

  if (chat.rateLimitPerMinute && !isChatAdmin && !isGlobalAdmin) {
    const windowMs = 60 * 1000;
    const since = new Date(Date.now() - windowMs);
    const recentMessages = await Message.find({
      chat: chatId,
      sender: senderId,
      createdAt: { $gt: since },
    })
      .sort({ createdAt: 1 })
      .limit(chat.rateLimitPerMinute);

    if (recentMessages.length >= chat.rateLimitPerMinute) {
      const retryAt = new Date(recentMessages[0].createdAt.getTime() + windowMs);
      const error = new Error('Превышен лимит отправки');
      error.status = 429;
      error.code = 'RATE_LIMITED';
      error.retryAt = retryAt;
      error.retryAfterMs = Math.max(retryAt.getTime() - Date.now(), 0);
      error.limit = chat.rateLimitPerMinute;
      throw error;
    }
  }

  const now = new Date();
  if (chat.muteUntil && new Date(chat.muteUntil).getTime() > now.getTime() && !isChatAdmin && !isGlobalAdmin) {
    const error = new Error(`Чат на паузе до ${new Date(chat.muteUntil).toISOString()}`);
    error.status = 403;
    throw error;
  }

  const uniqueMentions = Array.from(
    new Set(
      (Array.isArray(mentions) ? mentions : [])
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
        .map((id) => id.toString())
    )
  );

  const participantIds = (chat.participants || []).map((id) => id.toString());
  const filteredMentions = uniqueMentions.filter((id) => participantIds.includes(id));

  const { ciphertext, plaintext, encryption } = await cryptoService.encrypt(trimmed, {
    chatId,
    senderId,
  });

  if (uniqueAttachmentIds.length) {
    const docs = await Attachment.find({ _id: { $in: uniqueAttachmentIds } });
    const invalid = docs.filter(
      (doc) =>
        doc.chatId.toString() !== chatId.toString() ||
        doc.uploaderId.toString() !== senderId.toString() ||
        doc.status !== 'uploaded'
    );

    if (invalid.length || docs.length !== uniqueAttachmentIds.length) {
      const error = new Error('Некоторые вложения недоступны для отправки');
      error.status = 400;
      throw error;
    }
  }

  const message = await Message.create({
    chat: chatId,
    sender: senderId,
    plaintext,
    ciphertext,
    encryption,
    mentions: filteredMentions,
    attachments: uniqueAttachmentIds,
  });

  await message.populate('sender');

  const lastMessageText = trimmed || (uniqueAttachmentIds.length ? 'Вложение' : '');

  await Chat.findByIdAndUpdate(chatId, {
    lastMessage: {
      text: lastMessageText,
      sender: senderId,
      createdAt: message.createdAt,
    },
    updatedAt: message.createdAt,
  });

  const matchResult = await Chat.updateOne(
    { _id: chatId, 'readState.user': senderId },
    { $set: { 'readState.$.lastReadAt': message.createdAt } }
  );
  const matched =
    matchResult.matchedCount ?? matchResult.nModified ?? matchResult.modifiedCount ?? 0;

  if (!matched) {
    await Chat.updateOne(
      { _id: chatId },
      { $push: { readState: { user: senderId, lastReadAt: message.createdAt } } }
    );
  }

  if (uniqueAttachmentIds.length) {
    await Attachment.updateMany(
      { _id: { $in: uniqueAttachmentIds } },
      { $set: { status: 'linked', messageId: message._id, expiresAt: null } }
    );
  }

  const populatedMessage = await Message.findById(message._id).populate('sender').populate('attachments');
  const safeText = await cryptoService.decrypt(populatedMessage, { viewerId: senderId });

  return toMessageDto(populatedMessage, safeText);
};

const getMessagesForChat = async ({ chatId, viewerId }) => {
  if (!chatId || !viewerId) {
    const error = new Error('chatId and viewerId are required');
    error.status = 400;
    throw error;
  }

  const chat = await Chat.findById(chatId);
  if (!chat) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }

  // Block removed users from accessing historical messages
  ensureParticipant(chat, viewerId, { allowRemoved: false });

  const viewerObjectId = new mongoose.Types.ObjectId(viewerId);
  const messages = await Message.find({ chat: chatId, deletedFor: { $ne: viewerObjectId } })
    .sort({ createdAt: 1 })
    .populate('sender')
    .populate('attachments');

  const results = [];
  for (const message of messages) {
    // eslint-disable-next-line no-await-in-loop
    if (message.deletedForAll) {
      results.push(toMessageDto(message, null));
      continue;
    }

    const safeText = await cryptoService.decrypt(message, { viewerId });
    results.push(toMessageDto(message, safeText));
  }

  const readState = (chat.readState || []).find(
    (entry) => entry.user && entry.user.toString() === viewerId.toString()
  );

  return { messages: results, lastReadAt: readState ? readState.lastReadAt : null };
};

const toggleReaction = async ({ messageId, userId, emoji }) => {
  if (!messageId || !userId || !emoji) {
    const error = new Error('messageId, userId and emoji are required');
    error.status = 400;
    throw error;
  }

  const message = await Message.findById(messageId);
  if (!message) {
    const error = new Error('Message not found');
    error.status = 404;
    throw error;
  }

  const chat = await Chat.findById(message.chat);
  if (!chat) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }

  ensureParticipant(chat, userId);

  const trimmedEmoji = emoji.trim();
  if (!trimmedEmoji) {
    const error = new Error('Emoji is required');
    error.status = 400;
    throw error;
  }

  const existingIndex = (message.reactions || []).findIndex(
    (reaction) => reaction.userId.toString() === userId.toString()
  );

  if (existingIndex >= 0) {
    const existing = message.reactions[existingIndex];
    if (existing.emoji === trimmedEmoji) {
      message.reactions.splice(existingIndex, 1);
    } else {
      message.reactions.splice(existingIndex, 1, { emoji: trimmedEmoji, userId });
    }
  } else {
    message.reactions.push({ emoji: trimmedEmoji, userId });
  }

  await message.save();
  const reactions = (message.reactions || []).map((reaction) => ({
    emoji: reaction.emoji,
    userId: reaction.userId ? reaction.userId.toString() : null,
  }));

  return { chatId: chat._id.toString(), messageId: message._id.toString(), reactions };
};

const deleteForMe = async ({ messageId, userId }) => {
  if (!messageId || !userId) {
    const error = new Error('messageId and userId are required');
    error.status = 400;
    throw error;
  }

  const message = await Message.findById(messageId);
  if (!message) {
    const error = new Error('Message not found');
    error.status = 404;
    throw error;
  }

  const chat = await Chat.findById(message.chat);
  if (!chat) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }

  ensureParticipant(chat, userId, { allowRemoved: true });

  const alreadyDeleted = (message.deletedFor || []).some(
    (id) => id && id.toString() === userId.toString()
  );

  if (!alreadyDeleted) {
    message.deletedFor.push(userId);
  }

  if (message.attachments && message.attachments.length > 0) {
    const participantIds = (chat.participants || []).map((id) => id.toString());
    const deletedIds = (message.deletedFor || []).map((id) => id && id.toString());
    const allDeleted = participantIds.every((id) => deletedIds.includes(id));

    if (allDeleted) {
      await unlinkAttachments(message.attachments);
      message.attachments = [];
    }
  }

  await message.save();

  return { ok: true };
};

const deleteForAll = async ({ messageId, userId }) => {
  if (!messageId || !userId) {
    const error = new Error('messageId and userId are required');
    error.status = 400;
    throw error;
  }

  const message = await Message.findById(messageId);
  if (!message) {
    const error = new Error('Message not found');
    error.status = 404;
    throw error;
  }

  const chat = await Chat.findById(message.chat);
  if (!chat) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }

  ensureParticipant(chat, userId, { allowRemoved: true });
  if (message.sender.toString() !== userId.toString()) {
    const error = new Error('Удаление для всех доступно только автору сообщения');
    error.status = 403;
    throw error;
  }

  const tenMinutes = 10 * 60 * 1000;
  if (Date.now() - new Date(message.createdAt).getTime() > tenMinutes) {
    const error = new Error('Окно удаления истекло (10 минут)');
    error.status = 409;
    throw error;
  }

  await unlinkAttachments(message.attachments);
  message.attachments = [];
  message.deletedForAll = true;
  message.deletedAt = new Date();
  message.deletedBy = userId;
  await message.save();

  if (chat.lastMessage && new Date(chat.lastMessage.createdAt).getTime() === message.createdAt.getTime()) {
    await Chat.findByIdAndUpdate(message.chat, {
      'lastMessage.text': 'Сообщение удалено',
      // Можно опционально убрать sender, если хотите скрыть "Вы:", но обычно оставляют
    });
  }
  // --- НОВЫЙ БЛОК КОДА КОНЕЦ ---

  if (chat.type === 'group') {
    await auditService.logEvent({
      chatId: message.chat,
      actorId: userId,
      type: 'MESSAGE_DELETED_FOR_ALL',
      meta: { messageId: message._id.toString() },
    });
  }

  return {
    messageId: message._id.toString(),
    chatId: message.chat.toString(),
    deletedForAll: true,
    deletedAt: message.deletedAt,
    deletedBy: userId.toString(),
  };
};

module.exports = {
  sendMessage,
  getMessagesForChat,
  toggleReaction,
  deleteForMe,
  deleteForAll,
};
