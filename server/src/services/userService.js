const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { logEvent } = require('./auditLogService');

const SALT_ROUNDS = 10;

const ALLOWED_ROLES = ['doctor', 'nurse', 'admin', 'staff'];

const normalizeRole = (role) => (ALLOWED_ROLES.includes(role) ? role : 'staff');

const toUserDto = (userDoc) => ({
  id: userDoc._id.toString(),
  username: userDoc.username,
  email: userDoc.email,
  displayName: userDoc.displayName,
  role: userDoc.role,
  department: userDoc.department,
  jobTitle: userDoc.jobTitle,
  dndEnabled: userDoc.dndEnabled || false,
  dndUntil: userDoc.dndUntil || null,
  createdAt: userDoc.createdAt,
  accessDisabled: userDoc.accessDisabled || false,
  accessDisabledAt: userDoc.accessDisabledAt || null,
  accessDisabledBy: userDoc.accessDisabledBy ? userDoc.accessDisabledBy.toString() : null,
  tokenVersion: userDoc.tokenVersion || 0,
  forceTrustNextDevice: userDoc.forceTrustNextDevice || false,
  mfaEnabled: userDoc.mfaEnabled || false,
});

const ensureUniqueUser = async ({ username, email }) => {
  const normalizedEmail = (email || '').toLowerCase();

  const [existingEmail, existingUsername] = await Promise.all([
    User.findOne({ email: normalizedEmail }),
    User.findOne({ username }),
  ]);

  if (existingEmail) {
    const error = new Error('Email is already registered');
    error.status = 409;
    throw error;
  }

  if (existingUsername) {
    const error = new Error('Username is already taken');
    error.status = 409;
    throw error;
  }
};

const createUser = async ({
  username,
  email,
  password,
  passwordHash,
  displayName,
  role,
  department,
  jobTitle,
}) => {
  if (!username || !email || (!password && !passwordHash)) {
    const error = new Error('Username, email, and password are required');
    error.status = 400;
    throw error;
  }

  const normalizedEmail = email.toLowerCase();

  await ensureUniqueUser({ username, email: normalizedEmail });

  const hash = passwordHash || (await bcrypt.hash(password, SALT_ROUNDS));

  const user = await User.create({
    username,
    email: normalizedEmail,
    passwordHash: hash,
    displayName: displayName || username,
    role: normalizeRole(role),
    department: department || null,
    jobTitle: jobTitle || null,
  });

  return toUserDto(user);
};

const authenticateUser = async ({ email, password }) => {
  if (!email || !password) {
    const error = new Error('Email and password are required');
    error.status = 400;
    throw error;
  }

  const normalizedEmail = email.toLowerCase();

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    const error = new Error('Invalid credentials');
    error.status = 401;
    throw error;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    const error = new Error('Invalid credentials');
    error.status = 401;
    throw error;
  }

  if (user.accessDisabled) {
    const error = new Error('Доступ ограничен администратором');
    error.status = 403;
    error.code = 'ACCESS_DISABLED';
    throw error;
  }

  return toUserDto(user);
};

const searchUsers = async ({ query, excludeUserId }) => {
  const trimmed = (query || '').trim();

  if (!trimmed) {
    const users = await User.find({ _id: { $ne: excludeUserId } })
      .limit(50)
      .sort({ createdAt: -1 });
    return users.map(toUserDto);
  }

  // Экранируем спецсимволы, чтобы искать буквальный текст без падений RegExp
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');

  const users = await User.find({
    _id: { $ne: excludeUserId },
    $or: [{ username: regex }, { displayName: regex }, { email: regex }],
  })
    .limit(20)
    .sort({ createdAt: -1 });

  return users.map(toUserDto);
};

const getUserById = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }
  return toUserDto(user);
};

const updatePreferences = async ({ userId, dndEnabled, dndUntil }) => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  if (typeof dndEnabled !== 'undefined') {
    user.dndEnabled = Boolean(dndEnabled);
  }

  if (typeof dndUntil !== 'undefined') {
    if (dndUntil === null || dndUntil === '') {
      user.dndUntil = null;
    } else {
      const untilDate = new Date(dndUntil);
      if (Number.isNaN(untilDate.getTime())) {
        const error = new Error('Invalid dndUntil value');
        error.status = 400;
        throw error;
      }
      user.dndUntil = untilDate;
    }
  }

  await user.save();
  return toUserDto(user);
};

const listAllUsers = async () => {
  const users = await User.find().sort({ createdAt: -1 });
  return users.map(toUserDto);
};

const disableUser = async ({ targetUserId, adminId }) => {
  const user = await User.findById(targetUserId);
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  user.accessDisabled = true;
  user.accessDisabledAt = new Date();
  user.accessDisabledBy = adminId;
  user.tokenVersion = (user.tokenVersion || 0) + 1;

  await user.save();
  return toUserDto(user);
};

const enableUser = async ({ targetUserId }) => {
  const user = await User.findById(targetUserId);
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  user.accessDisabled = false;
  user.accessDisabledAt = null;
  user.accessDisabledBy = null;

  await user.save();
  return toUserDto(user);
};

const allowNextDeviceTrust = async ({ targetUserId, adminId, ipAddress }) => {
  const user = await User.findById(targetUserId);
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  user.forceTrustNextDevice = true;
  await user.save();

  await logEvent({
    actorId: adminId,
    event: 'device_trust_reset',
    ip: ipAddress || null,
    deviceInfo: { targetUserId: user._id.toString() },
  });

  return toUserDto(user);
};

module.exports = {
  createUser,
  authenticateUser,
  searchUsers,
  getUserById,
  updatePreferences,
  toUserDto,
  ensureUniqueUser,
  listAllUsers,
  disableUser,
  enableUser,
  allowNextDeviceTrust,
};
