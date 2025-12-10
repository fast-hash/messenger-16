const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const base64ToArrayBuffer = (b64) => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export const encryptFile = async (file) => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);

  const data = await file.arrayBuffer();
  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const exportedKey = await window.crypto.subtle.exportKey('raw', key);

  return {
    blob: new Blob([encrypted], { type: 'application/octet-stream' }),
    key: arrayBufferToBase64(exportedKey),
    iv: arrayBufferToBase64(iv),
  };
};

export const decryptFile = async (encryptedBlob, key, iv) => {
  const keyBuffer = base64ToArrayBuffer(key);
  const ivBuffer = base64ToArrayBuffer(iv);
  const cryptoKey = await window.crypto.subtle.importKey('raw', keyBuffer, 'AES-GCM', true, ['decrypt']);
  const encryptedBuffer = await encryptedBlob.arrayBuffer();
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(ivBuffer) },
    cryptoKey,
    encryptedBuffer
  );

  return new Blob([decrypted]);
};
