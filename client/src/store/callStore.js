import { create } from 'zustand';

const stopAudio = (audio) => {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (e) {
    // ignore
  }
};

const createLoopedAudio = (src) => {
  if (typeof Audio === 'undefined') return null;
  const audio = new Audio(src);
  audio.loop = true;
  audio.autoplay = true;
  audio.play().catch(() => {});
  return audio;
};

const buildIceServers = () => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (import.meta.env.VITE_TURN_URL) {
    const turn = {
      urls: import.meta.env.VITE_TURN_URL,
    };
    if (import.meta.env.VITE_TURN_USERNAME) {
      turn.username = import.meta.env.VITE_TURN_USERNAME;
    }
    if (import.meta.env.VITE_TURN_CREDENTIAL) {
      turn.credential = import.meta.env.VITE_TURN_CREDENTIAL;
    }
    iceServers.push(turn);
  }
  return iceServers;
};

const formatReason = (reason) => {
  switch (reason) {
    case 'OFFLINE':
      return 'Собеседник недоступен сейчас (offline).';
    case 'DND':
      return 'Собеседник сейчас в режиме "Не беспокоить".';
    case 'BUSY':
      return 'Собеседник занят другим звонком.';
    case 'BLOCKED':
      return 'Диалог заблокирован для звонков.';
    case 'NOT_FOUND':
      return 'Чат или собеседник не найдены.';
    case 'TIMEOUT':
      return 'Нет ответа на звонок.';
    case 'CANCELLED':
      return 'Звонок отменён.';
    case 'DECLINED':
      return 'Звонок отклонён.';
    case 'DISCONNECTED':
      return 'Звонок прерван: собеседник отключился.';
    default:
      return 'Не удалось инициировать звонок.';
  }
};

export const useCallStore = create((set, get) => ({
  socket: null,
  socketListeners: {},
  socketConnected: false,
  reconnectTimer: null,
  currentUserId: null,
  status: 'idle', // idle | incoming | outgoing | in-call
  callId: null,
  chatId: null,
  peerUser: null,
  peerConnection: null,
  localStream: null,
  remoteStream: null,
  muted: false,
  error: null,
  ringtone: null,
  ringback: null,
  setSocket(socket, currentUserId) {
    const prevSocket = get().socket;
    const prevListeners = get().socketListeners || {};
    const prevTimer = get().reconnectTimer;
    Object.entries(prevListeners).forEach(([event, handler]) => {
      prevSocket?.off(event, handler);
    });

    if (prevTimer) {
      clearTimeout(prevTimer);
    }

    if (!socket) {
      set({ socket: null, socketListeners: {}, currentUserId: null, socketConnected: false, reconnectTimer: null });
      return;
    }

    const clearReconnectTimer = () => {
      const timer = get().reconnectTimer;
      if (timer) {
        clearTimeout(timer);
        set({ reconnectTimer: null });
      }
    };

    const handleConnectionRestored = () => {
      clearReconnectTimer();
      const state = get();
      const isConnectionError = state.error === 'Нет подключения к серверу для звонков.';
      set({ socketConnected: true, error: isConnectionError ? null : state.error });
    };

    const handleConnectionIssue = (reason) => {
      console.warn('Call socket connection issue', reason);
      clearReconnectTimer();
      const timer = setTimeout(() => {
        if (!socket.connected) {
          set({ error: 'Нет подключения к серверу для звонков.' });
        }
      }, 4000);
      set({ socketConnected: false, reconnectTimer: timer });

      if (get().status !== 'idle') {
        get().resetCall('Звонок прерван: потеряно соединение.');
      }
    };

    const handleIncoming = ({ callId, chatId, fromUserId, fromName }) => {
      const state = get();
      if (state.status !== 'idle') {
        socket.emit('call:decline', { callId });
        return;
      }

      const ringtone = createLoopedAudio('/sounds/ringtone.mp3');
      set({
        status: 'incoming',
        callId,
        chatId,
        peerUser: { id: fromUserId, name: fromName },
        ringtone,
        error: null,
      });
    };

    const handleCancel = ({ callId, reason }) => {
      if (callId !== get().callId) return;
      get().resetCall(formatReason(reason || 'CANCELLED'));
    };

    const handleDecline = ({ callId, reason }) => {
      if (callId !== get().callId) return;
      get().resetCall(formatReason(reason || 'DECLINED'));
    };

    const handleAccept = ({ callId }) => {
      if (callId !== get().callId) return;
      stopAudio(get().ringback);
      set({ status: 'in-call' });
      get().startPeerConnection('caller');
    };

    const handleOffer = async ({ callId, sdp }) => {
      if (callId !== get().callId) return;
      const pc = await get().startPeerConnection('callee');
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      get().socket?.emit('call:sdp-answer', { callId, sdp: pc.localDescription });
    };

    const handleAnswer = async ({ callId, sdp }) => {
      if (callId !== get().callId) return;
      const pc = get().peerConnection;
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    };

    const handleIce = async ({ callId, candidate }) => {
      if (callId !== get().callId) return;
      const pc = get().peerConnection;
      if (!pc || !candidate) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('ICE candidate error', error);
      }
    };

    const handleHangup = ({ callId }) => {
      if (callId !== get().callId) return;
      get().resetCall('Звонок завершён.');
    };

    socket.on('call:ring', handleIncoming);
    socket.on('call:cancel', handleCancel);
    socket.on('call:decline', handleDecline);
    socket.on('call:accept', handleAccept);
    socket.on('call:sdp-offer', handleOffer);
    socket.on('call:sdp-answer', handleAnswer);
    socket.on('call:ice', handleIce);
    socket.on('call:hangup', handleHangup);
    socket.on('connect', handleConnectionRestored);
    socket.on('reconnect', handleConnectionRestored);
    socket.on('disconnect', handleConnectionIssue);
    socket.on('connect_error', handleConnectionIssue);
    socket.on('reconnect_attempt', () => set({ socketConnected: false }));

    if (socket.connected) {
      handleConnectionRestored();
    }

    set({
      socket,
      currentUserId: currentUserId?.toString(),
      socketListeners: {
        'call:ring': handleIncoming,
        'call:cancel': handleCancel,
        'call:decline': handleDecline,
        'call:accept': handleAccept,
        'call:sdp-offer': handleOffer,
        'call:sdp-answer': handleAnswer,
        'call:ice': handleIce,
        'call:hangup': handleHangup,
        connect: handleConnectionRestored,
        reconnect: handleConnectionRestored,
        disconnect: handleConnectionIssue,
        connect_error: handleConnectionIssue,
        reconnect_attempt: () => set({ socketConnected: false }),
      },
    });
  },
  resetCall(message = null) {
    const { ringtone, ringback, peerConnection, localStream, remoteStream } = get();
    stopAudio(ringtone);
    stopAudio(ringback);
    if (peerConnection) {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.close();
    }
    localStream?.getTracks().forEach((t) => t.stop());
    remoteStream?.getTracks().forEach((t) => t.stop());

    set({
      status: 'idle',
      callId: null,
      chatId: null,
      peerUser: null,
      peerConnection: null,
      localStream: null,
      remoteStream: null,
      muted: false,
      error: message,
      ringtone: null,
      ringback: null,
    });
  },
  async startCall(chat) {
    const state = get();
    const socket = state.socket;
    if (!socket || !socket.connected) {
      set({ error: 'Нет подключения к серверу для звонков.' });
      return;
    }
    if (!chat || chat.type !== 'direct') {
      set({ error: 'Звонки доступны только в личных чатах.' });
      return;
    }
    if (state.status !== 'idle') {
      set({ error: 'У вас уже есть активный звонок.' });
      return;
    }

    const participants = chat.participants || [];
    const currentId = state.currentUserId?.toString();
    const target = participants.find((p) => (p.id || p._id || p)?.toString?.() !== currentId) || participants[0];
    const targetId = (target?.id || target?._id || target || '').toString();
    const targetName = target?.displayName || target?.username || 'Собеседник';

    if (!targetId) {
      set({ error: 'Не удалось определить собеседника.' });
      return;
    }

    set({
      status: 'outgoing',
      chatId: chat.id || chat._id || null,
      peerUser: { id: targetId, name: targetName },
      error: null,
    });

    socket.emit('call:init', { chatId: chat.id || chat._id, toUserId: targetId }, (response) => {
      if (!response?.ok) {
        get().resetCall(formatReason(response?.reason));
        return;
      }
      const ringback = createLoopedAudio('/sounds/ringback.mp3');
      set({ callId: response.callId, ringback });
    });
  },
  acceptIncoming() {
    const { socket, callId } = get();
    if (!socket || !callId) return;
    stopAudio(get().ringtone);
    set({ status: 'in-call', error: null });
    socket.emit('call:accept', { callId });
    get().startPeerConnection('callee');
  },
  declineIncoming() {
    const { socket, callId } = get();
    if (!socket || !callId) return;
    socket.emit('call:decline', { callId });
    get().resetCall(formatReason('DECLINED'));
  },
  cancelOutgoing() {
    const { socket, callId } = get();
    if (socket && callId) {
      socket.emit('call:cancel', { callId });
    }
    get().resetCall(formatReason('CANCELLED'));
  },
  async startPeerConnection(role) {
    let pc = get().peerConnection;
    if (pc) return pc;

    pc = new RTCPeerConnection({ iceServers: buildIceServers() });
    pc.onicecandidate = (event) => {
      if (event.candidate && get().callId) {
        get().socket?.emit('call:ice', { callId: get().callId, candidate: event.candidate });
      }
    };
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      set({ remoteStream: stream });
    };

    const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    set({ peerConnection: pc, localStream, muted: false });

    if (role === 'caller') {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      get().socket?.emit('call:sdp-offer', { callId: get().callId, sdp: pc.localDescription });
    }

    return pc;
  },
  async toggleMute() {
    const state = get();
    const nextMuted = !state.muted;
    state.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !nextMuted;
    });
    set({ muted: nextMuted });
  },
  hangup() {
    const { socket, callId, status } = get();
    if (socket && callId && status !== 'idle') {
      socket.emit('call:hangup', { callId });
    }
    get().resetCall('Звонок завершён.');
  },
  clearError() {
    set({ error: null });
  },
}));
