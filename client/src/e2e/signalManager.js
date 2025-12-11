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
  if (!b64) return new ArrayBuffer(0);
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (error) {
    console.error('Signal: Failed to decode base64', error);
    return new ArrayBuffer(0);
  }
};

const bufferToBase64 = (buf) => {
  if (!buf) return '';
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

  if (pubKey.byteLength === 0 || privKey.byteLength === 0) {
    throw new Error('Invalid keypair data (empty buffer)');
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

// --- Core Logic ---

const publishBundle = async ({ registrationId, identityKeyPair, signedPreKey, oneTimePreKeys }) => {
  // 1. Подготовка данных
  // Извлекаем публичные ключи, поддерживая и сырые объекты KeyHelper, и наши структуры
  const signedPreKeyPublicKey = signedPreKey.keyPair
    ? signedPreKey.keyPair.publicKey
    : signedPreKey.publicKey;

  const identityKeyBuffer = identityKeyPair.publicKey || identityKeyPair;

  // 2. Валидация перед отправкой (чтобы избежать 400 Bad Request)
  const identityKeyB64 = bufferToBase64(identityKeyBuffer);
  const signedPreKeyB64 = bufferToBase64(signedPreKeyPublicKey);
  const signatureB64 = bufferToBase64(signedPreKey.signature);

  // ПРОВЕРКА: Если данных нет, не отправляем запрос, чтобы не получить 400
  if (!registrationId || !identityKeyB64 || !signedPreKeyB64 || !signatureB64) {
    console.error('E2E: Aborting publish. Missing keys:', {
      hasRegId: !!registrationId,
      hasIdentity: !!identityKeyB64,
      hasSignedKey: !!signedPreKeyB64,
      hasSignature: !!signatureB64
    });
    throw new Error('Attempted to publish invalid/empty keys');
  }

  const payload = {
    registrationId: Number(registrationId), // <--- ФИКС: Явное приведение к числу
    identityKey: identityKeyB64,
    signedPreKey: {
      keyId: Number(signedPreKey.keyId), // <--- ФИКС: Явное приведение к числу
      publicKey: signedPreKeyB64,
      signature: signatureB64,
    },
    oneTimePreKeys,
  };

  // 3. Отправка
  await httpClient.post('/api/e2e/bundle', payload);
};

const resetIdentity = async () => {
  console.log('E2E: Starting identity reset...');
  await storage.clear();

  try {
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

    console.log('E2E: Local keys generated. Publishing to server...');
    await publishBundle({ registrationId, identityKeyPair, signedPreKey, oneTimePreKeys });
    console.log('E2E: Identity reset and published successfully.');
  } catch (err) {
    console.error('E2E: Failed to complete resetIdentity.', err);
  }
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

const encryptMessage = async (recipientId, text) => {
  await ensureIdentity();
  // Убрали await init() чтобы избежать цикличности
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
  const store = getStore();
  const address = getAddress(senderId);
  const cipher = new SessionCipher(store, address);
  const body = base64ToArrayBuffer(ciphertext);
  if (!body || body.byteLength === 0) {
    throw new Error('Invalid ciphertext payload');
  }

  const decrypted =
    cipherType === 3
      ? await cipher.decryptPreKeyWhisperMessage(body, 'binary')
      : await cipher.decryptWhisperMessage(body, 'binary');

  return new TextDecoder().decode(decrypted);
};

// --- SAFE INIT FUNCTION ---
const init = async () => {
  // 1. ПРОВЕРКА НАЛИЧИЯ
  const identity = await storage.getItem('identityKey');
  const signedPreKey = await storage.getItem('signedPreKey');
  const registrationId = await storage.getItem('registrationId');
  const oneTimePreKeys = (await storage.getItem('oneTimePreKeys')) || [];

  // Если данных нет совсем — генерируем
  if (!identity || !signedPreKey || !registrationId) {
    console.log('E2E: No local identity found. Generating new...');
    await resetIdentity();
    return;
  }

  let parsedIdentity;
  let parsedSignedPubKey;
  let parsedSignature;
  let parsedPrivKey;

  // 2. БЛОК ЦЕЛОСТНОСТИ ДАННЫХ
  try {
    const store = getStore();
    parsedIdentity = deserializeKeyPair(identity);
    parsedSignedPubKey = base64ToArrayBuffer(signedPreKey.keyPair.publicKey);
    parsedPrivKey = base64ToArrayBuffer(signedPreKey.keyPair.privateKey);
    parsedSignature = base64ToArrayBuffer(signedPreKey.signature);

    if (parsedSignedPubKey.byteLength === 0 || parsedPrivKey.byteLength === 0 || parsedSignature.byteLength === 0) {
      throw new Error('Local keys are empty/corrupted');
    }

    await store.put('identityKey', parsedIdentity);
    await store.put('registrationId', registrationId);
    await store.put(`signedKey${signedPreKey.keyId}`, {
      pubKey: parsedSignedPubKey,
      privKey: parsedPrivKey,
      signature: parsedSignature,
    });

    await Promise.all(
      oneTimePreKeys.map((pk) => {
        const pubKey = base64ToArrayBuffer(pk.publicKey);
        return store.put(`preKey${pk.keyId}`, { pubKey, privKey: null });
      })
    );

  } catch (error) {
    console.error('E2E: Local data corrupted. Resetting identity.', error);
    await resetIdentity();
    return;
  }

  // 3. СИНХРОНИЗАЦИЯ С СЕРВЕРОМ
  const syncWithServer = async (retryCount = 0) => {
    try {
      console.log(`E2E: Attempting server sync (attempt ${retryCount + 1})...`);
      
      await publishBundle({
        registrationId,
        identityKeyPair: { publicKey: base64ToArrayBuffer(identity.publicKey) },
        signedPreKey: {
            keyId: signedPreKey.keyId,
            publicKey: parsedSignedPubKey,
            signature: parsedSignature
        },
        oneTimePreKeys: oneTimePreKeys 
      });
      
      console.log('E2E: Sync complete. Server has up-to-date keys.');
    } catch (networkError) {
      console.warn('E2E: Server sync failed.', networkError.message);
      
      // Если 400 - это не ошибка сети, а ошибка данных. Ретрай не поможет.
      if (networkError.response?.status === 400) {
          console.error('E2E: Server rejected keys (400 Bad Request). Data format mismatch.');
          // В этом крайнем случае имеет смысл сбросить, так как локальные данные несовместимы с сервером
          // Но чтобы не уйти в бесконечный цикл, делаем это аккуратно или просто останавливаемся.
          return;
      }

      if (retryCount < 1) { 
        setTimeout(() => syncWithServer(retryCount + 1), 2000);
      }
    }
  };

  await syncWithServer();
};

const forceUpdateSession = async (recipientId) => {
  try {
    const address = getAddress(recipientId);
    const store = getStore();
    console.log('Signal: Force updating session for', recipientId);
    await store.remove('session' + address.toString());
    await store.remove('identityKey' + address.toString()); 
    await prepareSession(recipientId);
  } catch (e) {
    console.error('Force update failed:', e);
    throw e;
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
