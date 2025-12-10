import { v4 as uuidv4 } from 'uuid';
import UAParser from 'ua-parser-js';

const STORAGE_KEY = 'device_id';

const buildDeviceFingerprint = () => {
  const parser = new UAParser();
  const result = parser.getResult();
  const browser = result.browser && result.browser.name ? result.browser.name : 'browser';
  const os = result.os && result.os.name ? result.os.name : 'os';
  const deviceModel = result.device && result.device.model ? result.device.model : 'web';

  return `${browser}-${os}-${deviceModel}`.toLowerCase();
};

export const getOrCreateDeviceId = () => {
  if (typeof localStorage === 'undefined') {
    return uuidv4();
  }

  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const fingerprint = buildDeviceFingerprint();
  const newId = `${uuidv4()}-${fingerprint}`;
  localStorage.setItem(STORAGE_KEY, newId);
  return newId;
};
