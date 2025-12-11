import localforage from 'localforage';
import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from '@jafoor/libsignal-protocol-typescript';
import httpClient from '../api/httpClient';

const storage = localforage.createInstance({ name: 'signal-storage' });

const base64ToArrayBuffer = (b64) => {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (error) {
    console.error('Failed to decode base64', error);
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
  const pubKey = base64ToArrayBuffer(keyPair.publicKey);
  const privKey = base64ToArrayBuffer(keyPair.privateKey);

  if (!pubKey || !privKey) {
    throw new Error('Invalid keypair data');
  }

  return { pubKey, privKey };
};

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
  // Проверяем формат ключа (объект или прямой ключ) для совместимости
  const signedPreKeyPublicKey = signedPreKey.keyPair
    ? signedPreKey.keyPair.publicKey
    : signedPreKey.publicKey;

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

  await httpClient.post('/api/e2e/bundle', payload);
};

const resetIdentity = async () => {
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
  const identityKey = await storage.getItem('identityKey');
  const signedPreKey = await storage.getItem('signedPreKey');

  if (!registrationId || !identityKey || !signedPreKey) {
    await resetIdentity();
  }
};

const getAddress = (userId) => new SignalProtocolAddress((userId || '').toString(), 1);

const buildSession = async (store, address, bundle) => {
  if (!bundle) throw new Error('Recipient bundle missing');

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
};

const prepareSession = async (recipientId) => {
  const store = getStore();
  const address = getAddress(recipientId);

  const hasSession = await store.get(`session${address.toString()}`);
  if (hasSession) return { store, address };

  const { data } = await httpClient.get(`/api/e2e/bundle/${recipientId}`);
  const bundle = data?.bundle;

  await buildSession(store, address, bundle);

  return { store, address };
};

// Функция для сброса сломанной сессии и загрузки новых ключей
const forceUpdateSession = async (recipientId) => {
  try {
    const address = getAddress(recipientId);
    const store = getStore();
    console.log('Signal: Force updating session for', recipientId);
    
    const addrString = address.toString();
    // FIX: Remove BOTH session and identity key to force fresh fetch
    await store.remove('session' + addrString);
    await store.remove('identityKey' + addrString); 
    
    await prepareSession(recipientId);
  } catch (e) {
    console.error('Signal: Force update failed', e);
    throw e;
  }
};

const encryptMessage = async (recipientId, text) => {
  await ensureIdentity();
  await init();
  const { store, address } = await prepareSession(recipientId);
  const cipher = new SessionCipher(store, address);
  const result = await cipher.encrypt(new TextEncoder().encode(text));

  return {
    ciphertext: bufferToBase64(result.body),
    cipherType: result.type,
  };
};

const decryptMessage = async (senderId, ciphertext, cipherType) => {
  await ensureIdentity();
  await init();
  const store = getStore();
  const address = getAddress(senderId);
  const cipher = new SessionCipher(store, address);
  const body = base64ToArrayBuffer(ciphertext);
  if (!body) {
    throw new Error('Invalid ciphertext payload');
  }

  const decrypted =
    cipherType === 3
      ? await cipher.decryptPreKeyWhisperMessage(body, 'binary')
      : await cipher.decryptWhisperMessage(body, 'binary');

  return new TextDecoder().decode(decrypted);
};

const init = async () => {
  // 1. Загружаем ключи
  const identity = await storage.getItem('identityKey');
  const signedPreKey = await storage.getItem('signedPreKey');
  const oneTimePreKeys = (await storage.getItem('oneTimePreKeys')) || [];
  const registrationId = await storage.getItem('registrationId');

  // 2. Если ключей нет - создаем
  if (!identity || !signedPreKey || !registrationId) {
    console.log('E2E: No local identity. Generating new...');
    await resetIdentity();
    return;
  }

  // 3. Если есть - загружаем в память
  try {
    const store = getStore();
    const deserializedIdentity = deserializeKeyPair(identity);
    const signedPubKey = base64ToArrayBuffer(signedPreKey.keyPair.publicKey);
    const signedPrivKey = base64ToArrayBuffer(signedPreKey.keyPair.privateKey);
    const signature = base64ToArrayBuffer(signedPreKey.signature);

    if (!signedPubKey || !signedPrivKey || !signature) {
      throw new Error('Invalid signed pre-key data');
    }

    await store.put('identityKey', deserializedIdentity);
    await store.put('registrationId', registrationId);
    await store.put(`signedKey${signedPreKey.keyId}`, {
      pubKey: signedPubKey,
      privKey: signedPrivKey,
      signature,
    });

    await Promise.all(
      oneTimePreKeys.map((pk) => {
        const pubKey = base64ToArrayBuffer(pk.publicKey);
        if (!pubKey) throw new Error('Invalid one-time pre-key');
        return store.put(`preKey${pk.keyId}`, {
          pubKey,
          privKey: null,
        });
      })
    );

    // 4. ГЛАВНОЕ: Всегда отправляем ключи на сервер при старте.
    // Это чинит проблему, когда базу очистили, а клиент "помнит" ключи.
    console.log('E2E: Verifying/Updating server bundle...');
    await publishBundle({
        registrationId,
        identityKeyPair: { publicKey: base64ToArrayBuffer(identity.publicKey) },
        signedPreKey: {
            keyId: signedPreKey.keyId,
            publicKey: signedPubKey,
            signature: signature
        },
        oneTimePreKeys: oneTimePreKeys 
    });
    console.log('E2E: Bundle synced with server successfully.');

  } catch (error) {
    console.warn('Signal init/sync failed. Data corrupted? Resetting identity...', error);
    // Если локальные данные битые - сбрасываем
    if (error.message && (error.message.includes('base64') || error.message.includes('Invalid') || error.message.includes('keypair'))) {
       await resetIdentity();
    }
  }
};

export default {
  resetIdentity,
  publishBundle,
  encryptMessage,
  decryptMessage,
  init,
  forceUpdateSession,
};
