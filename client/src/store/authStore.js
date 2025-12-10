import { create } from 'zustand';
import * as authApi from '../api/authApi';
import * as usersApi from '../api/usersApi';
import signalManager from '../e2e/signalManager';

let identityResetInFlight = false;

export const useAuthStore = create((set) => ({
  user: null,
  loading: true,
  dndEnabled: false,
  dndUntil: null,
  device: null,
  async fetchCurrentUser() {
    try {
      const { user, device } = await usersApi.currentUser();
      set({
        user,
        loading: false,
        dndEnabled: user.dndEnabled || false,
        dndUntil: user.dndUntil || null,
        device: device || null,
      });

      if (user?.e2eIdentityResetAllowed && !identityResetInFlight) {
        identityResetInFlight = true;
        signalManager
          .resetIdentity()
          .then(() => {
            set((state) => ({ user: { ...state.user, e2eIdentityResetAllowed: false } }));
            // eslint-disable-next-line no-alert
            alert('Your encryption keys have been reset by admin approval.');
          })
          .catch(() => {
            // eslint-disable-next-line no-alert
            alert('Не удалось автоматически обновить ключи шифрования. Попробуйте еще раз.');
          })
          .finally(() => {
            identityResetInFlight = false;
          });
      }
    } catch (error) {
      set({ user: null, loading: false, dndEnabled: false, dndUntil: null, device: null });
    }
  },
  async login(credentials) {
    const result = await authApi.login(credentials);
    if (result.mfaRequired) {
      return { mfaRequired: true, tempToken: result.tempToken };
    }

    const { user, device } = result;
    set({
      user,
      dndEnabled: user.dndEnabled || false,
      dndUntil: user.dndUntil || null,
      device: device || null,
    });
    return { user, device };
  },
  async verifyMfaLogin({ tempToken, code }) {
    const { user, device } = await authApi.verifyMfaLogin({ tempToken, code });
    set({
      user,
      dndEnabled: user.dndEnabled || false,
      dndUntil: user.dndUntil || null,
      device: device || null,
    });
    return { user, device };
  },
  async register(payload) {
    const data = await authApi.register(payload);
    return data;
  },
  async logout() {
    try {
      await authApi.logout();
    } catch (e) {
      // ignore logout errors (e.g., expired session)
    }
    set({ user: null, dndEnabled: false, dndUntil: null, device: null });
  },
  async updatePreferences(preferences) {
    const { user } = await usersApi.updatePreferences(preferences);
    set({ user, dndEnabled: user.dndEnabled || false, dndUntil: user.dndUntil || null });
  },
  setUser(user) {
    set({ user, dndEnabled: user?.dndEnabled || false, dndUntil: user?.dndUntil || null });
  },
}));
