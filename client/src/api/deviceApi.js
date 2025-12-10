import httpClient from './httpClient';

export const listDevices = async () => {
  const { data } = await httpClient.get('/api/devices');
  return data;
};

export const getCurrentDevice = async () => {
  const { data } = await httpClient.get('/api/devices/current');
  return data;
};

export const updateDeviceStatus = async (id, status) => {
  const { data } = await httpClient.patch(`/api/devices/${id}/status`, { status });
  return data;
};
