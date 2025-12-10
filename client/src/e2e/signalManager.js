import localforage from 'localforage';
import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from '@jafoor/libsignal-protocol-typescript';
import httpClient from '../api/httpClient';

const storage = localforage.createInstance({ name: 'signal-storage' });

// --- Helpers ---
const base64ToArrayBuffer = (b64) => {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (error) {
    console.error('Signal: Failed to decode base64', error);
    return null;
  }
};

const bufferToBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const serializeKeyPair = (keyPair) => ({
  publicKey: bufferToBase64(keyPair.publicKey),
  privateKey: bufferToBase64(keyPair.privateKey),
});

const deserializeKeyPair = (keyPair) => {
  if (!keyPair || !keyPair.publicKey || !keyPair.privateKey) {
     throw new Error('Invalid keypair object');
  }
  const pubKey = base64ToArrayBuffer(keyPair.publicKey);
  const privKey = base64ToArrayBuffer(keyPair.privateKey);
  if (!pubKey || !privKey) throw new Error('Failed to deserialize keypair');
  return { pubKey, privKey };
};

// --- Core ---

const generateOneTimePreKeys = async (count = 10, startId = 1) => {
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    const preKeyId = startId + i;
    // eslint-disable-next-line no-await-in-loop
    const preKey = await KeyHelper.generatePreKey(preKeyId);
    keys.push({ keyId: preKeyId, publicKey: bufferToBase64(preKey.keyPair.publicKey) });
  }
  return keys;
};

const publishBundle = async ({ registrationId, identityKeyPair, signedPreKey, oneTimePreKeys }) => {
  const signedPreKeyPublicKey = signedPreKey.keyPair?.publicKey || signedPreKey.publicKey;
  const identityKeyBuffer = identityKeyPair.publicKey || identityKeyPair;

  const payload = {
    registrationId,
    identityKey: bufferToBase64(identityKeyBuffer),
    signedPreKey: {
      keyId: signedPreKey.keyId,
      publicKey: bufferToBase64(signedPreKeyPublicKey),
      signature: bufferToBase64(signedPreKey.signature),
    },
    oneTimePreKeys,
  };

  try {
    await httpClient.post('/api/e2e/bundle', payload);
    console.log('Signal: Bundle published successfully');
  } catch (error) {
    // Игнорируем ошибку 403 (ключи уже есть), это нормально
    if (error.response && error.response.status === 403) {
       console.log('Signal: Bundle already exists on server (Sync OK)');
    } else {
       console.error('Signal: Failed to publish bundle', error);
       throw error;
    }
  }
};

const resetIdentity = async () => {
  console.log('Signal: Resetting identity...');
  await storage.clear();

  const registrationId = await KeyHelper.generateRegistrationId();
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
  const oneTimePreKeys = await generateOneTimePreKeys(10, 1);

  await storage.setItem('registrationId', registrationId);
  await storage.setItem('identityKey', serializeKeyPair(identityKeyPair));
  await storage.setItem('signedPreKey', {
    keyId: signedPreKey.keyId,
    keyPair: serializeKeyPair(signedPreKey.keyPair),
    signature: bufferToBase64(signedPreKey.signature),
  });
  await storage.setItem('oneTimePreKeys', oneTimePreKeys);

  await publishBundle({ registrationId, identityKeyPair, signedPreKey, oneTimePreKeys });
};

const getStore = () => ({
  get: async (key) => storage.getItem(key),
  put: async (key, value) => storage.setItem(key, value),
  remove: async (key) => storage.removeItem(key),
});

const ensureIdentity = async () => {
  const registrationId = await storage.getItem('registrationId');
  if (!registrationId) {
    await resetIdentity();
  }
};

const getAddress = (userId) => new SignalProtocolAddress((userId || '').toString(), 1);

const prepareSession = async (recipientId) => {
  const store = getStore();
  const address = getAddress(recipientId);

  const hasSession = await store.get(`session${address.toString()}`);
  if (hasSession) return { store, address };

  const { data } = await httpClient.get(`/api/e2e/bundle/${recipientId}`);
  const bundle = data?.bundle;
  if (!bundle) throw new Error(`Recipient bundle missing for ${recipientId}`);

  const builder = new SessionBuilder(store, address);
  await builder.processPreKey({
    registrationId: bundle.registrationId,
    identityKey: base64ToArrayBuffer(bundle.identityKey),
    signedPreKey: {
      keyId: bundle.signedPreKey.keyId,
      publicKey: base64ToArrayBuffer(bundle.signedPreKey.publicKey),
      signature: base64ToArrayBuffer(bundle.signedPreKey.signature),
    },
    preKey: bundle.oneTimePreKey
      ? {
          keyId: bundle.oneTimePreKey.keyId,
          publicKey: base64ToArrayBuffer(bundle.oneTimePreKey.publicKey),
        }
      : undefined,
  });
  console.log(`Signal: Session established with ${recipientId}`);
  return { store, address };
};

// --- Public Methods ---

const forceUpdateSession = async (recipientId) => {
  try {
    const address = getAddress(recipientId);
    const store = getStore();
    console.log('Signal: Force updating session for', recipientId);
    await store.remove(`session${address.toString()}`);
    await prepareSession(recipientId);
  } catch (e) {
    console.error('Signal: Force update failed', e);
    throw e;
  }
};

let initPromise = null;

const init = async () => {
  // Singleton pattern: предотвращаем двойной запуск
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    try {
      const identity = await storage.getItem('identityKey');
      const signedPreKey = await storage.getItem('signedPreKey');
      const registrationId = await storage.getItem('registrationId');

      if (!identity || !signedPreKey || !registrationId) {
        await resetIdentity();
        return;
      }

      // Load into memory (libsignal requirement)
      const store = getStore();
      const deserializedIdentity = deserializeKeyPair(identity);
      const signedPubKey = base64ToArrayBuffer(signedPreKey.keyPair.publicKey);
      const signedPrivKey = base64ToArrayBuffer(signedPreKey.keyPair.privateKey);
      const signature = base64ToArrayBuffer(signedPreKey.signature);

      await store.put('identityKey', deserializedIdentity);
      await store.put('registrationId', registrationId);
      await store.put(`signedKey${signedPreKey.keyId}`, {
        pubKey: signedPubKey,
        privKey: signedPrivKey,
        signature,
      });
      
      // Auto-Heal: Всегда отправляем ключи на сервер при старте,
      // чтобы восстановиться после очистки базы.
      await publishBundle({
          registrationId,
          identityKeyPair: { publicKey: base64ToArrayBuffer(identity.publicKey) }, 
          signedPreKey: {
              keyId: signedPreKey.keyId,
              publicKey: signedPubKey,
              signature: signature
          },
          oneTimePreKeys: (await storage.getItem('oneTimePreKeys')) || []
      });

    } catch (error) {
      console.error('Signal: Init failed, performing hard reset...', error);
      initPromise = null; // reset lock
      await resetIdentity();
    }
  })();
  
  return initPromise;
};

const encryptMessage = async (recipientId, text) => {
  await init(); // Ensure initialized
  const { store, address } = await prepareSession(recipientId);
  const cipher = new SessionCipher(store, address);
  const result = await cipher.encrypt(new TextEncoder().encode(text));
  return {
    ciphertext: bufferToBase64(result.body),
    cipherType: result.type,
  };
};

const decryptMessage = async (senderId, ciphertext, cipherType) => {
  await init(); // Ensure initialized
  const store = getStore();
  const address = getAddress(senderId);
  const cipher = new SessionCipher(store, address);
  const body = base64ToArrayBuffer(ciphertext);
  
  let decrypted;
  if (cipherType === 3) {
      decrypted = await cipher.decryptPreKeyWhisperMessage(body, 'binary');
  } else {
      decrypted = await cipher.decryptWhisperMessage(body, 'binary');
  }
  return new TextDecoder().decode(decrypted);
};

export default {
  resetIdentity,
  publishBundle,
  encryptMessage,
  decryptMessage,
  init,
  forceUpdateSession,
};
