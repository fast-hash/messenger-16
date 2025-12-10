const noopCrypto = require('./noopCrypto');

module.exports = {
  encrypt: noopCrypto.encrypt,
  decrypt: noopCrypto.decrypt,
};
