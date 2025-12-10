const express = require('express');
const authMiddleware = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const e2eResetService = require('../services/e2eResetService');

const router = express.Router();

router.use(authMiddleware);

router.post(
  '/e2e/request-reset',
  asyncHandler(async (req, res) => {
    const request = await e2eResetService.createResetRequest({ userId: req.user.id });
    res.status(201).json({ request });
  })
);

router.get(
  '/e2e/request-reset',
  asyncHandler(async (req, res) => {
    const request = await e2eResetService.getLatestRequestForUser({ userId: req.user.id });
    res.json({ request });
  })
);

module.exports = router;
