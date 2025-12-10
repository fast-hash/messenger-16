import httpClient from './httpClient';

export const requestE2EIdentityReset = async () => {
  const { data } = await httpClient.post('/api/security/e2e/request-reset');
  return data;
};

export const fetchE2EIdentityReset = async () => {
  const { data } = await httpClient.get('/api/security/e2e/request-reset');
  return data;
};
