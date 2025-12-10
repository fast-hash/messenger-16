import { create } from 'zustand';
import { io } from 'socket.io-client';
import * as chatApi from '../api/chatApi';
import * as messagesApi from '../api/messagesApi';
import { playIncomingSound, showBrowserNotification } from '../utils/notifications';

const mapChat = (chat, currentUserId) => {
  const normalizeId = (value) => {
    if (!value) return value;
    return typeof value === 'string' ? value : value.toString?.() ?? value;
  };

  const base = {
    ...chat,
    notificationsEnabled: chat.notificationsEnabled ?? true,
    unreadCount: chat.unreadCount ?? 0,
    lastReadAt: chat.lastReadAt || null,
    removedParticipants: chat.removedParticipants || [],
    blocks: chat.blocks || [],
    pinnedMessageIds: chat.pinnedMessageIds || [],
    muteUntil: chat.muteUntil || null,
    rateLimitPerMinute: chat.rateLimitPerMinute ?? null,
  };

  if (chat.type === 'group') {
    return {
      ...base,
      otherUser: null,
      isOnline: false,
    };
  }

  const currentId = normalizeId(currentUserId);
  const otherUserRaw =
    chat.participants.find(
      (participant) => normalizeId(participant.id || participant._id || participant) !== currentId
    ) || chat.participants[0];
  const normalizedOtherUser = otherUserRaw
    ? {
        ...otherUserRaw,
        id: normalizeId(otherUserRaw.id || otherUserRaw._id || otherUserRaw),
      }
    : null;
  return {
    ...base,
    otherUser: normalizedOtherUser,
    isOnline: false,
  };
};

export const useChatStore = create((set, get) => ({
  chats: [],
  selectedChatId: null,
  messages: {},
  messageMeta: {},
  typing: {},
  socket: null,
  socketConnected: false,
  dndEnabled: false,
  dndUntil: null,
  pinnedByChat: {},
  auditLogs: {},
  setDndStatus(dndEnabled, dndUntil) {
    set({ dndEnabled: !!dndEnabled, dndUntil: dndUntil || null });
  },
  isDndActive() {
    const state = get();
    if (!state.dndEnabled) return false;
    if (!state.dndUntil) return true;
    return new Date(state.dndUntil).getTime() > Date.now();
  },
  connectSocket(currentUserId) {
    const existing = get().socket;
    if (existing) {
      return existing;
    }

    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin || 'http://localhost:3000';
    const socketBase = import.meta.env.VITE_SOCKET_URL || apiUrl;
    let socketOrigin = socketBase;
    try {
      const parsed = new URL(socketBase, window.location.origin);
      socketOrigin = `${parsed.protocol}//${parsed.host}`;
    } catch (error) {
      console.warn('Invalid socket base URL, falling back to raw value', error);
    }

    const socketPath = import.meta.env.VITE_SOCKET_PATH || '/socket.io';

    const socket = io(socketOrigin, {
      path: socketPath,
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
    });

    const rejoinAllChats = () => {
      const { chats: currentChats } = get();
      currentChats.forEach((chat) => {
        if (!chat.removed) {
          socket.emit('chats:join', { chatId: chat.id });
        }
      });
    };

    socket.on('connect', () => {
      set({ socketConnected: true });
      rejoinAllChats();
    });

    socket.on('reconnect', () => {
      set({ socketConnected: true });
      rejoinAllChats();
    });

    socket.on('disconnect', () => {
      set({ socketConnected: false });
    });

    if (socket.connected) {
      set({ socketConnected: true });
      rejoinAllChats();
    }

    socket.on('message:new', ({ message }) => {
      const state = get();
      const chatState = state.chats.find((c) => c.id === message.chatId);
      const participantIds = (chatState?.participants || []).map((p) => (p.id || p._id || p).toString());
      const currentId = currentUserId?.toString();
      const myId = (state.socket?.user?.id || currentUserId || '').toString();
      const isParticipant = participantIds.some((id) => id === myId);
      if (chatState?.type === 'group' && !isParticipant) {
        return;
      }
      const isRemovedFromGroup =
        chatState?.type === 'group' &&
        (chatState.removed ||
          chatState.removedParticipants?.some((id) => (id?.toString?.() || id) === currentId) ||
          !participantIds.includes(currentId));

      if (isRemovedFromGroup) {
        return;
      }

      state.addMessage(message.chatId, message);
      state.updateChatLastMessage(message.chatId, message);
      const isOwn = message.senderId === currentUserId;
      const isCurrent = state.selectedChatId === message.chatId;
      if (isCurrent && !isOwn) {
        state.setChatLastRead(message.chatId, message.createdAt);
      }
      if (!isOwn && !isCurrent) {
        const nextCount = (chatState?.unreadCount || 0) + 1;
        state.setChatUnreadCount(message.chatId, nextCount);
      }

      const notificationsEnabled = chatState?.notificationsEnabled !== false;
      const dndActive = state.isDndActive();
      if (!isOwn && notificationsEnabled && !dndActive) {
        playIncomingSound();

        if (document.hidden || !isCurrent) {
          const title =
            chatState?.type === 'group'
              ? `Новое сообщение в группе "${chatState?.title || 'Группа'}"`
              : `Новое сообщение от ${
                  message.sender?.displayName || message.senderName || 'сотрудника'
                }`;
          const body = message.text;
          const tag = `chat-${message.chatId}`;
          showBrowserNotification({ title, body, tag });
        }
      }
    });

    socket.on('chat:removed', ({ chatId }) => {
      set((state) => {
        const updatedChats = state.chats.map((c) => {
          if (c.id === chatId) {
            const myId = state.socket?.user?.id;
            const newParticipants = (c.participants || []).filter((p) => {
              const pId = p.id || p._id || p;
              return pId?.toString?.() !== myId?.toString();
            });
            return { ...c, removed: true, participants: newParticipants };
          }
          return c;
        });
        return { chats: updatedChats };
      });
    });

    socket.on('presence:online', ({ userId, dndEnabled, dndUntil }) => {
      get().updateUserPresence(userId, true, dndEnabled, dndUntil);
    });

    socket.on('presence:offline', ({ userId }) => {
      get().updateUserPresence(userId, false);
    });

    socket.on('presence:dnd', ({ userId, dndEnabled, dndUntil }) => {
      get().updateUserPresence(userId, undefined, dndEnabled, dndUntil);
    });

    socket.on('typing:started', ({ chatId, userId }) => {
      if (userId === currentUserId) return;
      get().setTyping(chatId, userId, true);
    });

    socket.on('typing:stopped', ({ chatId, userId }) => {
      if (userId === currentUserId) return;
      get().setTyping(chatId, userId, false);
    });

    socket.on('connect_error', async (err) => {
      console.error('Socket connect error', err);
      set({ socketConnected: false });

      if (err?.message === 'Authentication failed' || err?.message === 'Authentication required') {
        try {
          const { useAuthStore } = await import('./authStore');
          const { logout } = useAuthStore.getState();
          await logout();
          get().reset();
        } catch (e) {
          // ignore logout failures; the original connection error is already surfaced
        }
      }
    });

    socket.on('chat:pinsUpdated', ({ chatId, pinnedMessageIds }) => {
      get().setChatPins(chatId, pinnedMessageIds);
    });

    socket.on('message:reactionsUpdated', ({ chatId, messageId, reactions }) => {
      get().setMessageReactions(chatId, messageId, reactions);
    });

    socket.on('message:deleted', ({ chatId, messageId, deletedForAll, deletedAt, deletedBy }) => {
      get().setMessageDeleted(chatId, { messageId, deletedForAll, deletedAt, deletedBy });
    });

    socket.on('chat:moderationUpdated', ({ chatId, muteUntil, rateLimitPerMinute }) => {
      get().setChatModeration(chatId, { muteUntil, rateLimitPerMinute });
    });

    set({ socket });
    return socket;
  },
  setSocket(socket) {
    set({ socket });
  },
  reset() {
    const socket = get().socket;
    if (socket) {
      socket.disconnect();
    }
    set({
      chats: [],
      selectedChatId: null,
      messages: {},
      messageMeta: {},
      typing: {},
      socket: null,
      socketConnected: false,
      pinnedByChat: {},
      auditLogs: {},
    });
  },
  async loadChats(currentUserId) {
    const { chats } = await chatApi.getChats();
    const mapped = chats.map((chat) => mapChat(chat, currentUserId));
    mapped.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    const pinnedByChat = mapped.reduce((acc, chat) => {
      acc[chat.id] = chat.pinnedMessageIds || [];
      return acc;
    }, {});
    set({ chats: mapped, pinnedByChat });

    // Сразу подписываемся на комнаты всех чатов, чтобы получать presence и новые сообщения в списке.
    const socket = get().socket;
    if (socket) {
      mapped.forEach((chat) => socket.emit('chats:join', { chatId: chat.id }));
    }
  },
  async setSelectedChat(chatId) {
    const socket = get().socket;
    const chat = get().chats.find((c) => c.id === chatId);
    if (socket && chatId && chat && !chat.removed) {
      socket.emit('chats:join', { chatId });
    }
    set({ selectedChatId: chatId });
    if (chatId) {
      get().setChatUnreadCount(chatId, 0);
      try {
        const { lastReadAt } = await chatApi.markChatRead(chatId);
        get().setChatLastRead(chatId, lastReadAt || new Date().toISOString());
      } catch (e) {
        console.error('Не удалось отметить чат прочитанным', e);
      }
    }
  },
  async loadMessages(chatId) {
    const { messages, lastReadAt } = await messagesApi.getMessages(chatId);
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: messages,
      },
      messageMeta: {
        ...state.messageMeta,
        [chatId]: { lastReadAt },
      },
    }));
    if (lastReadAt) {
      get().setChatLastRead(chatId, lastReadAt);
    }
  },
  async fetchPins(chatId) {
    const { pinnedMessageIds } = await chatApi.listPins(chatId);
    get().setChatPins(chatId, pinnedMessageIds);
  },
  async pinMessage(chatId, messageId) {
    const { pinnedMessageIds } = await chatApi.pinMessage(chatId, messageId);
    get().setChatPins(chatId, pinnedMessageIds);
  },
  async unpinMessage(chatId, messageId) {
    const { pinnedMessageIds } = await chatApi.unpinMessage(chatId, messageId);
    get().setChatPins(chatId, pinnedMessageIds);
  },
  async toggleReaction(chatId, messageId, emoji) {
    const { reactions } = await messagesApi.toggleReaction(messageId, emoji);
    get().setMessageReactions(chatId, messageId, reactions);
  },
  async updateModeration(chatId, payload) {
    const moderation = await chatApi.updateModeration(chatId, payload);
    get().setChatModeration(chatId, moderation);
    return moderation;
  },
  async loadAudit(chatId, limit = 50) {
    const { events } = await chatApi.getAudit(chatId, limit);
    set((state) => ({
      auditLogs: {
        ...state.auditLogs,
        [chatId]: events,
      },
    }));
    return events;
  },
  async deleteMessageForMe(chatId, messageId) {
    await messagesApi.deleteForMe(messageId);
    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      return {
        messages: {
          ...state.messages,
          [chatId]: chatMessages.filter((msg) => (msg.id || msg._id || msg.messageId) !== messageId),
        },
      };
    });
  },
  async deleteMessageForAll(chatId, messageId) {
    const result = await messagesApi.deleteForAll(messageId);
    get().setMessageDeleted(chatId, result);
    return result;
  },
  async sendMessage(chatId, text, mentions = [], attachments = []) {
    const socket = get().socket;
    const applyLocalMessage = (message) => {
      get().addMessage(chatId, message);
      // Update read time immediately so the UI doesn't show "Unread" line above my own message
      get().setChatLastRead(chatId, message.createdAt);
      get().updateChatLastMessage(chatId, message);
    };
    if (socket) {
      await new Promise((resolve, reject) => {
        socket.emit('message:send', { chatId, text, mentions, attachments }, (response) => {
          if (!response || response.ok) {
            resolve();
          } else {
            const err = new Error(response.message || 'Не удалось отправить сообщение');
            err.status = response.status;
            reject(err);
          }
        });
      });
      return;
    }
    const { message } = await messagesApi.sendMessage({ chatId, text, mentions, attachments });
    applyLocalMessage(message);
  },
  addMessage(chatId, message) {
    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      if (chatMessages.some((existing) => existing.id === message.id)) {
        return state;
      }
      return {
        messages: {
          ...state.messages,
          [chatId]: [...chatMessages, message],
        },
      };
    });
  },
  setChatBlocks(chatId, blocks) {
    set((state) => ({
      chats: state.chats.map((chat) => (chat.id === chatId ? { ...chat, blocks } : chat)),
    }));
  },
  updateChatLastMessage(chatId, message) {
    set((state) => {
      const updatedChats = state.chats.map((chat) => {
        if (chat.id !== chatId) return chat;
        return {
          ...chat,
          lastMessage: {
            text: message.text || (message.attachments?.length ? 'Вложение' : message.text),
            senderId: message.senderId,
            createdAt: message.createdAt,
          },
          updatedAt: message.createdAt,
        };
      });
      updatedChats.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      return { chats: updatedChats };
    });
  },
  setChatUnreadCount(chatId, unreadCount) {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, unreadCount } : chat
      ),
    }));
  },
  setChatLastRead(chatId, lastReadAt) {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, lastReadAt } : chat
      ),
    }));
  },
  updateUserPresence(userId, isOnline, dndEnabled, dndUntil) {
    const targetId = userId?.toString?.() || userId;
    set((state) => ({
      chats: state.chats.map((chat) =>
        (() => {
          if (!chat.otherUser) return false;
          const otherId = chat.otherUser.id || chat.otherUser._id || chat.otherUser;
          const otherIdStr = otherId?.toString?.() || otherId;
          return otherIdStr === targetId;
        })()
          ? {
              ...chat,
              isOnline: typeof isOnline === 'boolean' ? isOnline : chat.isOnline,
              otherUser: {
                ...chat.otherUser,
                id: chat.otherUser.id || chat.otherUser._id || chat.otherUser,
                dndEnabled:
                  typeof dndEnabled === 'boolean' ? dndEnabled : chat.otherUser?.dndEnabled || false,
                dndUntil: typeof dndUntil !== 'undefined' ? dndUntil : chat.otherUser?.dndUntil || null,
              },
            }
          : chat
      ),
    }));
  },
  setTyping(chatId, userId, isTyping) {
    set((state) => {
      const existing = new Set(state.typing[chatId] || []);
      if (isTyping) {
        existing.add(userId);
      } else {
        existing.delete(userId);
      }
      return {
        typing: {
          ...state.typing,
          [chatId]: Array.from(existing),
        },
      };
    });
  },
  toggleNotifications(chatId) {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId
          ? { ...chat, notificationsEnabled: !(chat.notificationsEnabled ?? true) }
          : chat
      ),
    }));
  },
  upsertChat(chat, currentUserId) {
    const mapped = mapChat(chat, currentUserId);
    set((state) => {
      const without = state.chats.filter((c) => c.id !== mapped.id);
      const next = [...without, mapped];
      next.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
      return {
        chats: next,
        pinnedByChat: { ...state.pinnedByChat, [mapped.id]: mapped.pinnedMessageIds || [] },
      };
    });

    const socket = get().socket;
    if (socket && !mapped.removed) {
      socket.emit('chats:join', { chatId: mapped.id });
    }
  },
  setChatPins(chatId, pinnedMessageIds) {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, pinnedMessageIds: pinnedMessageIds || [] } : chat
      ),
      pinnedByChat: { ...state.pinnedByChat, [chatId]: pinnedMessageIds || [] },
    }));
  },
  setMessageReactions(chatId, messageId, reactions) {
    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      const updatedMessages = chatMessages.map((message) =>
        (message.id === messageId || message._id === messageId)
          ? { ...message, reactions: reactions || [] }
          : message
      );

      return {
        messages: {
          ...state.messages,
          [chatId]: updatedMessages,
        },
      };
    });
  },
  setMessageDeleted(chatId, { messageId, deletedForAll, deletedAt, deletedBy }) {
    set((state) => {
      const chatMessages = state.messages[chatId] || [];
      const idx = chatMessages.findIndex((msg) => (msg.id || msg._id || msg.messageId) === messageId);
      
      // 1. Если сообщения нет в загруженном списке, создаем заглушку (старая логика)
      if (idx === -1) {
        // ... (этот блок можно оставить как был или сократить, главное обновление state ниже)
        return state; 
      }

      // 2. Обновляем само сообщение внутри чата
      const updatedMessages = [...chatMessages];
      updatedMessages[idx] = {
        ...updatedMessages[idx],
        deletedForAll: !!deletedForAll,
        deletedAt: deletedAt || updatedMessages[idx].deletedAt || null,
        deletedBy: deletedBy || updatedMessages[idx].deletedBy || null,
        text: null,
        attachments: [],
      };

      // 3. НОВАЯ ЛОГИКА: Обновляем превью в списке чатов (слева)
      // Проверяем, является ли удаленное сообщение последним в массиве
      const isLastMessage = idx === chatMessages.length - 1;
      
      let updatedChats = state.chats;
      
      if (isLastMessage && deletedForAll) {
        updatedChats = state.chats.map((chat) => {
          if (chat.id === chatId) {
            return {
              ...chat,
              lastMessage: {
                ...chat.lastMessage,
                text: 'Сообщение удалено', // Меняем текст превью
              },
            };
          }
          return chat;
        });
      }

      return { 
        messages: { ...state.messages, [chatId]: updatedMessages },
        chats: updatedChats // Возвращаем обновленный список чатов
      };
    });
  },
  setChatModeration(chatId, { muteUntil, rateLimitPerMinute }) {
    set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId
          ? { ...chat, muteUntil: muteUntil || null, rateLimitPerMinute: rateLimitPerMinute ?? null }
          : chat
      ),
    }));
  },
}));
