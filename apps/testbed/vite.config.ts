import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../../', '');
  const serverPort = Number(env.TCACHE_PORT || '3200');
  const testbedPort = Number(env.TCACHE_TESTBED_PORT || '3201');
  const backend = `http://localhost:${serverPort}`;

  return {
    envDir: '../../',
    plugins: [react()],
    resolve: {
      dedupe: [
        '@blueprintjs/core',
        '@blueprintjs/icons',
        '@tcache/common',
        'react',
        'react-dom',
      ],
    },
    server: {
      host: '0.0.0.0',
      port: testbedPort,
      proxy: {
        '/api/status': {
          target: backend,
          rewrite: () => '/status',
        },
        '/api': backend,
        '/health': backend,
      },
    },
  };
});
