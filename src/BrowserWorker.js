const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteerBase = require('puppeteer');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { RECAPTCHA_SITE_KEY, TARGET_URL, PROXY_USER, PROXY_PASS, POOL_CONFIG } = require('./config');
const { spawnProxyCore, killProxyCore } = require('./proxy_engine/core_manager');

function isUsableExecutable(filePath) {
  if (!filePath) return false;
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function getSystemChromeCandidates() {
  const homeDir = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(homeDir, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      ];
    case 'win32': {
      const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
      const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
      const localAppData = process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
      return [
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ];
    }
    default:
      return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
      ];
  }
}

function resolveChromeExecutable() {
  const envCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_EXECUTABLE_PATH,
  ];

  for (const candidate of envCandidates) {
    if (isUsableExecutable(candidate)) return candidate;
  }

  for (const candidate of getSystemChromeCandidates()) {
    if (isUsableExecutable(candidate)) return candidate;
  }

  try {
    const bundledPath = puppeteerBase.executablePath();
    if (isUsableExecutable(bundledPath)) return bundledPath;
  } catch {}

  return null;
}

const NON_SOLVE_RESTART_REASONS = new Set([
  'init_failure',
  'page_setup_failure',
  'proxy_failure',
  'warmup_failure',
]);

const MAX_NON_SOLVE_FAILURES = 10;

class BrowserWorker {
  constructor(nodeId, proxyHost, initialStats = null) {
    this.nodeId = nodeId;
    this.proxyHost = proxyHost;
    this.browser = null;
    this.page = null;
    this.userAgent = null;
    this.ready = false;
    this.isFetching = false;
    this.lastExecuteTime = 0;
    this.consecutiveFailures = 0;
    this.restartFailCount = 0;
    this.isRestarting = false;
    this.isShuttingDown = false; // Flag to indicate graceful deletion
    this.isPaused = false;
    this.pauseReason = null;
    this.nonSolveFailureCount = 0;
    this.lastRestartReason = null;
    this.lastErrorMessage = null;
    this.stats = initialStats ? { ...initialStats } : { generated: 0, success: 0, failed: 0 };
    this.isSubProxy = false;
    this.realProxyHost = proxyHost;
  }

  _isNonSolveReason(reason) {
    return NON_SOLVE_RESTART_REASONS.has(reason);
  }

  _resetPauseState() {
    this.isPaused = false;
    this.pauseReason = null;
    this.nonSolveFailureCount = 0;
    this.lastErrorMessage = null;
  }

  async _closeRuntime({ killSubProxy = false } = {}) {
    if (this.page && !this.page.isClosed()) {
      await this.page.close().catch(() => {});
    }
    this.page = null;

    if (this.browser) {
      await this.browser.close().catch(() => {});
    }
    this.browser = null;

    if (killSubProxy && this.isSubProxy) {
      await killProxyCore(this.nodeId).catch(() => {});
      this.realProxyHost = null;
    }
  }

  async _pause(reason, error) {
    this.isPaused = true;
    this.ready = false;
    this.isRestarting = false;
    this.pauseReason = reason;
    this.lastRestartReason = reason;
    this.lastErrorMessage = error?.message || this.lastErrorMessage;
    await this._closeRuntime({ killSubProxy: true });
    console.error(`\x1b[36m[Node-${this.nodeId}]\x1b[0m \x1b[31m⏸ 已暂停:\x1b[0m ${reason} (非打码异常累计 ${this.nonSolveFailureCount}/${MAX_NON_SOLVE_FAILURES})`);
  }

  async handleFailure(reason, error) {
    if (this.isShuttingDown) return;

    this.lastRestartReason = reason;
    this.lastErrorMessage = error?.message || null;

    if (this._isNonSolveReason(reason)) {
      this.nonSolveFailureCount++;
      if (this.nonSolveFailureCount >= MAX_NON_SOLVE_FAILURES) {
        await this._pause(reason, error);
        return;
      }
    }

    await this._handleRestart({ reason });
  }

  _generateFingerprint() {
    // --- UA 与平台档案 (内部一致) ---
    const profiles = [
      { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', platform: 'Win32', oscpu: 'Windows NT 10.0; Win64; x64' },
      { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', platform: 'Win32', oscpu: 'Windows NT 10.0; Win64; x64' },
      { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', platform: 'Win32', oscpu: 'Windows NT 10.0; Win64; x64' },
      { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', platform: 'MacIntel', oscpu: 'Intel Mac OS X 10_15_7' },
      { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', platform: 'MacIntel', oscpu: 'Intel Mac OS X 10_15_7' },
      { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', platform: 'MacIntel', oscpu: 'Intel Mac OS X 14_0' },
      { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', platform: 'Linux x86_64', oscpu: 'Linux x86_64' },
      { ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', platform: 'Linux x86_64', oscpu: 'Linux x86_64' },
    ];
    const profile = profiles[Math.floor(Math.random() * profiles.length)];

    // --- 屏幕分辨率 ---
    const screens = [
      { w: 1920, h: 1080 }, { w: 2560, h: 1440 }, { w: 1366, h: 768 },
      { w: 1536, h: 864 }, { w: 1440, h: 900 }, { w: 1680, h: 1050 },
      { w: 1280, h: 720 }, { w: 1600, h: 900 }, { w: 1280, h: 1024 },
      { w: 2560, h: 1080 }, { w: 3440, h: 1440 }, { w: 1920, h: 1200 },
    ];
    const screen = screens[Math.floor(Math.random() * screens.length)];

    // --- WebGL 显卡指纹 ---
    const gpus = [
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)' },
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' },
    ];
    const gpu = gpus[Math.floor(Math.random() * gpus.length)];

    // --- 语言偏好 ---
    const langSets = [
      ['en-US', 'en'], ['en-US'], ['en-US', 'en', 'zh-CN'],
      ['en-US', 'en', 'es'], ['en-US', 'en-GB', 'en'],
    ];
    const languages = langSets[Math.floor(Math.random() * langSets.length)];

    // --- 美国时区 ---
    const timezones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix'];
    const timezone = timezones[Math.floor(Math.random() * timezones.length)];

    // --- 硬件特征 ---
    const hardwareConcurrency = [4, 6, 8, 10, 12, 16][Math.floor(Math.random() * 6)];
    const deviceMemory = [4, 8, 16, 32][Math.floor(Math.random() * 4)];

    // --- Canvas 噪声种子 ---
    const canvasNoiseSeed = crypto.randomBytes(8).toString('hex');

    // --- AudioContext 噪声偏移 ---
    const audioNoise = (Math.random() - 0.5) * 0.00001;

    return {
      ...profile, screen, gpu, languages, timezone,
      hardwareConcurrency, deviceMemory, canvasNoiseSeed, audioNoise
    };
  }

  async init() {
    if (this.isShuttingDown || this.isPaused) return;
    
    this.fingerprint = this._generateFingerprint();
    const fp = this.fingerprint;
    const executablePath = resolveChromeExecutable();

    try {
      if (this.proxyHost && typeof this.proxyHost === 'object' && this.proxyHost.server) {
        if (!this.realProxyHost || typeof this.realProxyHost !== 'string') {
          this.isSubProxy = true;
          this.realProxyHost = await spawnProxyCore(this.nodeId, this.proxyHost.config || this.proxyHost);
        }
      } else {
        this.realProxyHost = this.proxyHost;
      }
    } catch (error) {
      error.restartReason = 'proxy_failure';
      error.message = `Failed to initialize proxy core: ${error.message}`;
      throw error;
    }

    console.log(`\x1b[36m[Node-${this.nodeId}]\x1b[0m 🚀 Init config proxy: ${this.realProxyHost || 'None'}`);

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      `--user-agent=${fp.ua}`,
      `--lang=${fp.languages[0]}`,
      `--timezone=${fp.timezone}`,
    ];
    if (this.realProxyHost) {
      args.push(`--proxy-server=http://${this.realProxyHost}`);
    }

    if (!executablePath) {
      throw new Error('No usable Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH or install a Puppeteer-managed Chrome build.');
    }

    console.log(`\x1b[36m[Node-${this.nodeId}]\x1b[0m 🧭 Using Chrome executable: ${executablePath}`);

    this.browser = await puppeteer.launch({
      executablePath,
      headless: 'new',
      defaultViewport: { width: fp.screen.w, height: fp.screen.h },
      args
    });

    try {
      await this._setupPage();
    } catch (error) {
      error.restartReason = error.restartReason || 'page_setup_failure';
      throw error;
    }
    this._resetPauseState();
    if (!this.isShuttingDown) {
      console.log(`\x1b[36m[Node-${this.nodeId}]\x1b[0m \x1b[32m✅ Ready.\x1b[0m`);
    } else {
      await this.shutdown();
    }
  }

  async _setupPage() {
    if (this.isShuttingDown || this.isPaused || !this.browser) return;
    
    const fp = this.fingerprint;
    this.page = await this.browser.newPage();
    if (this.realProxyHost && !this.isSubProxy && PROXY_USER && PROXY_PASS) {
      await this.page.authenticate({ username: PROXY_USER, password: PROXY_PASS });
    }

    await this.page.evaluateOnNewDocument((fpData) => {
      Object.defineProperty(navigator, 'platform', { get: () => fpData.platform });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fpData.hardwareConcurrency });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => fpData.deviceMemory });
      Object.defineProperty(navigator, 'languages', { get: () => Object.freeze([...fpData.languages]) });
      Object.defineProperty(navigator, 'language', { get: () => fpData.languages[0] });

      Object.defineProperty(navigator, 'webdriver', { get: () => false });

      const origGetParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (param) {
        if (param === 0x9245) return fpData.gpu.vendor;
        if (param === 0x9246) return fpData.gpu.renderer;
        return origGetParameter.call(this, param);
      };
      const origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (param) {
        if (param === 0x9245) return fpData.gpu.vendor;
        if (param === 0x9246) return fpData.gpu.renderer;
        return origGetParameter2.call(this, param);
      };

      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (type) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const seed = fpData.canvasNoiseSeed;
          let hash = 0;
          for (let i = 0; i < seed.length; i++) {
            hash = ((hash << 5) - hash) + seed.charCodeAt(i);
            hash |= 0;
          }
          const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
          for (let i = 0; i < imageData.data.length; i += 4) {
            hash = ((hash << 5) - hash + i) | 0;
            imageData.data[i] = (imageData.data[i] + (hash % 3)) & 0xFF;
          }
          ctx.putImageData(imageData, 0, 0);
        }
        return origToDataURL.call(this, type);
      };

      const origCreateOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () {
        const osc = origCreateOscillator.call(this);
        const origConnect = osc.connect.bind(osc);
        osc.connect = function (dest) {
          const gain = osc.context.createGain();
          gain.gain.value = 1 + fpData.audioNoise;
          origConnect(gain);
          gain.connect(dest);
          return dest;
        };
        return osc;
      };

      Object.defineProperty(screen, 'width', { get: () => fpData.screen.w });
      Object.defineProperty(screen, 'height', { get: () => fpData.screen.h });
      Object.defineProperty(screen, 'availWidth', { get: () => fpData.screen.w });
      Object.defineProperty(screen, 'availHeight', { get: () => fpData.screen.h - 40 });
      Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
      Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });

      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

      const origQuery = Permissions.prototype.query;
      Permissions.prototype.query = function (parameters) {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return origQuery.call(this, parameters);
      };

      window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };

    }, { platform: fp.platform, hardwareConcurrency: fp.hardwareConcurrency, deviceMemory: fp.deviceMemory, languages: fp.languages, gpu: fp.gpu, canvasNoiseSeed: fp.canvasNoiseSeed, audioNoise: fp.audioNoise, screen: fp.screen });

    await this.page.emulateTimezone(fp.timezone);
    await this.page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForFunction(
      () => !!window.grecaptcha?.enterprise?.execute,
      { timeout: 15000 }
    );

    const info = await this.page.evaluate(() => {
      return { user_agent: navigator.userAgent || '' };
    });
    this.userAgent = info.user_agent;
    this.ready = true && !this.isShuttingDown;
  }

  async _recover() {
    if (this.isRestarting || this.isShuttingDown || this.isPaused) return;
    console.log(`\x1b[36m[Node-${this.nodeId}]\x1b[0m \x1b[33m🔄 Recovering...\x1b[0m`);
    this.ready = false;
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close().catch(() => {});
      }
      this.page = null;
      await this._setupPage();
      if (!this.isShuttingDown) console.log(`[Node-${this.nodeId}] ✅ Recovery success`);
    } catch (e) {
      if (!this.isShuttingDown) console.error(`\x1b[36m[Node-${this.nodeId}]\x1b[0m \x1b[31m❌ Recovery failed:\x1b[0m`, e.message);
      await this.handleFailure('warmup_failure', e);
    }
  }

  async _handleRestart({ reason = 'unknown', force = false } = {}) {
    if (this.isRestarting || this.isShuttingDown) return;
    if (this.isPaused && !force) return;

    this.isRestarting = true;
    this.ready = false;
    this.lastRestartReason = reason;

    const delayMs = Math.min(this.restartFailCount * 10000, 30000);
    if (delayMs > 0 && !this.isShuttingDown) {
      console.log(`\x1b[36m[Node-${this.nodeId}]\x1b[0m \x1b[33m⏳ 重启退避惩罚: 等待 ${delayMs / 1000} 秒后重试...\x1b[0m`);
      await new Promise(r => setTimeout(r, delayMs));
    }
    
    if (this.isShuttingDown || (this.isPaused && !force)) {
      this.isRestarting = false;
      return;
    }

    console.log(`\x1b[36m[Node-${this.nodeId}]\x1b[0m \x1b[33m🔄 开始彻底销毁并重启浏览器实例...\x1b[0m`);
    try {
      await this._closeRuntime();
      await this.init();
      this.consecutiveFailures = 0;
      this.restartFailCount = 0;
      if (!this.isShuttingDown) console.log(`\x1b[36m[Node-${this.nodeId}]\x1b[0m \x1b[32m🟢 节点彻底重启自愈成功！\x1b[0m`);
    } catch (e) {
      if (!this.isShuttingDown) {
        console.error(`\x1b[36m[Node-${this.nodeId}]\x1b[0m \x1b[31m❌ 重启失败:\x1b[0m`, e.message);
        this.restartFailCount++;
      }
      this.isRestarting = false;
      if (!this.isShuttingDown) {
        await this.handleFailure('warmup_failure', e);
      }
      return;
    }
    this.isRestarting = false;
  }

  async shutdown() {
    this.isShuttingDown = true;
    this.ready = false;
    try {
      await this._closeRuntime({ killSubProxy: true });
      console.log(`\x1b[36m[Node-${this.nodeId}]\x1b[0m \x1b[35m💀 Node safely terminated.\x1b[0m`);
    } catch(e) {}
  }

  async manualRestart() {
    if (this.isShuttingDown) {
      throw new Error('Worker is shutting down');
    }
    if (this.isFetching) {
      throw new Error('Worker is busy processing a task');
    }

    this._resetPauseState();
    this.ready = false;
    this.restartFailCount = 0;

    await this._handleRestart({ reason: 'manual_restart', force: true });

    if (this.isPaused) {
      throw new Error(this.lastErrorMessage || 'Manual restart failed');
    }
  }

  async executeToken(action) {
    if (!this.ready || this.isShuttingDown || this.isPaused) throw new Error("Worker not ready or shutting down");
    // NOTE: isFetching is managed exclusively by _dispatchTask (GlobalTokenPool)
    // to prevent race conditions with the 500ms wakeup timer.

    try {
      const elapsed = Date.now() - this.lastExecuteTime;
      if (elapsed < POOL_CONFIG.minInterval) {
        await new Promise(r => setTimeout(r, POOL_CONFIG.minInterval - elapsed));
      }

      if (this.isShuttingDown) throw new Error("Worker shutting down");

      const t0 = Date.now();
      const token = await Promise.race([
        this.page.evaluate(async (sitekey, act) => {
          return await window.grecaptcha.enterprise.execute(sitekey, { action: act });
        }, RECAPTCHA_SITE_KEY, action),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000))
      ]);
      this.lastExecuteTime = Date.now();
      this.consecutiveFailures = 0;
      return { token, userAgent: this.userAgent, createdAt: Date.now(), action, nodeId: this.nodeId };
    } catch (e) {
      this.consecutiveFailures++;
      console.error(`\x1b[36m[Node-${this.nodeId}]\x1b[0m \x1b[31m❌ Execution failed (连续失败: ${this.consecutiveFailures}次):\x1b[0m`, e.message);

      if (this.consecutiveFailures >= 1) {
        this.handleFailure('execute_failure', e).catch(() => { });
      } else {
        this._recover().catch(() => { });
      }
      throw e;
    }
    // No finally block: isFetching is reset by _dispatchTask after executeToken settles.
  }

}

module.exports = BrowserWorker;
