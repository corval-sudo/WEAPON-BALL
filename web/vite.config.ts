import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // VITE_API_URL is set in Vercel env vars (e.g. https://your-app.up.railway.app)
  // Falls back to localhost:3001 for local dev
})
