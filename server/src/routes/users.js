const express = require('express');
const authMiddleware = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const userService = require('../services/userService');
const { getIo, updatePresenceMeta } = require('../sockets');
const Chat = require('../models/Chat');
const { setAuthCookie } = require('../utils/authCookie');
const { toDeviceDto } = require('../services/deviceService');

const router = express.Router();

router.use(authMiddleware);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await userService.getUserById(req.user.id);
    res.json({ user, device: toDeviceDto(req.device) });
  })
);

router.patch(
  '/me/preferences',
  asyncHandler(async (req, res) => {
    const { dndEnabled, dndUntil } = req.body || {};
    const user = await userService.updatePreferences({
      userId: req.user.id,
      dndEnabled,
      dndUntil,
    });

    setAuthCookie(res, {
      ...user,
      tokenVersion: user.tokenVersion || 0,
      deviceId: req.device ? req.device.deviceId : undefined,
      deviceTokenVersion: req.device ? req.device.tokenVersion || 0 : undefined,
    });

    const io = getIo && getIo();
    if (io) {
      const chats = await Chat.find({ participants: req.user.id }).select('_id');
      chats.forEach((chat) => {
        io.to(`chat:${chat._id.toString()}`).emit('presence:dnd', {
          userId: req.user.id,
          dndEnabled: user.dndEnabled || false,
          dndUntil: user.dndUntil || null,
        });
      });
    }

    if (updatePresenceMeta) {
      updatePresenceMeta(req.user.id, {
        dndEnabled: user.dndEnabled || false,
        dndUntil: user.dndUntil || null,
      });
    }

    res.json({ user });
  })
);

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { query } = req.query;
    const users = await userService.searchUsers({ query, excludeUserId: req.user.id });
    res.json({ users });
  })
);

module.exports = router;
