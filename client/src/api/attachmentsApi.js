import httpClient from './httpClient';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const uploadAttachments = async (chatId, files, options = {}) => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  if (typeof options.isEncrypted !== 'undefined') {
    formData.append('isEncrypted', options.isEncrypted ? 'true' : 'false');
  }

  const { data } = await httpClient.post(`/api/chats/${chatId}/attachments`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
};

export const getAttachmentUrl = (attachmentId) => `${apiBase}/api/attachments/${attachmentId}`;
