const jwt = require('jsonwebtoken');
const config = require('../config/env');

const setAuthCookie = (res, payload) => {
  const tokenPayload = {
    ...payload,
    tokenVersion: payload.tokenVersion || 0,
  };

  if (payload.deviceId) {
    tokenPayload.deviceId = payload.deviceId;
    tokenPayload.deviceTokenVersion = payload.deviceTokenVersion || 0;
  }

  const token = jwt.sign(tokenPayload, config.jwtSecret, { expiresIn: '7d' });
  res.cookie('access_token', token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

module.exports = {
  setAuthCookie,
};
