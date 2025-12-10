const express = require('express');
const authMiddleware = require('../middleware/auth');
const requireTrustedDevice = require('../middleware/requireTrustedDevice');
const asyncHandler = require('../utils/asyncHandler');
const messageService = require('../services/messageService');
const { getIo } = require('../sockets');

const router = express.Router();

router.use(authMiddleware);
router.use(requireTrustedDevice);

// GET /api/messages?chatId=...
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { chatId } = req.query;

    const { messages, lastReadAt } = await messageService.getMessagesForChat({
      chatId,
      viewerId: req.user.id,
    });

    res.json({ messages, lastReadAt });
  })
);

// POST /api/messages
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { chatId, text, mentions, attachments } = req.body || {};
    const message = await messageService.sendMessage({
      chatId,
      senderId: req.user.id,
      senderRole: req.user.role,
      text,
      mentions,
      attachments,
    });

    // Если messageService уже эмитит событие сам — этот блок можно удалить,
    // но сейчас он безопасный: при отсутствии io просто пропустится.
    const io = getIo();
    if (io) {
      const emitChatId = message?.chatId || message?.chat || chatId;
      if (emitChatId) {
        io.to(`chat:${emitChatId}`).emit('message:new', {
          chatId: emitChatId,
          message,
        });
      }
    }

    res.json(message);
  })
);

// POST /api/messages/:messageId/reactions
router.post(
  '/:messageId/reactions',
  asyncHandler(async (req, res) => {
    const { emoji } = req.body || {};
    const result = await messageService.toggleReaction({
      messageId: req.params.messageId,
      userId: req.user.id,
      emoji,
    });

    const io = getIo();
    if (io) {
      io.to(`chat:${result.chatId}`).emit('message:reactionsUpdated', {
        chatId: result.chatId,
        messageId: result.messageId,
        reactions: result.reactions,
      });
    }

    res.json({ reactions: result.reactions });
  })
);

// POST /api/messages/:messageId/delete-for-me
router.post(
  '/:messageId/delete-for-me',
  asyncHandler(async (req, res) => {
    await messageService.deleteForMe({
      messageId: req.params.messageId,
      userId: req.user.id,
    });
    res.json({ ok: true });
  })
);

// POST /api/messages/:messageId/delete-for-all
router.post(
  '/:messageId/delete-for-all',
  asyncHandler(async (req, res) => {
    const result = await messageService.deleteForAll({
      messageId: req.params.messageId,
      userId: req.user.id,
    });

    const io = getIo();
    if (io) {
      io.to(`chat:${result.chatId}`).emit('message:deleted', result);
    }

    res.json(result);
  })
);

router.post(
  '/:messageId/reactions',
  asyncHandler(async (req, res) => {
    const { emoji } = req.body || {};
    const result = await messageService.toggleReaction({
      messageId: req.params.messageId,
      userId: req.user.id,
      emoji,
    });

    const io = getIo();
    if (io) {
      io.to(`chat:${result.chatId}`).emit('message:reactionsUpdated', {
        chatId: result.chatId,
        messageId: result.messageId,
        reactions: result.reactions,
      });
    }

    res.json({ reactions: result.reactions });
  })
);

router.post(
  '/:messageId/delete-for-me',
  asyncHandler(async (req, res) => {
    await messageService.deleteForMe({
      messageId: req.params.messageId,
      userId: req.user.id,
    });
    res.json({ ok: true });
  })
);

router.post(
  '/:messageId/delete-for-all',
  asyncHandler(async (req, res) => {
    const result = await messageService.deleteForAll({
      messageId: req.params.messageId,
      userId: req.user.id,
    });

    const io = getIo();
    if (io) {
      io.to(`chat:${result.chatId}`).emit('message:deleted', result);
    }

    res.json(result);
  })
);

router.post(
  '/:messageId/reactions',
  asyncHandler(async (req, res) => {
    const { emoji } = req.body || {};
    const result = await messageService.toggleReaction({
      messageId: req.params.messageId,
      userId: req.user.id,
      emoji,
    });

    const io = getIo();
    if (io) {
      io.to(`chat:${result.chatId}`).emit('message:reactionsUpdated', {
        chatId: result.chatId,
        messageId: result.messageId,
        reactions: result.reactions,
      });
    }

    res.json({ reactions: result.reactions });
  })
);

router.post(
  '/:messageId/delete-for-me',
  asyncHandler(async (req, res) => {
    await messageService.deleteForMe({
      messageId: req.params.messageId,
      userId: req.user.id,
    });
    res.json({ ok: true });
  })
);

router.post(
  '/:messageId/delete-for-all',
  asyncHandler(async (req, res) => {
    const result = await messageService.deleteForAll({
      messageId: req.params.messageId,
      userId: req.user.id,
    });

    const io = getIo();
    if (io) {
      io.to(`chat:${result.chatId}`).emit('message:deleted', result);
    }

    res.json(result);
  })
);

module.exports = router;
