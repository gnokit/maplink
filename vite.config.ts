import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // maplibre v6 ships a worker that statically imports `maplibre-gl-shared.mjs`.
  // `?worker&url` makes Vite bundle that import graph into one ES-module worker
  // and return its URL, so the shared chunk is emitted alongside it.
  worker: { format: 'es' },
})
