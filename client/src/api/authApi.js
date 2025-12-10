import httpClient from './httpClient';
import { getOrCreateDeviceId } from '../utils/deviceId';
import UAParser from 'ua-parser-js';

const buildDevicePayload = () => {
  const parser = new UAParser();
  const result = parser.getResult();
  const browserName = result.browser?.name ? result.browser.name : 'Unknown Browser';
  const browserVersion = result.browser?.version ? ` ${result.browser.version}` : '';
  const osName = result.os?.name ? result.os.name : 'Unknown OS';
  const osVersion = result.os?.version ? ` ${result.os.version}` : '';

  return {
    deviceId: getOrCreateDeviceId(),
    name: `${browserName}${browserVersion}`.trim(),
    platform: `${osName}${osVersion}`.trim(),
  };
};

export const register = async (payload) => {
  const { data } = await httpClient.post('/api/auth/register', payload);
  return data;
};

export const login = async (payload) => {
  const { data } = await httpClient.post('/api/auth/login', {
    ...payload,
    device: buildDevicePayload(),
  });
  return data;
};

export const verifyMfaLogin = async ({ tempToken, code }) => {
  const { data } = await httpClient.post('/api/auth/mfa/verify', { tempToken, code });
  return data;
};

export const setupMfa = async () => {
  const { data } = await httpClient.post('/api/auth/mfa/setup');
  return data;
};

export const enableMfa = async (code) => {
  const { data } = await httpClient.post('/api/auth/mfa/enable', { code });
  return data;
};

export const disableMfa = async (code) => {
  const { data } = await httpClient.post('/api/auth/mfa/disable', { code });
  return data;
};

export const fetchBackupCodes = async () => {
  const { data } = await httpClient.get('/api/auth/mfa/backup-codes');
  return data;
};

export const logout = async () => {
  await httpClient.post('/api/auth/logout');
};

export const me = async () => {
  const { data } = await httpClient.get('/api/auth/me');
  return data;
};
