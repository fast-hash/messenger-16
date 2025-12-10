const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
const { toUserDto } = require('../services/userService');
const { findDeviceForUser } = require('../services/deviceService');
const { getRequestIp } = require('../utils/requestIp');

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies && req.cookies.access_token;

    if (!token) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
    }

    const user = await User.findById(payload.id);
    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
    }

    if (user.accessDisabled) {
      return res.status(403).json({ error: 'Доступ ограничен администратором', code: 'ACCESS_DISABLED' });
    }

    const currentVersion = user.tokenVersion || 0;
    const tokenVersion = typeof payload.tokenVersion === 'number' ? payload.tokenVersion : 0;
    if (tokenVersion !== currentVersion) {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_EXPIRED' });
    }

    const deviceId = payload.deviceId;
    if (!deviceId) {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
    }

    const device = await findDeviceForUser({ userId: user._id, deviceId });
    if (!device) {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
    }

    if (device.status === 'revoked') {
      return res.status(401).json({ error: 'Устройство отозвано', code: 'DEVICE_REVOKED' });
    }

    const deviceTokenVersion = typeof payload.deviceTokenVersion === 'number' ? payload.deviceTokenVersion : 0;
    if (deviceTokenVersion !== (device.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_EXPIRED' });
    }

    if (req && req.method && req.method !== 'GET') {
      device.lastSeenAt = new Date();
      device.ipAddress = getRequestIp(req) || device.ipAddress || null;
      await device.save();
    }

    req.user = toUserDto(user);
    req.device = device;

    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
  }
};

module.exports = authMiddleware;
