module.exports = {
  async encrypt(plaintext) {
    return {
      ciphertext: null,
      plaintext,
      encryption: null,
    };
  },

  async decrypt(messageDoc) {
    return messageDoc.plaintext || '';
  },
};
