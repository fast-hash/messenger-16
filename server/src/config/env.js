const dotenv = require('dotenv');

dotenv.config();

const toBool = (value, defaultValue = false) => {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return ['true', '1', 'yes'].includes(String(value).toLowerCase());
};

const parseOrigins = (value, fallback) => {
  const raw = value || fallback;
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/messenger_basic',
  jwtSecret: process.env.JWT_SECRET || 'change_me_to_a_long_random_string',
  mfaMasterKey: process.env.MFA_MASTER_KEY || '',
  corsOrigin: parseOrigins(process.env.CORS_ORIGIN, 'http://localhost:5173'),
  cookieSecure: toBool(process.env.COOKIE_SECURE, false),
  socketPath: process.env.SOCKET_PATH || '/socket.io',
};

module.exports = config;
