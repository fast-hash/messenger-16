// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  const payload = { error: message };
  if (err.code) payload.code = err.code;
  if (err.retryAt) payload.retryAt = err.retryAt;
  if (err.retryAfterMs) payload.retryAfterMs = err.retryAfterMs;
  if (err.limit) payload.limit = err.limit;
  res.status(status).json(payload);
};

module.exports = errorHandler;
