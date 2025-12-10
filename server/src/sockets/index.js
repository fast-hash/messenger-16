const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const Chat = require('../models/Chat');
const User = require('../models/User');
const messageService = require('../services/messageService');
const { findDeviceForUser } = require('../services/deviceService');

const onlineUsers = new Map();
const activeCalls = new Map();

const getUserRoom = (userId) => `user:${userId}`;

const isUserBusy = (userId) => {
  const idStr = userId.toString();
  for (const call of activeCalls.values()) {
    if (call.callerId === idStr || call.calleeId === idStr) {
      return true;
    }
  }
  return false;
};

const clearCall = (callId, reason) => {
  const call = activeCalls.get(callId);
  if (!call) return null;

  if (call.timeout) {
    clearTimeout(call.timeout);
  }

  activeCalls.delete(callId);

  return { ...call, reason };
};

const parseCookies = (cookieHeader) => {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, ...val] = part.trim().split('=');
    acc[key] = decodeURIComponent(val.join('='));
    return acc;
  }, {});
};

let ioInstance = null;

const setupSockets = (httpServer) => {
  const allowedOrigins = config.corsOrigin && config.corsOrigin.length ? config.corsOrigin : true;

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    path: config.socketPath,
    pingTimeout: 45000,
    pingInterval: 20000,
  });

  ioInstance = io;

  io.use(async (socket, next) => {
    try {
      const tokenFromQuery = socket.handshake.query && socket.handshake.query.token;
      const tokenFromAuth = socket.handshake.auth && socket.handshake.auth.token;
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const token = tokenFromAuth || tokenFromQuery || cookies.access_token;

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const payload = jwt.verify(token, config.jwtSecret);
      const user = await User.findById(payload.id);

      if (!user || user.accessDisabled) {
        return next(new Error('Authentication failed'));
      }

      const currentVersion = user.tokenVersion || 0;
      const tokenVersion = typeof payload.tokenVersion === 'number' ? payload.tokenVersion : 0;
      if (tokenVersion !== currentVersion) {
        return next(new Error('Authentication failed'));
      }

      const deviceId = payload.deviceId;
      if (!deviceId) {
        return next(new Error('Authentication failed'));
      }

      const device = await findDeviceForUser({ userId: user._id, deviceId });
      if (!device || device.status === 'revoked') {
        return next(new Error('Authentication failed'));
      }

      const deviceTokenVersion = typeof payload.deviceTokenVersion === 'number' ? payload.deviceTokenVersion : 0;
      if (deviceTokenVersion !== (device.tokenVersion || 0)) {
        return next(new Error('Authentication failed'));
      }

      socket.user = {
        id: user._id.toString(),
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        department: user.department,
        jobTitle: user.jobTitle,
        dndEnabled: user.dndEnabled || false,
        dndUntil: user.dndUntil || null,
      };
      socket.device = {
        id: device._id.toString(),
        deviceId: device.deviceId,
        status: device.status,
      };
      return next();
    } catch (error) {
      return next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const isTrustedDevice = socket.device?.status === 'trusted';

    const incrementPresence = async () => {
      const current = onlineUsers.get(socket.user.id) || { count: 0 };
      const nextCount = (current.count || 0) + 1;
      const nextMeta = {
        count: nextCount,
        dndEnabled: socket.user.dndEnabled || false,
        dndUntil: socket.user.dndUntil || null,
      };
      onlineUsers.set(socket.user.id, nextMeta);

      if ((current.count || 0) === 0) {
        const chats = await Chat.find({ participants: socket.user.id }).select('_id');
        chats.forEach((chat) => {
          io.to(`chat:${chat._id.toString()}`).emit('presence:online', {
            userId: socket.user.id,
            dndEnabled: socket.user.dndEnabled || false,
            dndUntil: socket.user.dndUntil || null,
          });
        });
      }
    };

    const decrementPresence = async () => {
      const current = onlineUsers.get(socket.user.id) || { count: 0 };
      const nextCount = Math.max(0, (current.count || 0) - 1);
      if (nextCount === 0) {
        onlineUsers.delete(socket.user.id);
        const chats = await Chat.find({ participants: socket.user.id }).select('_id');
        chats.forEach((chat) => {
          io.to(`chat:${chat._id.toString()}`).emit('presence:offline', {
            userId: socket.user.id,
          });
        });
      } else {
        onlineUsers.set(socket.user.id, { ...current, count: nextCount });
      }
    };

    incrementPresence().catch((error) => {
      console.error('Presence increment error', error);
    });

    socket.join(getUserRoom(socket.user.id));

    socket.on('chats:join', async ({ chatId }) => {
      if (!isTrustedDevice) {
        return;
      }
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) {
          return;
        }

        const isParticipant = chat.participants
          .map((id) => id.toString())
          .includes(socket.user.id.toString());
        if (!isParticipant) {
          return;
        }

        socket.join(`chat:${chatId}`);

        // После присоединения отправляем текущему клиенту статусы online уже подключенных участников,
        // чтобы индикаторы присутствия корректно отобразились в списке чатов.
        chat.participants
          .filter((id) => id.toString() !== socket.user.id.toString())
          .forEach((participantId) => {
            const presence = onlineUsers.get(participantId.toString());
            if (presence && (presence.count || 0) > 0) {
              socket.emit('presence:online', {
                userId: participantId.toString(),
                dndEnabled: presence.dndEnabled || false,
                dndUntil: presence.dndUntil || null,
              });
            }
          });
      } catch (error) {
        console.error('Error joining chat', error);
      }
    });

    socket.on('message:send', async ({ chatId, text, mentions, attachments }, callback) => {
      if (!isTrustedDevice) {
        if (callback) {
          callback({ ok: false, message: 'Device not trusted', status: 403 });
        }
        return;
      }
      try {
        const message = await messageService.sendMessage({
          chatId,
          senderId: socket.user.id,
          senderRole: socket.user.role,
          text,
          mentions,
          attachments,
        });

        io.to(`chat:${chatId}`).emit('message:new', { message });
        if (callback) {
          callback({ ok: true });
        }
      } catch (error) {
        console.error('Error sending message', error);
        if (callback) {
          callback({ ok: false, message: error.message, status: error.status || 500 });
        }
      }
    });

    socket.on('typing:start', async ({ chatId }) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return;
        const isParticipant = chat.participants
          .map((id) => id.toString())
          .includes(socket.user.id.toString());
        if (!isParticipant) return;
        io.to(`chat:${chatId}`).emit('typing:started', {
          chatId,
          userId: socket.user.id,
        });
      } catch (error) {
        console.error('Typing start error', error);
      }
    });

    socket.on('typing:stop', async ({ chatId }) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat) return;
        const isParticipant = chat.participants
          .map((id) => id.toString())
          .includes(socket.user.id.toString());
        if (!isParticipant) return;
        io.to(`chat:${chatId}`).emit('typing:stopped', {
          chatId,
          userId: socket.user.id,
        });
      } catch (error) {
        console.error('Typing stop error', error);
      }
    });

    const isDndActive = (meta = {}) => {
      if (!meta.dndEnabled) return false;
      if (!meta.dndUntil) return true;
      const until = new Date(meta.dndUntil);
      return until.getTime() > Date.now();
    };

    socket.on('call:init', async ({ chatId, toUserId }, callback) => {
      try {
        const chat = await Chat.findById(chatId);
        if (!chat || chat.type !== 'direct') {
          return callback && callback({ ok: false, reason: 'NOT_FOUND' });
        }

        const participants = (chat.participants || []).map((id) => id.toString());
        const callerId = socket.user.id.toString();
        const targetId = toUserId?.toString();

        if (!participants.includes(callerId) || !participants.includes(targetId)) {
          return callback && callback({ ok: false, reason: 'FORBIDDEN' });
        }

        const hasBlock = (chat.blocks || []).some(
          (b) =>
            (b.by && b.by.toString() === callerId && b.target && b.target.toString() === targetId) ||
            (b.by && b.by.toString() === targetId && b.target && b.target.toString() === callerId)
        );

        if (hasBlock) {
          return callback && callback({ ok: false, reason: 'BLOCKED' });
        }

        const targetPresence = onlineUsers.get(targetId);
        if (!targetPresence || (targetPresence.count || 0) === 0) {
          return callback && callback({ ok: false, reason: 'OFFLINE' });
        }

        let isTargetDnd = isDndActive(targetPresence);
        if (isTargetDnd) {
          // Re-check against the latest user preferences in case the in-memory
          // presence cache is stale after toggling DND without reconnecting.
          const freshUser = await User.findById(targetId).select('dndEnabled dndUntil');
          if (freshUser) {
            const freshMeta = {
              dndEnabled: freshUser.dndEnabled || false,
              dndUntil: freshUser.dndUntil || null,
            };
            onlineUsers.set(targetId, { ...targetPresence, ...freshMeta });
            isTargetDnd = isDndActive(freshMeta);
          }
        }
        if (isTargetDnd) {
          return callback && callback({ ok: false, reason: 'DND' });
        }

        if (isUserBusy(targetId) || isUserBusy(callerId)) {
          return callback && callback({ ok: false, reason: 'BUSY' });
        }

        const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const timeout = setTimeout(() => {
          const cleared = clearCall(callId, 'TIMEOUT');
          if (cleared) {
            io.to(getUserRoom(callerId)).emit('call:cancel', { callId, reason: 'TIMEOUT' });
            io.to(getUserRoom(targetId)).emit('call:cancel', { callId, reason: 'TIMEOUT' });
          }
        }, 30000);

        activeCalls.set(callId, {
          callId,
          chatId: chat._id.toString(),
          callerId,
          calleeId: targetId,
          timeout,
        });

        io.to(getUserRoom(targetId)).emit('call:ring', {
          callId,
          chatId: chat._id.toString(),
          fromUserId: callerId,
          fromName: socket.user.displayName || socket.user.username || 'Сотрудник',
        });

        return callback && callback({ ok: true, callId });
      } catch (error) {
        console.error('Call init error', error);
        return callback && callback({ ok: false, reason: 'ERROR' });
      }
    });

    socket.on('call:cancel', ({ callId }, callback) => {
      const call = activeCalls.get(callId);
      if (!call || call.callerId !== socket.user.id.toString()) {
        if (callback) callback({ ok: false, reason: 'NOT_FOUND' });
        return;
      }

      const cleared = clearCall(callId, 'CANCELLED');
      if (cleared) {
        io.to(getUserRoom(cleared.calleeId)).emit('call:cancel', { callId, reason: 'CANCELLED' });
      }

      if (callback) callback({ ok: true });
    });

    socket.on('call:decline', ({ callId }, callback) => {
      const call = activeCalls.get(callId);
      if (!call || call.calleeId !== socket.user.id.toString()) {
        if (callback) callback({ ok: false, reason: 'NOT_FOUND' });
        return;
      }

      const cleared = clearCall(callId, 'DECLINED');
      if (cleared) {
        io.to(getUserRoom(cleared.callerId)).emit('call:decline', { callId, reason: 'DECLINED' });
      }

      if (callback) callback({ ok: true });
    });

    socket.on('call:accept', ({ callId }, callback) => {
      const call = activeCalls.get(callId);
      if (!call || call.calleeId !== socket.user.id.toString()) {
        if (callback) callback({ ok: false, reason: 'NOT_FOUND' });
        return;
      }

      if (call.timeout) {
        clearTimeout(call.timeout);
        activeCalls.set(callId, { ...call, timeout: null });
      }

      io.to(getUserRoom(call.callerId)).emit('call:accept', { callId });

      if (callback) callback({ ok: true });
    });

    const relayCallEvent = (eventName) => ({ callId, ...payload }, callback) => {
      const call = activeCalls.get(callId);
      if (!call) {
        if (callback) callback({ ok: false, reason: 'NOT_FOUND' });
        return;
      }

      const senderId = socket.user.id.toString();
      if (senderId !== call.callerId && senderId !== call.calleeId) {
        if (callback) callback({ ok: false, reason: 'FORBIDDEN' });
        return;
      }

      const targetId = senderId === call.callerId ? call.calleeId : call.callerId;
      io.to(getUserRoom(targetId)).emit(eventName, { callId, ...payload });

      if (eventName === 'call:hangup') {
        clearCall(callId, 'HANGUP');
      }

      if (callback) callback({ ok: true });
    };

    socket.on('call:sdp-offer', relayCallEvent('call:sdp-offer'));
    socket.on('call:sdp-answer', relayCallEvent('call:sdp-answer'));
    socket.on('call:ice', relayCallEvent('call:ice'));
    socket.on('call:hangup', relayCallEvent('call:hangup'));

    socket.on('disconnect', () => {
      decrementPresence().catch((error) => {
        console.error('Presence decrement error', error);
      });

      const callsToClear = [];
      activeCalls.forEach((call, callId) => {
        if (call.callerId === socket.user.id.toString() || call.calleeId === socket.user.id.toString()) {
          callsToClear.push(callId);
        }
      });

      callsToClear.forEach((callId) => {
        const cleared = clearCall(callId, 'DISCONNECTED');
        if (cleared) {
          const targetId =
            cleared.callerId === socket.user.id.toString() ? cleared.calleeId : cleared.callerId;
          io.to(getUserRoom(targetId)).emit('call:hangup', { callId });
        }
      });
    });
  });

  return io;
};

const getIo = () => ioInstance;

const updatePresenceMeta = (userId, meta = {}) => {
  const existing = onlineUsers.get(userId.toString());
  if (!existing) return;
  onlineUsers.set(userId.toString(), { ...existing, ...meta });
};

module.exports = setupSockets;
module.exports.getIo = getIo;
module.exports.updatePresenceMeta = updatePresenceMeta;
module.exports.getUserRoom = getUserRoom;
