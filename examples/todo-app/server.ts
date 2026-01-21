// server.ts
import { serve } from "bun";
import { resolve } from "path";

console.log("Starting server on http://localhost:3000");

serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    
    // Simple static file serving for dev
    if (url.pathname === "/") {
        return new Response(Bun.file(resolve(import.meta.dir, "index.html")));
    }

    // Serve files from src
    if (url.pathname.startsWith("/src/")) {
        return new Response(Bun.file(resolve(import.meta.dir, url.pathname.slice(1))));
    }

    // Serve node_modules for dependencies (Vite handles this in dev usually, but strictly for Bun.serve simple testing)
    // NOTE: This is a very naive server just to prove backend can run. 
    // In reality, we use `pnpm dev` which uses Vite to serve and bundle.
    // The "start" script in package.json runs this.
    
    return new Response("Not Found", { status: 404 });
  },
});
