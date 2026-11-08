// Shared harness for scripts/verify-*.cjs.
//
// Every UI check used to re-implement the same Electron plumbing: an offscreen window, page
// error capture, executeJavaScript/pause/until helpers, screenshots and cleanup. The copies
// drifted — some collected console errors, some did not; timeouts were local decisions. A check
// now supplies its content and its assertions; this module owns the lifecycle and the helpers.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IGNORED_PAGE_ERRORS = ['ResizeObserver loop'];

function createHarness({ name, width = 1100, height = 850, userData, output, ignoreErrors = [] }) {
  const outputDir = output ?? path.join(path.resolve(__dirname, '../..'), 'outputs', name);
  app.setPath('userData', userData ?? fs.mkdtempSync(path.join(os.tmpdir(), `cos-${name}-`)));
  const ignored = [...IGNORED_PAGE_ERRORS, ...ignoreErrors];
  const pageErrors = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const harness = {
    app,
    outputDir,
    pageErrors,
    pause,
    async ready() {
      await app.whenReady();
      return harness;
    },
    async window(options = {}) {
      const win = new BrowserWindow({
        show: false,
        width,
        height,
        webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false, ...(options.webPreferences || {}) }
      });
      win.webContents.on('console-message', event => {
        if (event.level === 'error' && !ignored.some(skip => event.message.includes(skip))) pageErrors.push(event.message);
      });
      harness.win = win;
      return win;
    },
    js(expression, userGesture = false) {
      return harness.win.webContents.executeJavaScript(expression, userGesture);
    },
    async until(expression, timeout = 8000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await harness.js(expression)) return;
        await pause(40);
      }
      throw new Error('Timeout: ' + expression);
    },
    async loadHtml(html) {
      await harness.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    },
    async loadUrl(url) {
      await harness.win.loadURL(url);
    },
    async shot(file) {
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, file), (await harness.win.webContents.capturePage()).toPNG());
    },
    finish({ assertClean = false } = {}) {
      if (assertClean && pageErrors.length > 0) {
        console.error('page errors:', pageErrors.join(' | '));
        process.exitCode = 1;
      }
      try {
        if (harness.win) harness.win.destroy();
      } catch {}
      app.quit();
    },
    onError(error) {
      console.error(error);
      app.exit(1);
    }
  };
  return harness;
}

module.exports = { createHarness };
