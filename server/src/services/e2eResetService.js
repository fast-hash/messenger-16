const E2EResetRequest = require('../models/E2EResetRequest');
const User = require('../models/User');
const { logEvent } = require('./auditLogService');

const createResetRequest = async ({ userId }) => {
  const existing = await E2EResetRequest.findOne({ userId, status: 'pending' });
  if (existing) {
    return existing;
  }

  const request = await E2EResetRequest.create({ userId, status: 'pending', createdAt: new Date() });

  await logEvent({
    actorId: userId,
    event: 'e2e_reset_requested',
  });

  return request;
};

const getLatestRequestForUser = async ({ userId }) =>
  E2EResetRequest.findOne({ userId }).sort({ createdAt: -1 }).limit(1);

const listPendingRequests = async () =>
  E2EResetRequest.find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .populate('userId', 'username displayName email role');

const approveRequest = async ({ requestId, adminId }) => {
  const request = await E2EResetRequest.findById(requestId);
  if (!request || request.status !== 'pending') {
    const error = new Error('Запрос не найден или уже обработан');
    error.status = 404;
    throw error;
  }

  const user = await User.findById(request.userId);
  if (!user) {
    const error = new Error('Пользователь не найден');
    error.status = 404;
    throw error;
  }

  request.status = 'approved';
  request.processedAt = new Date();
  await request.save();

  user.e2eIdentityResetAllowed = true;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await logEvent({
    actorId: adminId,
    event: 'e2e_reset_approved',
    deviceInfo: { targetUserId: user._id.toString(), requestId: request.id },
  });

  return { request, user };
};

const rejectRequest = async ({ requestId }) => {
  const request = await E2EResetRequest.findById(requestId);
  if (!request || request.status !== 'pending') {
    const error = new Error('Запрос не найден или уже обработан');
    error.status = 404;
    throw error;
  }

  request.status = 'rejected';
  request.processedAt = new Date();
  await request.save();

  return request;
};

module.exports = {
  createResetRequest,
  getLatestRequestForUser,
  listPendingRequests,
  approveRequest,
  rejectRequest,
};
