const AuditEvent = require('../models/AuditEvent');

const logEvent = async ({ actorId, event, ip, deviceInfo }) => {
  if (!actorId || !event) {
    return null;
  }

  const payload = {
    actorId,
    event,
    ip: ip || null,
    deviceInfo: deviceInfo || null,
    createdAt: new Date(),
  };

  return AuditEvent.create(payload);
};

module.exports = {
  logEvent,
};
