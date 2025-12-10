import httpClient from './httpClient';

export const getChats = async () => {
  const { data } = await httpClient.get('/api/chats');
  return data;
};

export const createDirectChat = async (payload) => {
  const { data } = await httpClient.post('/api/chats', payload);
  return data;
};

export const createGroupChat = async (payload) => {
  const { data } = await httpClient.post('/api/chats/group', payload);
  return data;
};

export const listGroups = async () => {
  const { data } = await httpClient.get('/api/chats/groups');
  return data;
};

export const getGroupDetails = async (chatId) => {
  const { data } = await httpClient.get(`/api/chats/${chatId}/participants`);
  return data;
};

export const addParticipant = async (chatId, userId) => {
  const { data } = await httpClient.post(`/api/chats/${chatId}/participants`, { userId });
  return data;
};

export const removeParticipant = async (chatId, userId) => {
  const { data } = await httpClient.delete(`/api/chats/${chatId}/participants/${userId}`);
  return data;
};

export const renameGroup = async (chatId, title) => {
  const { data } = await httpClient.patch(`/api/chats/${chatId}`, { title });
  return data;
};

export const requestJoin = async (chatId) => {
  const { data } = await httpClient.post(`/api/chats/${chatId}/join-request`);
  return data;
};

export const approveJoin = async (chatId, userId) => {
  const { data } = await httpClient.post(`/api/chats/${chatId}/join-requests/${userId}/approve`);
  return data;
};

export const rejectJoin = async (chatId, userId) => {
  const { data } = await httpClient.post(`/api/chats/${chatId}/join-requests/${userId}/reject`);
  return data;
};

export const markChatRead = async (chatId) => {
  const { data } = await httpClient.post(`/api/chats/${chatId}/read`);
  return data;
};

export const blockChat = async (chatId) => {
  const { data } = await httpClient.post(`/api/chats/${chatId}/block`);
  return data;
};

export const unblockChat = async (chatId) => {
  const { data } = await httpClient.delete(`/api/chats/${chatId}/block`);
  return data;
};

export const listDirectChatsAdmin = async () => {
  const { data } = await httpClient.get('/api/admin/chats/direct');
  return data;
};

export const clearBlocksAdmin = async (chatId) => {
  const { data } = await httpClient.delete(`/api/admin/chats/${chatId}/blocks`);
  return data;
};

export const listPins = async (chatId) => {
  const { data } = await httpClient.get(`/api/chats/${chatId}/pins`);
  return data;
};

export const pinMessage = async (chatId, messageId) => {
  const { data } = await httpClient.post(`/api/chats/${chatId}/pins`, { messageId });
  return data;
};

export const unpinMessage = async (chatId, messageId) => {
  const { data } = await httpClient.delete(`/api/chats/${chatId}/pins/${messageId}`);
  return data;
};

export const updateModeration = async (chatId, payload) => {
  const { data } = await httpClient.patch(`/api/chats/${chatId}/moderation`, payload);
  return data;
};

export const getAudit = async (chatId, limit = 50) => {
  const { data } = await httpClient.get(`/api/chats/${chatId}/audit`, {
    params: { limit },
  });
  return data;
};
