'use strict';

/**
 * HereForFood — Express server entry point.
 * Serves the REST API (/api/*) and the static front end (public/).
 */

const path = require('path');
const os = require('os');
const express = require('express');

const config = require('./config');
const api = require('./routes/api');
const { getAgent } = require('./agent');

const app = express();

// CORS — the Expo/React Native app runs on the phone, a different origin than
// the web front end, so it needs cross-origin access to this API. Dev-open here;
// lock the allowed origin down before any real deployment.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '8mb' })); // room for base64 image payloads (Feature 2)
app.use('/api', api);
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check — also reports which AI agent is wired up.
app.get('/healthz', (_req, res) =>
  res.json({
    ok: true,
    provider: config.aiProvider,
    agent:
      config.aiProvider === 'foundry'
        ? config.foundry.agentName || config.foundry.agentId || 'ephemeral'
        : 'offline mock',
    database: config.dbProvider,
  })
);

// Central error handler — never leak stack traces to the client.
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

function lanAddress() {
  const nics = os.networkInterfaces();
  for (const name of Object.keys(nics)) {
    for (const net of nics[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

// Bind to 0.0.0.0 so phones on the same Wi-Fi can reach the API.
app.listen(config.port, '0.0.0.0', () => {
  const lan = lanAddress();
  console.log(`\n  HereForFood running:`);
  console.log(`    Local:   http://localhost:${config.port}`);
  console.log(`    Network: http://${lan}:${config.port}   <-- use this in the mobile app`);
  const brain =
    config.aiProvider === 'foundry'
      ? `Microsoft Foundry — agent "${config.foundry.agentName || config.foundry.agentId || '(ephemeral)'}"`
      : 'offline mock agent (no Azure needed)';
  console.log(`  AI:       ${brain}`);
  console.log(`  Database: ${config.dbProvider}\n`);
  if (config.aiProvider === 'foundry') {
    // Verify the AI connection at startup so failures show up here, not mid-demo.
    const agent = getAgent();
    if (typeof agent.verifyConnection === 'function') agent.verifyConnection();
    else console.log('  (Foundry needs a valid Azure login — run `az login` if chat errors.)\n');
  }
});
