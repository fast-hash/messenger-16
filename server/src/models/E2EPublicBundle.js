const mongoose = require('mongoose');

const e2ePublicBundleSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      unique: true,
      required: true,
    },
    registrationId: {
      type: Number,
      required: true,
    },
    identityKey: {
      type: String,
      required: true,
    },
    signedPreKey: {
      type: Object,
      required: true,
    },
    oneTimePreKeys: {
      type: [Object],
      default: [],
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

e2ePublicBundleSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model('E2EPublicBundle', e2ePublicBundleSchema);
