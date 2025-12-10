const express = require('express');
const authMiddleware = require('../middleware/auth');
const requireTrustedDevice = require('../middleware/requireTrustedDevice');
const asyncHandler = require('../utils/asyncHandler');
const E2EPublicBundle = require('../models/E2EPublicBundle');
const User = require('../models/User');
const { logEvent } = require('../services/auditLogService');
const { getRequestIp } = require('../utils/requestIp');

const router = express.Router();

router.use(authMiddleware);
router.use(requireTrustedDevice);

router.post(
  '/bundle',
  asyncHandler(async (req, res) => {
    const { registrationId, identityKey, signedPreKey, oneTimePreKeys } = req.body || {};

    if (!registrationId || !identityKey || !signedPreKey) {
      return res.status(400).json({ message: 'registrationId, identityKey and signedPreKey are required' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const existingBundle = await E2EPublicBundle.findOne({ userId: req.user.id });

    if (existingBundle && user.e2eIdentityResetAllowed === false) {
      return res.status(403).json({ message: 'Identity rotation is not allowed' });
    }

    const bundle = await E2EPublicBundle.findOneAndUpdate(
      { userId: req.user.id },
      {
        registrationId,
        identityKey,
        signedPreKey,
        oneTimePreKeys: Array.isArray(oneTimePreKeys) ? oneTimePreKeys : [],
        updatedAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    if (user.e2eIdentityResetAllowed) {
      user.e2eIdentityResetAllowed = false;
      await user.save();

      await logEvent({
        actorId: req.user.id,
        event: 'e2e_identity_rotated',
        ip: getRequestIp(req) || null,
        deviceInfo: { bundleId: bundle._id.toString() },
      });
    }

    res.status(201).json({ bundle });
  })
);

router.get(
  '/bundle/:userId',
  asyncHandler(async (req, res) => {
    const targetUserId = req.params.userId;

    if (!targetUserId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const consumed = await E2EPublicBundle.findOneAndUpdate(
      { userId: targetUserId, oneTimePreKeys: { $exists: true, $ne: [] } },
      { $pop: { oneTimePreKeys: -1 }, $set: { updatedAt: new Date() } },
      { new: false }
    );

    let bundleDoc = consumed;
    let oneTimePreKey = null;

    if (consumed && Array.isArray(consumed.oneTimePreKeys) && consumed.oneTimePreKeys.length) {
      oneTimePreKey = consumed.oneTimePreKeys[0];
    }

    if (!bundleDoc) {
      bundleDoc = await E2EPublicBundle.findOneAndUpdate(
        { userId: targetUserId },
        { $set: { updatedAt: new Date() } },
        { new: true }
      );
    }

    if (!bundleDoc) {
      return res.status(404).json({ message: 'Bundle not found' });
    }

    const response = {
      userId: bundleDoc.userId,
      registrationId: bundleDoc.registrationId,
      identityKey: bundleDoc.identityKey,
      signedPreKey: bundleDoc.signedPreKey,
      oneTimePreKey,
    };

    res.json({ bundle: response });
  })
);

module.exports = router;
