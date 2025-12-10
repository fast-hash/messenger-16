import localforage from 'localforage';
import { KeyHelper } from '@jafoor/libsignal-protocol-typescript';
import httpClient from '../api/httpClient';

const storage = localforage.createInstance({ name: 'signal-storage' });

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
  const payload = {
    registrationId,
    identityKey: bufferToBase64(identityKeyPair.publicKey),
    signedPreKey: {
      keyId: signedPreKey.keyId,
      publicKey: bufferToBase64(signedPreKey.keyPair.publicKey),
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

export default {
  resetIdentity,
  publishBundle,
};
