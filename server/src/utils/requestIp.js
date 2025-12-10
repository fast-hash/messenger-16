const getRequestIp = (req) => {
  const forwarded = req.headers && req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const parts = forwarded.split(',');
    if (parts.length) {
      return parts[0].trim();
    }
  }

  if (req.ip) {
    return req.ip;
  }

  return null;
};

module.exports = {
  getRequestIp,
};
