const express = require('express');
const authMiddleware = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const userService = require('../services/userService');
const registrationService = require('../services/registrationService');
const { registerOrUpdateDevice, toDeviceDto, findDeviceForUser } = require('../services/deviceService');
const { setAuthCookie } = require('../utils/authCookie');
const { getRequestIp } = require('../utils/requestIp');
const { logEvent } = require('../services/auditLogService');
const Device = require('../models/Device');
const User = require('../models/User');
const config = require('../config/env');
const mfaService = require('../services/mfaService');

const router = express.Router();

const mfaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    await registrationService.createRegistrationRequest(req.body || {});
    res.status(201).json({ message: 'Заявка отправлена администратору' });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { device } = req.body || {};
    const user = await userService.authenticateUser(req.body || {});
    const userRecord = await User.findById(user.id);

    if (!userRecord) {
      const error = new Error('Invalid credentials');
      error.status = 401;
      throw error;
    }

    const ipAddress = getRequestIp(req);
    const existingDevicesCount = await Device.countDocuments({ userId: userRecord._id });
    const shouldForceTrust = Boolean(userRecord.forceTrustNextDevice);
    const trustOnCreate = shouldForceTrust || existingDevicesCount === 0;

    const deviceRecord = await registerOrUpdateDevice({
      userId: user.id,
      device,
      ipAddress,
      trustOnCreate,
      forceTrust: shouldForceTrust,
    });

    if (shouldForceTrust && userRecord.forceTrustNextDevice) {
      userRecord.forceTrustNextDevice = false;
      await userRecord.save();
    }

    if (userRecord.mfaEnabled) {
      const tempToken = jwt.sign(
        {
          id: user.id,
          purpose: 'mfa_login',
          deviceId: deviceRecord.deviceId,
          deviceTokenVersion: deviceRecord.tokenVersion || 0,
          tokenVersion: user.tokenVersion || 0,
        },
        config.jwtSecret,
        { expiresIn: '10m' }
      );

      res.json({ mfaRequired: true, tempToken });
      return;
    }

    setAuthCookie(res, {
      ...user,
      tokenVersion: user.tokenVersion || 0,
      deviceId: deviceRecord.deviceId,
      deviceTokenVersion: deviceRecord.tokenVersion || 0,
    });

    await logEvent({
      actorId: user.id,
      event: 'auth_login',
      ip: ipAddress || null,
      deviceInfo: { name: deviceRecord.name, platform: deviceRecord.platform, id: deviceRecord.deviceId },
    });

    res.json({ user, device: toDeviceDto(deviceRecord) });
  })
);

router.post(
  '/mfa/setup',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const data = await mfaService.startSetup(req.user.id);
    res.json(data);
  })
);

router.post(
  '/mfa/enable',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { code } = req.body || {};
    const { user: updatedUser, backupCodes } = await mfaService.enableMfa({
      userId: req.user.id,
      code,
    });

    const userDto = userService.toUserDto(updatedUser);

    setAuthCookie(res, {
      ...userDto,
      tokenVersion: userDto.tokenVersion || 0,
      deviceId: req.device ? req.device.deviceId : undefined,
      deviceTokenVersion: req.device ? req.device.tokenVersion || 0 : undefined,
    });

    res.json({ user: userDto, backupCodes });
  })
);

router.post(
  '/mfa/disable',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { code } = req.body || {};
    const updatedUser = await mfaService.disableMfa({ userId: req.user.id, code });
    const userDto = userService.toUserDto(updatedUser);

    setAuthCookie(res, {
      ...userDto,
      tokenVersion: userDto.tokenVersion || 0,
      deviceId: req.device ? req.device.deviceId : undefined,
      deviceTokenVersion: req.device ? req.device.tokenVersion || 0 : undefined,
    });

    res.json({ user: userDto });
  })
);

router.get(
  '/mfa/backup-codes',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const codes = await mfaService.getBackupCodes({ userId: req.user.id });
    res.json({ codes });
  })
);

router.post(
  '/mfa/verify',
  mfaLimiter,
  asyncHandler(async (req, res, next) => {
    const { code, tempToken } = req.body || {};

    if (!tempToken) {
      return authMiddleware(req, res, async () => {
        const result = await mfaService.verifySetupCode({ userId: req.user.id, code });
        res.json(result);
      });
    }

    let payload;
    try {
      payload = jwt.verify(tempToken, config.jwtSecret);
    } catch (error) {
      return res.status(401).json({ error: 'MFA session истекла, выполните вход заново' });
    }

    const user = await User.findById(payload.id);
    if (!user) {
      const err = new Error('Invalid or expired token');
      err.status = 401;
      throw err;
    }

    const tokenVersion = typeof payload.tokenVersion === 'number' ? payload.tokenVersion : 0;
    if ((user.tokenVersion || 0) !== tokenVersion) {
      const err = new Error('Invalid or expired token');
      err.status = 401;
      throw err;
    }

    const deviceRecord = await findDeviceForUser({ userId: user._id, deviceId: payload.deviceId });
    if (!deviceRecord) {
      const err = new Error('Invalid or expired token');
      err.status = 401;
      throw err;
    }

    if (deviceRecord.status === 'revoked') {
      const err = new Error('Устройство отозвано');
      err.status = 401;
      err.code = 'DEVICE_REVOKED';
      throw err;
    }

    const deviceTokenVersion = typeof payload.deviceTokenVersion === 'number' ? payload.deviceTokenVersion : 0;
    if ((deviceRecord.tokenVersion || 0) !== deviceTokenVersion) {
      const err = new Error('Invalid or expired token');
      err.status = 401;
      throw err;
    }

    if (req && req.method && req.method !== 'GET') {
      deviceRecord.lastSeenAt = new Date();
      deviceRecord.ipAddress = getRequestIp(req) || deviceRecord.ipAddress || null;
      await deviceRecord.save();
    }

    const { userDto, deviceDto } = await mfaService.loginVerify({
      tempToken,
      payload,
      code,
      device: deviceRecord,
      ipAddress: getRequestIp(req),
    });

    setAuthCookie(res, {
      ...userDto,
      tokenVersion: userDto.tokenVersion || 0,
      deviceId: deviceRecord.deviceId,
      deviceTokenVersion: deviceRecord.tokenVersion || 0,
    });

    return res.json({ user: userDto, device: deviceDto });
  })
);

router.post(
  '/logout',
  authMiddleware,
  asyncHandler(async (req, res) => {
    res.clearCookie('access_token');

    await logEvent({
      actorId: req.user.id,
      event: 'auth_logout',
      ip: getRequestIp(req) || null,
      deviceInfo: req.device
        ? { name: req.device.name, platform: req.device.platform, id: req.device.deviceId }
        : null,
    });

    res.status(204).send();
  })
);

router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user, device: toDeviceDto(req.device) });
  })
);

module.exports = router;
