const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    uploaderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    storageKey: { type: String, required: true },
    status: { type: String, enum: ['uploaded', 'linked'], default: 'uploaded' },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

attachmentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
attachmentSchema.index({ chatId: 1, createdAt: 1 });

module.exports = mongoose.model('Attachment', attachmentSchema);
