const Device = require('../models/Device');
const { logEvent } = require('./auditLogService');

const DEVICE_STATUSES = ['trusted', 'untrusted', 'revoked'];

const toDeviceDto = (deviceDoc) => {
  if (!deviceDoc) return null;
  return {
    id: deviceDoc._id.toString(),
    userId: deviceDoc.userId.toString(),
    deviceId: deviceDoc.deviceId,
    name: deviceDoc.name,
    platform: deviceDoc.platform,
    status: deviceDoc.status,
    tokenVersion: deviceDoc.tokenVersion || 0,
    lastSeenAt: deviceDoc.lastSeenAt,
    ipAddress: deviceDoc.ipAddress || null,
  };
};

const registerOrUpdateDevice = async ({ userId, device, ipAddress, trustOnCreate = false, forceTrust = false }) => {
  const normalizedDeviceId = (device && device.deviceId) || null;
  if (!normalizedDeviceId) {
    const error = new Error('Device information is required');
    error.status = 400;
    throw error;
  }

  const name = (device && device.name) || 'Unknown device';
  const platform = (device && device.platform) || 'unknown';

  const existing = await Device.findOne({ userId, deviceId: normalizedDeviceId });
  if (existing) {
    if (existing.status === 'revoked') {
      const error = new Error('Device access revoked');
      error.status = 401;
      error.code = 'DEVICE_REVOKED';
      throw error;
    }

    existing.name = name;
    existing.platform = platform;
    existing.lastSeenAt = new Date();
    existing.ipAddress = ipAddress || existing.ipAddress || null;

    if (forceTrust && existing.status !== 'trusted') {
      existing.status = 'trusted';
      await logEvent({
        actorId: userId,
        event: 'device_trusted',
        ip: ipAddress || null,
        deviceInfo: { name: existing.name, platform: existing.platform, id: existing.deviceId },
      });
    }
    await existing.save();
    return existing;
  }

  const newDevice = await Device.create({
    userId,
    deviceId: normalizedDeviceId,
    name,
    platform,
    status: trustOnCreate ? 'trusted' : 'untrusted',
    tokenVersion: 0,
    lastSeenAt: new Date(),
    ipAddress: ipAddress || null,
  });

  await logEvent({
    actorId: userId,
    event: 'device_new',
    ip: ipAddress || null,
    deviceInfo: { name, platform, id: normalizedDeviceId },
  });

  if (trustOnCreate) {
    await logEvent({
      actorId: userId,
      event: 'device_trusted',
      ip: ipAddress || null,
      deviceInfo: { name, platform, id: normalizedDeviceId },
    });
  }

  return newDevice;
};

const listUserDevices = async (userId) => {
  const devices = await Device.find({ userId }).sort({ lastSeenAt: -1 });
  return devices.map(toDeviceDto);
};

const findDeviceForUser = async ({ userId, deviceId }) => Device.findOne({ userId, deviceId });

const updateDeviceStatus = async ({ targetDeviceId, userId, status, actorId, ipAddress }) => {
  if (!DEVICE_STATUSES.includes(status)) {
    const error = new Error('Invalid status');
    error.status = 400;
    throw error;
  }

  const device = await Device.findOne({ _id: targetDeviceId, userId });
  if (!device) {
    const error = new Error('Device not found');
    error.status = 404;
    throw error;
  }

  device.status = status;
  if (status === 'revoked') {
    device.tokenVersion = (device.tokenVersion || 0) + 1;
  }
  device.lastSeenAt = new Date();
  device.ipAddress = ipAddress || device.ipAddress || null;
  await device.save();

  if (status === 'revoked') {
    await logEvent({
      actorId,
      event: 'device_revoked',
      ip: ipAddress || null,
      deviceInfo: { name: device.name, platform: device.platform, id: device.deviceId },
    });
  }

  if (status === 'trusted') {
    await logEvent({
      actorId,
      event: 'device_trusted',
      ip: ipAddress || null,
      deviceInfo: { name: device.name, platform: device.platform, id: device.deviceId },
    });
  }

  return toDeviceDto(device);
};

module.exports = {
  registerOrUpdateDevice,
  listUserDevices,
  updateDeviceStatus,
  toDeviceDto,
  findDeviceForUser,
};
