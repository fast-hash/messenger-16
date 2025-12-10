const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      default: 'Unknown device',
      trim: true,
    },
    platform: {
      type: String,
      default: 'unknown',
      trim: true,
    },
    status: {
      type: String,
      enum: ['trusted', 'untrusted', 'revoked'],
      default: 'untrusted',
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    ipAddress: {
      type: String,
      default: null,
    },
  },
  { versionKey: false }
);

deviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

deviceSchema.set('toJSON', {
  transform: (_, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    return ret;
  },
});

module.exports = mongoose.model('Device', deviceSchema);
