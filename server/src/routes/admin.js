const express = require('express');
const authMiddleware = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const asyncHandler = require('../utils/asyncHandler');
const chatService = require('../services/chatService');
const userService = require('../services/userService');
const registrationService = require('../services/registrationService');
const { getIo, getUserRoom } = require('../sockets');
const { getRequestIp } = require('../utils/requestIp');
const mfaService = require('../services/mfaService');

const router = express.Router();

router.use(authMiddleware);
router.use(requireAdmin);

router.get(
  '/chats/direct',
  asyncHandler(async (req, res) => {
    const chats = await chatService.listDirectChatsForAdmin();
    res.json({ chats });
  })
);

router.delete(
  '/chats/:id/blocks',
  asyncHandler(async (req, res) => {
    const chat = await chatService.removeAllBlocksFromDirectChat(req.params.id);
    res.json({ chat });
  })
);

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const users = await userService.listAllUsers();
    res.json({ users });
  })
);

router.post(
  '/users/:id/disable',
  asyncHandler(async (req, res) => {
    const user = await userService.disableUser({ targetUserId: req.params.id, adminId: req.user.id });

    const io = getIo && getIo();
    if (io) {
      io.to(getUserRoom(user.id)).emit('auth:force_logout', { reason: 'ACCESS_DISABLED' });
    }

    res.json({ user });
  })
);

router.post(
  '/users/:id/enable',
  asyncHandler(async (req, res) => {
    const user = await userService.enableUser({ targetUserId: req.params.id });
    res.json({ user });
  })
);

router.post(
  '/users/:id/reset-device-trust',
  asyncHandler(async (req, res) => {
    const user = await userService.allowNextDeviceTrust({
      targetUserId: req.params.id,
      adminId: req.user.id,
      ipAddress: getRequestIp(req),
    });
    res.json({ user });
  })
);

router.post(
  '/users/:id/mfa/reset',
  asyncHandler(async (req, res) => {
    const user = await mfaService.resetMfaByAdmin({
      targetUserId: req.params.id,
      adminId: req.user.id,
      ipAddress: getRequestIp(req),
    });

    res.json({ user: userService.toUserDto(user) });
  })
);

router.get(
  '/registration-requests',
  asyncHandler(async (req, res) => {
    const requests = await registrationService.listRequests();
    res.json({ requests });
  })
);

router.post(
  '/registration-requests/:id/approve',
  asyncHandler(async (req, res) => {
    const user = await registrationService.approveRequest({ requestId: req.params.id });
    res.json({ user });
  })
);

router.post(
  '/registration-requests/:id/reject',
  asyncHandler(async (req, res) => {
    await registrationService.rejectRequest({ requestId: req.params.id });
    res.status(204).send();
  })
);

module.exports = router;
