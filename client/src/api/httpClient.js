import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const httpClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

httpClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error?.response?.status === 401 && !error?.config?.url?.includes('/api/auth/logout')) {
      try {
        const { useAuthStore } = await import('../store/authStore');
        const { logout } = useAuthStore.getState();
        await logout();
      } catch (e) {
        // ignore interceptor failures to avoid masking original error
      }
    }

    return Promise.reject(error);
  }
);

export default httpClient;
