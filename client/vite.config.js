import {defineConfig} from 'vite';

const staticPages = {
  '/tos': '/tos.html',
  '/privacy': '/privacy.html',
};

// https://vitejs.dev/config/
export default defineConfig({
  envDir: '../',
  plugins: [
    {
      name: 'static-pages',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (staticPages[req.url]) req.url = staticPages[req.url];
          next();
        });
      },
    },
  ],
  server: {
    allowedHosts: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
    hmr: {
      clientPort: 443,
    },
  },
});
