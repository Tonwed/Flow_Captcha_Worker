const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const GlobalTokenPool = require('./GlobalTokenPool');
const { API_KEY } = require('./config');

function createApiApp(pool) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const serializeWorker = (w) => ({
    nodeId: w.nodeId,
    id: w.nodeId,
    proxyHost: w.proxyHost,
    isSubProxy: w.isSubProxy,
    ready: w.ready,
    isFetching: w.isFetching,
    isShuttingDown: w.isShuttingDown,
    isPaused: w.isPaused,
    pauseReason: w.pauseReason,
    nonSolveFailureCount: w.nonSolveFailureCount,
    lastRestartReason: w.lastRestartReason,
    lastErrorMessage: w.lastErrorMessage,
    stats: w.stats,
    userAgent: w.fingerprint ? w.fingerprint.ua : null,
    screen: w.fingerprint ? w.fingerprint.screen : null
  });

  // Static directory mapping if needed
  app.use(express.static(path.join(__dirname, '..', 'frontend', 'out')));

  app.get('/api/v1/cluster/status', (req, res) => {
    const status = {
      queueLength: pool.waitQueue.length,
      totalGenerated: pool.workers.reduce((sum, w) => sum + w.stats.generated, 0),
      totalSuccess: pool.workers.reduce((sum, w) => sum + w.stats.success, 0),
      totalFailed: pool.workers.reduce((sum, w) => sum + w.stats.failed, 0),
      activeNodeCount: pool.workers.length,
      nodes: pool.workers.map(serializeWorker)
    };
    return res.json(status);
  });

  const jwt = require('jsonwebtoken');
  // Define JWT Secret (ideally from env, fallback to API_KEY)
  const JWT_SECRET = API_KEY || 'default_jwt_secret_mengko';
  const db = require('./db');

  function adminAuthMiddleware(req, res, next) {
    const path = req.path;
    
    // API Key specific routes (Solver logic)
    const isSolverRoute = path.match(/^\/(api\/v1\/)?(solve|prefill|sessions)/);
    if (isSolverRoute) {
       const auth = req.headers.authorization || '';
       const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
       try {
          db.verifyAndIncrementApiKey(token);
          req.solverApiKey = token;
          return next();
       } catch (err) {
          return res.status(401).json({ detail: err.message });
       }
    }

    if (!path.startsWith('/api/v1/')) return next();
    
    // Skip auth for login
    if (path.startsWith('/api/v1/auth/login')) return next();
    if (path === '/api/v1/workers/metrics') return next(); // allow open metrics if any

    // Default: Check Admin JWT for Dashboard access
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    // Backward compatibility for existing hardcoded secret (useful during transition)
    if (token === API_KEY) return next();

    try {
      jwt.verify(token, JWT_SECRET);
      return next();
    } catch(e) {
      return res.status(401).json({ detail: 'Unauthorized Admin Session' });
    }
  }
  
  app.use(adminAuthMiddleware);

  // --- Auth & Admin Routes ---
  app.post('/api/v1/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (db.verifyAdmin(username, password)) {
       const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
       return res.json({ token, username });
    }
    return res.status(401).json({ detail: 'Invalid credentials' });
  });

  app.put('/api/v1/auth/password', (req, res) => {
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 5) return res.status(400).json({ detail: 'Password must be at least 5 characters' });
    db.updateAdminPassword('admin', newPassword);
    return res.json({ status: 'ok' });
  });

  // --- API Key Management Routes ---
  app.get('/api/v1/api-keys', (req, res) => {
    return res.json(db.getAllApiKeys());
  });
  
  app.post('/api/v1/api-keys', (req, res) => {
    const { remark, max_usage, expire_at } = req.body || {};
    try {
      const keyObj = db.createApiKey(remark, max_usage || 0, expire_at || null);
      return res.json(keyObj);
    } catch (err) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.delete('/api/v1/api-keys/:key', (req, res) => {
    db.revokeApiKey(req.params.key);
    return res.json({ status: 'ok' });
  });


  // Dynamic Scale out API
  app.post('/api/v1/cluster/nodes', async (req, res) => {
    const { proxies } = req.body;
    if (!proxies || !Array.isArray(proxies)) {
      return res.status(400).json({ detail: "Invalid request, expected JSON with array 'proxies'" });
    }
    const addedNodeIds = [];
    for (const proxy of proxies) {
      const id = await pool.addNode(proxy);
      addedNodeIds.push(id);
    }
    return res.json({ status: 'ok', addedNodeIds });
  });

  // Dynamic Scale in API
  app.delete('/api/v1/cluster/nodes/:id', async (req, res) => {
    const nodeId = parseInt(req.params.id);
    try {
      await pool.removeNode(nodeId);
      return res.json({ status: 'ok', removedNodeId: nodeId });
    } catch(err) {
      return res.status(404).json({ detail: err.message });
    }
  });

  // --- Subscriptions API ---
  const { parseClashSub } = require('./proxy_engine/sub_parser');

  app.get('/api/v1/proxies/subs', (req, res) => {
    return res.json(db.getAll('subscriptions'));
  });

  app.post('/api/v1/proxies/subs', async (req, res) => {
    const { url, remark } = req.body || {};
    if (!url) return res.status(400).json({ detail: 'URL is required' });
    try {
      const sub = db.addSubscription(url, remark);
      return res.json(sub);
    } catch(err) {
      return res.status(400).json({ detail: err.message });
    }
  });

  app.delete('/api/v1/proxies/subs/:id', (req, res) => {
    db.removeSubscription(req.params.id);
    return res.json({ status: 'ok' });
  });

  app.put('/api/v1/proxies/subs/:id', (req, res) => {
    const { url, remark } = req.body || {};
    try {
      const sub = db.updateSubscription(req.params.id, url, remark);
      return res.json(sub);
    } catch(err) {
      if (err.message === "Subscription not found") return res.status(404).json({ detail: err.message });
      return res.status(400).json({ detail: err.message });
    }
  });

  app.post('/api/v1/proxies/subs/:id/sync', async (req, res) => {
    const sub = db.getAll('subscriptions').find(s => s.id === req.params.id);
    if (!sub) return res.status(404).json({ detail: 'Subscription not found' });
    
    try {
      const { nodes, filename } = await parseClashSub(sub.url);
      db.updateProxyNodes(sub.id, nodes);
      
      if (filename && !sub.remark) {
         const cleanName = filename.replace(/\.yaml$/i, '').replace(/\.yml$/i, '').trim();
         db.updateSubscription(sub.id, sub.url, cleanName);
      }
      
      return res.json({ status: 'ok', nodeCount: nodes.length });
    } catch(err) {
      return res.status(500).json({ detail: `Sync failed: ${err.message}` });
    }
  });

  app.post('/api/v1/proxies/subs/:id/test', async (req, res) => {
    try {
      const nodes = db.getAll('proxy_nodes').filter(n => n.subId === req.params.id);
      if (nodes.length === 0) return res.json({ tested: 0 });

      const speedTester = require('./proxy_engine/speed_tester');
      const results = await speedTester.testLatency(nodes);
      
      db.updateNodesStatus(results);
      return res.json({ tested: results.length });
    } catch(err) {
      return res.status(500).json({ detail: `Speed test failed: ${err.message}` });
    }
  });

  app.post('/api/v1/proxies/nodes/:id/test', async (req, res) => {
    try {
      const node = db.getAll('proxy_nodes').find(n => n.id === req.params.id);
      if (!node) return res.status(404).json({ detail: "Node not found" });

      const speedTester = require('./proxy_engine/speed_tester');
      const results = await speedTester.testLatency([node]);
      
      if (results.length > 0) {
         db.updateNodesStatus([{ id: node.id, latency: results[0].latency, status: results[0].status }]);
      }
      return res.json({ result: results[0] });
    } catch(err) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.put('/api/v1/proxies/nodes/:id', (req, res) => {
    try {
      const { flagged, favorite } = req.body || {};
      const node = db.updateProxyNodeMeta(req.params.id, { flagged, favorite });
      return res.json({ status: 'ok', node });
    } catch (err) {
      if (err.message === 'Node not found') return res.status(404).json({ detail: err.message });
      return res.status(400).json({ detail: err.message });
    }
  });

  app.get('/api/v1/proxies/nodes', (req, res) => {
    return res.json(db.getAll('proxy_nodes'));
  });

  const pidusage = require('pidusage');
  const sharedResourceHistory = [];
  const MAX_HISTORY = 30;

  setInterval(async () => {
    try {
      const pids = [process.pid];
      for (const worker of pool.workers) {
         if (worker.browser && worker.browser.process() && worker.browser.process().pid) {
           pids.push(worker.browser.process().pid);
         }
      }
      const stats = await pidusage(pids);
      let totalCpu = 0;
      let totalMem = 0;
      for (const key in stats) {
         if (stats[key]) {
            totalCpu += (stats[key].cpu || 0);
            totalMem += (stats[key].memory || 0);
         }
      }
      const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      sharedResourceHistory.push({ time: timeStr, cpu: parseFloat(totalCpu.toFixed(2)), memory: parseFloat((totalMem / 1024 / 1024).toFixed(2)) });
      if (sharedResourceHistory.length > MAX_HISTORY) sharedResourceHistory.shift();
    } catch(e) {}
  }, 3000);

  app.get('/api/v1/system/resources', (req, res) => {
    return res.json(sharedResourceHistory);
  });

  const coreManager = require('./proxy_engine/core_manager');
  
  app.get('/api/v1/system/core-status', async (req, res) => {
    const status = await coreManager.checkCoreStatus();
    res.json(status);
  });

  app.get('/api/v1/system/core-download-progress', (req, res) => {
    res.json(coreManager.getDownloadState());
  });

  app.get('/api/v1/system/geodb-status', (req, res) => {
    res.json(coreManager.checkGeoDbStatus());
  });

  app.get('/api/v1/system/geodb-progress', (req, res) => {
    res.json(coreManager.getGeoDownloadState());
  });

  app.post('/api/v1/system/geodb-download', async (req, res) => {
    try {
      await coreManager.downloadGeoDb();
      return res.json(coreManager.checkGeoDbStatus());
    } catch(err) {
      return res.status(500).json({ detail: `GeoDB setup failed: ${err.message}` });
    }
  });

  app.post('/api/v1/system/core-download', async (req, res) => {
    try {
      await coreManager.ensureCore();
      return res.json(await coreManager.checkCoreStatus());
    } catch(err) {
      return res.status(500).json({ detail: `Core setup failed: ${err.message}` });
    }
  });

  app.get('/api/v1/proxies/sys_arch', (req, res) => {
    const os = require('os');
    return res.json({ platform: os.platform(), arch: os.arch() });
  });

  app.get('/api/v1/workers', (req, res) => {
    const dump = pool.workers.map(serializeWorker);
    return res.json(dump);
  });

  app.post('/api/v1/workers', async (req, res) => {
    try {
      const { nodeId } = req.body || {}; // This is the UUID of the proxy config node
      if (!nodeId) return res.status(400).json({ detail: "Proxy Node ID is required to bind a new worker" });
      
      const proxyMetadata = db.getAll('proxy_nodes').find(n => n.id === nodeId);
      if (!proxyMetadata) return res.status(404).json({ detail: "Selected proxy node not found" });

      const newId = await pool.addNode({
        id: proxyMetadata.id,
        name: proxyMetadata.name,
        type: proxyMetadata.type,
        server: proxyMetadata.server,
        config: proxyMetadata.config
      });

      return res.json({ status: 'ok', worker_id: newId });
    } catch(err) {
      return res.status(500).json({ detail: `Failed to spawn worker: ${err.message}` });
    }
  });

  app.delete('/api/v1/workers/:id', async (req, res) => {
    try {
      await pool.removeNode(Number(req.params.id));
      return res.json({ status: 'ok' });
    } catch(err) {
      return res.status(400).json({ detail: err.message });
    }
  });

  app.post('/api/v1/workers/:id/restart', async (req, res) => {
    try {
      const worker = await pool.restartWorker(Number(req.params.id));
      return res.json({ status: 'ok', worker: serializeWorker(worker) });
    } catch (err) {
      return res.status(400).json({ detail: err.message });
    }
  });

  const sessions = new Map();
  const tokenLogs = [];
  
  const addTokenLog = (type, sessionId, nodeId, message, ip = '', apiKey = '') => {
     const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
     tokenLogs.unshift({ id: crypto.randomUUID(), time: timeStr, type, sessionId, nodeId, message, ip, apiKey });
     if (tokenLogs.length > 200) tokenLogs.pop();
  };

  app.get('/api/v1/system/logs', (req, res) => {
     return res.json(tokenLogs);
  });

  app.post('/api/v1/solve', async (req, res) => {
    const { project_id, action = 'IMAGE_GENERATION' } = req.body || {};
    if (req.socket.destroyed) return res.status(499).json({ detail: 'Client disconnected' });

    try {
      const entry = await pool.getToken(120000, action, project_id);

      if (req.socket.destroyed) {
        console.log(`\x1b[35m[F2A-Solve]\x1b[0m 🔌 Client gone, token wasted`);
        return;
      }

      const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, { projectId: project_id, nodeId: entry.nodeId, ip: clientIp, apiKey: req.solverApiKey || '' });
      setTimeout(() => sessions.delete(sessionId), 300000); // clear session after 5 min

      let successRate = 'N/A';
      const worker = pool.workers.find(w => w.nodeId === entry.nodeId);
      if (worker) {
        const total = worker.stats.success + worker.stats.failed;
        successRate = total === 0 ? '100%' : `${Math.round((worker.stats.success / total) * 100)}%`;
      }

      console.log(`\x1b[36m[Node-${entry.nodeId} ${successRate}]\x1b[0m\x1b[35m[F2A-Solve]\x1b[0m \x1b[32m✅ session=${sessionId.substring(0, 8)}... token=[${entry.token.substring(0, 25)}...]\x1b[0m`);
      addTokenLog('DISPATCH', sessionId.substring(0,8), entry.nodeId, `发放成功 (节点通过率 ${successRate})`, clientIp, req.solverApiKey || '');
      return res.json({ token: entry.token, session_id: sessionId, fingerprint: { user_agent: entry.userAgent } });
    } catch (err) {
      return res.status(500).json({ detail: err.message });
    }
  });

  app.post('/api/v1/prefill', (req, res) => {
    const { project_id, action = 'IMAGE_GENERATION' } = req.body || {};
    return res.json({ status: 'ok' });
  });

  app.post('/api/v1/sessions/:sessionId/error', (req, res) => {
    const { sessionId } = req.params;
    const { reason = 'reCAPTCHA 验证失败' } = req.body || {};

    const sess = sessions.get(sessionId);
    if (sess && !sess.resolved) {
      sess.resolved = true;
      pool.reportError(sess.nodeId, sess.projectId);
      console.log(`\x1b[31m[F2A-Error]\x1b[0m session=${sessionId.substring(0, 8)}... reason=${reason}`);
      addTokenLog('ERROR', sessionId.substring(0,8), sess.nodeId, `验证失败: ${reason}`, sess.ip, sess.apiKey);
    }

    return res.json({ status: 'ok' });
  });

  app.post('/api/v1/sessions/:sessionId/finish', (req, res) => {
    const { sessionId } = req.params;

    const sess = sessions.get(sessionId);
    if (sess && !sess.resolved) {
      sess.resolved = true;
      pool.reportSuccess(sess.nodeId);
      console.log(`\x1b[32m[F2A-Finish]\x1b[0m session=${sessionId.substring(0, 8)}... ✅`);
      addTokenLog('SUCCESS', sessionId.substring(0,8), sess.nodeId, '验证通过 (Success)', sess.ip, sess.apiKey);
    }

    return res.json({ status: 'ok' });
  });

  // Legacy solver
  app.post('/solve', async (req, res) => {
    const { action = "IMAGE_GENERATION" } = req.body || {};
    try {
      const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
      const entry = await pool.getToken(120000, action);
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, { projectId: null, nodeId: entry.nodeId, ip: clientIp, apiKey: req.solverApiKey || '' });
      setTimeout(() => sessions.delete(sessionId), 300000); // clear session after 5 min
      
      addTokenLog('DISPATCH', sessionId.substring(0,8), entry.nodeId, `旧版协议发放成功 (action=${action})`, clientIp, req.solverApiKey || '');
      return res.json({ success: true, token: entry.token, userAgent: entry.userAgent });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  return app;
}

module.exports = createApiApp;
