import localforage from 'localforage';
import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from '@jafoor/libsignal-protocol-typescript';
import httpClient from '../api/httpClient';

const storage = localforage.createInstance({ name: 'signal-storage' });

// --- Вспомогательные функции (Helpers) ---

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

// --- Основная логика Signal ---

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
  console.log('E2E: Resetting identity keys...');
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

  // Пытаемся сразу опубликовать новые ключи
  try {
    await publishBundle({ registrationId, identityKeyPair, signedPreKey, oneTimePreKeys });
    console.log('E2E: New identity published successfully.');
  } catch (e) {
    console.warn('E2E: Created new identity but failed to publish immediately (network error). Will retry on next init.', e);
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
  await init(); // Убедимся, что мы инициализированы
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
  await init(); // Убедимся, что мы инициализированы
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

// --- CRITICAL FIX: Safe Initialization Logic ---
const init = async () => {
  // 1. ПРОВЕРКА НАЛИЧИЯ: Загружаем сырые данные из хранилища
  const identity = await storage.getItem('identityKey');
  const signedPreKey = await storage.getItem('signedPreKey');
  const registrationId = await storage.getItem('registrationId');
  const oneTimePreKeys = (await storage.getItem('oneTimePreKeys')) || [];

  // 2. ГЕНЕРАЦИЯ: Если ключей нет локально -> создаем новые
  if (!identity || !signedPreKey || !registrationId) {
    console.log('E2E: No local identity found. Generating new...');
    await resetIdentity();
    return;
  }

  // Переменные для данных, которые понадобятся во втором блоке
  let parsedIdentity;
  let parsedSignedKey;
  let parsedSignature;
  let parsedSignedPubKey;

  // 3. БЛОК ЦЕЛОСТНОСТИ ДАННЫХ (Data Integrity)
  // Если ошибка здесь -> значит локальные данные битые, нужен сброс.
  try {
    const store = getStore();
    
    // Десериализация
    parsedIdentity = deserializeKeyPair(identity);
    
    parsedSignedPubKey = base64ToArrayBuffer(signedPreKey.keyPair.publicKey);
    const signedPrivKey = base64ToArrayBuffer(signedPreKey.keyPair.privateKey);
    parsedSignature = base64ToArrayBuffer(signedPreKey.signature);

    if (!parsedSignedPubKey || !signedPrivKey || !parsedSignature) {
      throw new Error('Invalid local key data structure');
    }

    // Загрузка в память libsignal
    await store.put('identityKey', parsedIdentity);
    await store.put('registrationId', registrationId);
    await store.put(`signedKey${signedPreKey.keyId}`, {
      pubKey: parsedSignedPubKey,
      privKey: signedPrivKey,
      signature: parsedSignature,
    });

    await Promise.all(
      oneTimePreKeys.map((pk) => {
        const pubKey = base64ToArrayBuffer(pk.publicKey);
        return store.put(`preKey${pk.keyId}`, { pubKey, privKey: null });
      })
    );

  } catch (error) {
    console.error('E2E: Local data corruption detected. Resetting identity.', error);
    await resetIdentity();
    return; // Останавливаемся, так как resetIdentity сам запустит публикацию
  }

  // 4. БЛОК СИНХРОНИЗАЦИИ С СЕРВЕРОМ (Network Sync)
  // Вынесен в отдельный блок. Если ошибка здесь -> ключи НЕ сбрасываем.
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
      // Это ожидаемая ошибка при плохой сети или падении сервера
      console.warn('E2E: Server sync failed.', networkError.message || networkError);

      if (retryCount < 1) { // Пробуем еще 1 раз через 2 секунды
        console.log('E2E: Retrying sync in 2s...');
        setTimeout(() => syncWithServer(retryCount + 1), 2000);
      } else {
        console.warn('E2E: Giving up on sync for now. Local keys preserved. User might appear offline to others until reconnection.');
      }
    }
  };

  // Запускаем синхронизацию, но не блокируем выполнение, если она упадет
  await syncWithServer();
};

// Функция для принудительного обновления сессии (если рассинхрон все же случился)
const forceUpdateSession = async (recipientId) => {
  try {
    const address = getAddress(recipientId);
    const store = getStore();
    console.log('Signal: Force updating session for', recipientId);
    // Удаляем и сессию, и кэшированный ключ личности, чтобы заставить библиотеку скачать свежий бандл
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
