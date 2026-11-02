import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
// @ts-ignore
import { handleApiRequest } from './server.mjs'
 
export default defineConfig({
  plugins: [
    react(), 
    tailwindcss(),
    {
      name: 'clearquote-api-middleware',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (handleApiRequest(req, res, next)) return;
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (handleApiRequest(req, res, next)) return;
          next();
        });
      }
    }
  ],
})
 
