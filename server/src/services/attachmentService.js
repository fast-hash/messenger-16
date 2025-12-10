const fs = require('fs');
const path = require('path');
const Chat = require('../models/Chat');
const Attachment = require('../models/Attachment');
const Message = require('../models/Message');

const uploadsRoot = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}

const ensureChatAccess = async (chatId, userId) => {
  const chat = await Chat.findById(chatId);
  if (!chat) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }

  const participantIds = (chat.participants || []).map((id) => id.toString());
  const removedIds = [
    ...(chat.removedParticipants || []).map((id) => id.toString()),
    ...(chat.removedFor || []).map((id) => id.toString()),
  ];
  const idStr = userId.toString();

  if (!participantIds.includes(idStr) || chat.removed || removedIds.includes(idStr)) {
    const error = new Error('Not authorized for this chat');
    error.status = 403;
    throw error;
  }

  if (chat.type === 'direct') {
    const otherId = participantIds.find((id) => id !== idStr);
    const blocked = (chat.blocks || []).some(
      (b) =>
        (b.by && b.by.toString() === idStr && b.target && b.target.toString() === otherId) ||
        (b.by && b.by.toString() === otherId && b.target && b.target.toString() === idStr)
    );
    if (blocked) {
      const error = new Error('Диалог заблокирован');
      error.status = 403;
      throw error;
    }
  }

  return chat;
};

const saveMetadata = async ({ chatId, uploaderId, files }) => {
  const created = await Attachment.insertMany(
    files.map((file) => ({
      uploaderId,
      chatId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storageKey: path.join(chatId.toString(), path.basename(file.path)),
    }))
  );

  return created.map((doc) => ({
    id: doc._id.toString(),
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    status: doc.status,
  }));
};

const getAttachmentForDownload = async ({ attachmentId, requesterId }) => {
  const attachment = await Attachment.findById(attachmentId);
  if (!attachment) {
    const error = new Error('Attachment not found');
    error.status = 404;
    throw error;
  }

  await ensureChatAccess(attachment.chatId, requesterId);

  if (attachment.status === 'uploaded' && attachment.uploaderId.toString() !== requesterId.toString()) {
    const error = new Error('Вложение недоступно');
    error.status = 403;
    throw error;
  }

  if (attachment.messageId) {
    const message = await Message.findById(attachment.messageId);
    if (message && message.deletedForAll) {
      const error = new Error('Вложение удалено вместе с сообщением');
      error.status = 410;
      throw error;
    }
  }

  const filePath = path.join(uploadsRoot, attachment.storageKey);
  if (!fs.existsSync(filePath)) {
    const error = new Error('Файл не найден');
    error.status = 404;
    throw error;
  }

  return { attachment, filePath };
};

module.exports = {
  uploadsRoot,
  ensureChatAccess,
  saveMetadata,
  getAttachmentForDownload,
};
