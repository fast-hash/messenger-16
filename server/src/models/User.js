const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    displayName: {
      type: String,
      default: function defaultDisplayName() {
        return this.username;
      },
      trim: true,
    },
    role: {
      type: String,
      enum: ['doctor', 'nurse', 'admin', 'staff'],
      default: 'staff',
    },
    department: {
      type: String,
      default: null,
      trim: true,
    },
    jobTitle: {
      type: String,
      default: null,
      trim: true,
    },
    dndEnabled: {
      type: Boolean,
      default: false,
    },
    dndUntil: {
      type: Date,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    accessDisabled: {
      type: Boolean,
      default: false,
    },
    accessDisabledAt: {
      type: Date,
      default: null,
    },
    accessDisabledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    forceTrustNextDevice: {
      type: Boolean,
      default: false,
    },
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    mfaSecret: {
      type: String,
      default: null,
    },
    mfaTempSecret: {
      type: String,
      default: null,
    },
    mfaBackupCodes: {
      type: [String],
      default: [],
    },
  },
  {
    versionKey: false,
  }
);

userSchema.set('toJSON', {
  transform: (_, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
