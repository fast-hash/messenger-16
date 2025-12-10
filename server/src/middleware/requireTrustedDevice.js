module.exports = function requireTrustedDevice(req, res, next) {
  if (!req.device || req.device.status !== 'trusted') {
    return res.status(403).json({ error: 'Device not trusted', code: 'DEVICE_UNTRUSTED' });
  }

  return next();
};
