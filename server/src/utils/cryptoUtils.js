const crypto = require('crypto');

const getKey = () => {
  const key = process.env.MFA_MASTER_KEY;
  if (!key) {
    throw new Error('MFA master key is not configured');
  }

  const bufferKey = Buffer.from(key);
  if (bufferKey.length !== 32) {
    throw new Error('MFA master key must be 32 bytes long');
  }

  return bufferKey;
};

const encrypt = (plainText) => {
  if (typeof plainText !== 'string') {
    if (plainText === undefined || plainText === null) {
      throw new Error('Cannot encrypt empty value');
    }
    // Ensure non-string values are stringified consistently
    // eslint-disable-next-line no-param-reassign
    plainText = String(plainText);
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
};

const decrypt = (encryptedText) => {
  if (!encryptedText || typeof encryptedText !== 'string') {
    throw new Error('Encrypted payload is required');
  }

  const [ivB64, payloadB64, tagB64] = encryptedText.split(':');
  if (!ivB64 || !payloadB64 || !tagB64) {
    throw new Error('Invalid encrypted payload format');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadB64, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
};

module.exports = {
  encrypt,
  decrypt,
};
