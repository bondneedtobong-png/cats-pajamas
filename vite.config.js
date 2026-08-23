import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // VITE_API_BASE живёт в .env.development.local (см. devtools/README) —
  // в process.env его нет, поэтому читаем через loadEnv.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      host: true,
      port: Number(process.env.PORT) || 5173,
      // Фото событий лежат вне dist (персистентная папка на VPS) и отдаются
      // API-процессом. На проде это один домен через nginx, а в деве фронт и
      // API на разных портах — без прокси картинки событий отваливались 404.
      proxy: {
        '/uploads/events': {
          target: env.VITE_API_BASE || 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
