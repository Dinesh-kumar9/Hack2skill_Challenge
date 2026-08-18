// ============================================================
//  server.js — Express HTTP server for Google Cloud Run
//
//  Serves:
//    POST /api/analyze → pipeline handler (api/analyze.js)
//    GET  /*           → public/index.html (static UI)
//
//  Cloud Run sets PORT automatically; defaults to 8080.
//  GEMINI_API_KEYS is injected as a Cloud Run secret or env var.
// ============================================================

'use strict';

const express = require('express');
const path    = require('path');

const analyzeHandler = require('./api/analyze');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── Middleware ────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// Serve UI from public/
app.use(express.static(path.join(__dirname, 'public')));

// ── API Route ─────────────────────────────────────────────────
// Delegates directly to the same handler used by Vercel —
// the handler signature (req, res) is Express-compatible.
app.post('/api/analyze', analyzeHandler);

// ── SPA fallback — serve index.html for any unknown GET ───────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const keys = (process.env.GEMINI_API_KEYS || '').split(',').filter(Boolean).length;
  console.log(`🚀 Reel Intelligence server running on port ${PORT}`);
  console.log(`🔑 API key pool: ${keys} key(s) loaded`);
  console.log(`📁 Serving UI from: ${path.join(__dirname, 'public')}`);
});
