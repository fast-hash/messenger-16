const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { encrypt, decrypt } = require('../utils/cryptoUtils');
const { logEvent } = require('./auditLogService');
const config = require('../config/env');
const { toDeviceDto } = require('./deviceService');
const { toUserDto } = require('./userService');

const SERVICE_NAME = 'MediChat';

const generateBackupCodes = () => {
  const codes = [];
  for (let i = 0; i < 8; i += 1) {
    codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
};

const decryptSafe = (value) => {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch (error) {
    return null;
  }
};

const getUserOrFail = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }
  return user;
};

const startSetup = async (userId) => {
  const user = await getUserOrFail(userId);
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(user.email, SERVICE_NAME, secret);
  const qrCodeDataURL = await QRCode.toDataURL(otpauthUrl);

  user.mfaTempSecret = encrypt(secret);
  await user.save();

  return { secret, otpauthUrl, qrCodeDataURL };
};

const consumeBackupCode = (user, code) => {
  if (!code || !Array.isArray(user.mfaBackupCodes)) return false;

  const decryptedCodes = user.mfaBackupCodes.map(decryptSafe);
  const matchIndex = decryptedCodes.findIndex((item) => item && item === code);
  if (matchIndex === -1) return false;

  const updated = [...user.mfaBackupCodes];
  updated.splice(matchIndex, 1);
  user.mfaBackupCodes = updated;
  return true;
};

const verifyAgainstSecret = (user, code) => {
  const activeSecret = decryptSafe(user.mfaTempSecret) || decryptSafe(user.mfaSecret);
  if (activeSecret && authenticator.check(code, activeSecret, { window: 1 })) {
    return { verified: true, usedBackup: false };
  }

  if (consumeBackupCode(user, code)) {
    return { verified: true, usedBackup: true };
  }

  return { verified: false, usedBackup: false };
};

const enableMfa = async ({ userId, code }) => {
  if (!code) {
    const error = new Error('Код подтверждения обязателен');
    error.status = 400;
    throw error;
  }

  const user = await getUserOrFail(userId);
  const tempSecret = decryptSafe(user.mfaTempSecret);
  const finalSecret = tempSecret || decryptSafe(user.mfaSecret);

  if (!finalSecret) {
    const error = new Error('MFA не инициализирована');
    error.status = 400;
    throw error;
  }

  const { verified } = verifyAgainstSecret({ ...user.toObject(), mfaSecret: encrypt(finalSecret) }, code);
  if (!verified) {
    const error = new Error('Неверный код подтверждения');
    error.status = 400;
    throw error;
  }

  const backupCodes = generateBackupCodes();
  user.mfaSecret = encrypt(finalSecret);
  user.mfaEnabled = true;
  user.mfaTempSecret = null;
  user.mfaBackupCodes = backupCodes.map((item) => encrypt(item));

  await user.save();

  await logEvent({ actorId: userId, event: 'mfa_enabled' });

  return { user, backupCodes };
};

const disableMfa = async ({ userId, code }) => {
  if (!code) {
    const error = new Error('Код подтверждения обязателен');
    error.status = 400;
    throw error;
  }

  const user = await getUserOrFail(userId);
  const { verified } = verifyAgainstSecret(user, code);
  if (!verified) {
    const error = new Error('Неверный код подтверждения');
    error.status = 400;
    throw error;
  }

  user.mfaEnabled = false;
  user.mfaSecret = null;
  user.mfaTempSecret = null;
  user.mfaBackupCodes = [];

  await user.save();
  await logEvent({ actorId: userId, event: 'mfa_disabled' });

  return user;
};

const verifySetupCode = async ({ userId, code }) => {
  if (!code) {
    const error = new Error('Код подтверждения обязателен');
    error.status = 400;
    throw error;
  }

  const user = await getUserOrFail(userId);
  const { verified } = verifyAgainstSecret(user, code);
  return { valid: verified };
};

const loginVerify = async ({ tempToken, payload, code, device, ipAddress }) => {
  if (!tempToken || !code) {
    const error = new Error('MFA verification requires token and code');
    error.status = 400;
    throw error;
  }

  let tokenPayload = payload;
  if (!tokenPayload) {
    try {
      tokenPayload = jwt.verify(tempToken, config.jwtSecret);
    } catch (error) {
      const err = new Error('MFA session истекла, выполните вход заново');
      err.status = 401;
      throw err;
    }
  }

  if (tokenPayload.purpose !== 'mfa_login' || !tokenPayload.id) {
    const error = new Error('Недействительный токен подтверждения');
    error.status = 401;
    throw error;
  }

  const user = await getUserOrFail(tokenPayload.id);
  if (user.accessDisabled) {
    const error = new Error('Доступ ограничен администратором');
    error.status = 403;
    error.code = 'ACCESS_DISABLED';
    throw error;
  }

  if (!user.mfaEnabled || !user.mfaSecret) {
    const error = new Error('MFA не включена');
    error.status = 400;
    throw error;
  }

  const { verified, usedBackup } = verifyAgainstSecret(user, code);
  if (!verified) {
    const error = new Error('Неверный код подтверждения');
    error.status = 400;
    throw error;
  }

  if (usedBackup) {
    await user.save();
  }

  const userDto = toUserDto(user);

  const deviceDto = toDeviceDto(device);

  await logEvent({ actorId: userDto.id, event: 'auth_login', deviceInfo: deviceDto, ip: ipAddress || null });

  return { user, userDto, deviceDto };
};

const getBackupCodes = async ({ userId }) => {
  const user = await getUserOrFail(userId);
  if (!user.mfaEnabled || !user.mfaSecret) {
    const error = new Error('MFA не включена');
    error.status = 400;
    throw error;
  }

  return (user.mfaBackupCodes || []).map(decryptSafe).filter(Boolean);
};

const resetMfaByAdmin = async ({ targetUserId, adminId, ipAddress }) => {
  const user = await getUserOrFail(targetUserId);
  user.mfaEnabled = false;
  user.mfaSecret = null;
  user.mfaTempSecret = null;
  user.mfaBackupCodes = [];

  await user.save();

  await logEvent({
    actorId: adminId,
    event: 'mfa_reset_admin',
    ip: ipAddress || null,
    deviceInfo: { targetUserId: user._id.toString() },
  });

  return user;
};

module.exports = {
  startSetup,
  enableMfa,
  disableMfa,
  verifySetupCode,
  loginVerify,
  getBackupCodes,
  resetMfaByAdmin,
};
