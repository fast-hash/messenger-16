import httpClient from './httpClient';

export const getMessages = async (chatId) => {
  const { data } = await httpClient.get('/api/messages', {
    params: { chatId },
  });
  return data;
};

export const sendMessage = async (payload) => {
  const { data } = await httpClient.post('/api/messages', payload);
  return data;
};

export const toggleReaction = async (messageId, emoji) => {
  const { data } = await httpClient.post(`/api/messages/${messageId}/reactions`, { emoji });
  return data;
};

export const deleteForMe = async (messageId) => {
  const { data } = await httpClient.post(`/api/messages/${messageId}/delete-for-me`);
  return data;
};

export const deleteForAll = async (messageId) => {
  const { data } = await httpClient.post(`/api/messages/${messageId}/delete-for-all`);
  return data;
};
