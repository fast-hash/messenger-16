const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }

  return next();
};

module.exports = requireAdmin;
