const express = require('express');
const authMiddleware = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { listUserDevices, updateDeviceStatus, toDeviceDto } = require('../services/deviceService');
const { getRequestIp } = require('../utils/requestIp');

const router = express.Router();

router.use(authMiddleware);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const devices = await listUserDevices(req.user.id);
    res.json({ devices });
  })
);

router.get(
  '/current',
  asyncHandler(async (req, res) => {
    res.json({ device: toDeviceDto(req.device) });
  })
);

router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    const updated = await updateDeviceStatus({
      targetDeviceId: req.params.id,
      userId: req.user.id,
      status,
      actorId: req.user.id,
      ipAddress: getRequestIp(req),
    });
    res.json({ device: updated });
  })
);

module.exports = router;
