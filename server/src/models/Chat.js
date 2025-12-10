const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['direct', 'group'],
      default: 'direct',
    },
    title: {
      type: String,
      default: null,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: [],
      },
    ],
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
    participantsKey: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
    },
    joinRequests: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    removedParticipants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: [],
      },
    ],
    removedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: [],
      },
    ],
    blocks: [
      {
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    readState: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        lastReadAt: { type: Date, default: null },
      },
    ],
    lastMessage: {
      text: { type: String, default: null },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      createdAt: { type: Date, default: null },
    },
    pinnedMessageIds: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Message',
        },
      ],
      default: [],
    },
    muteUntil: {
      type: Date,
      default: null,
    },
    rateLimitPerMinute: {
      type: Number,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

chatSchema.index(
  { participantsKey: 1, type: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { type: 'direct', participantsKey: { $exists: true } },
  }
);

module.exports = mongoose.model('Chat', chatSchema);
