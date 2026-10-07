// Minimal Chrome DevTools Protocol client over a raw socket.
//
// Why this exists: headless Chrome's --window-size refuses to go below about
// 500px on Windows, so `--window-size=360` silently renders at 504 and every
// "phone width" check is a lie. Real phone viewports need
// Emulation.setDeviceMetricsOverride, which is CDP-only.
//
// Node 20 has no global WebSocket and there's no `ws` installed, so the
// handshake and framing are done by hand. Only what's needed is implemented:
// text frames, client-side masking, server frames up to 64-bit length. No
// extensions, no fragmentation, no ping/pong beyond an echoed close.
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function getJSON(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: route }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
}

async function waitForPort(port, timeoutMs = 15000) {
  const started = Date.now();
  for (;;) {
    try { return await getJSON(port, '/json/version'); } catch {
      if (Date.now() - started > timeoutMs) throw new Error('Chrome did not expose a debug port');
      await new Promise((r) => setTimeout(r, 120));
    }
  }
}

class WS {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.handlers = [];
    socket.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      for (;;) {
        const frame = this.readFrame();
        if (!frame) break;
        for (const h of this.handlers) h(frame);
      }
    });
  }

  readFrame() {
    if (this.buf.length < 2) return null;
    const opcode = this.buf[0] & 0x0f;
    const masked = (this.buf[1] & 0x80) !== 0;
    let len = this.buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (this.buf.length < off + 2) return null;
      len = this.buf.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (this.buf.length < off + 8) return null;
      len = Number(this.buf.readBigUInt64BE(off)); off += 8;
    }
    let mask = null;
    if (masked) {
      if (this.buf.length < off + 4) return null;
      mask = this.buf.slice(off, off + 4); off += 4;
    }
    if (this.buf.length < off + len) return null;
    let payload = this.buf.slice(off, off + len);
    if (mask) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    this.buf = this.buf.slice(off + len);
    return { opcode, payload };
  }

  send(text) {
    const data = Buffer.from(text, 'utf8');
    const mask = crypto.randomBytes(4);
    let header;
    if (data.length < 126) {
      header = Buffer.from([0x81, 0x80 | data.length]);
    } else if (data.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 0x80 | 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const masked = Buffer.from(data);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  onMessage(fn) {
    this.handlers.push((f) => {
      if (f.opcode === 0x1) fn(f.payload.toString('utf8'));
    });
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(Number(u.port), u.hostname, () => {
      socket.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n'`.replace("'", '')
      );
    });
    socket.once('error', reject);
    let head = Buffer.alloc(0);
    const onData = (d) => {
      head = Buffer.concat([head, d]);
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) return;
      if (!/HTTP\/1\.1 101/.test(head.slice(0, end).toString())) {
        reject(new Error('WebSocket upgrade refused: ' + head.slice(0, end).toString().split('\r\n')[0]));
        return;
      }
      socket.removeListener('data', onData);
      const ws = new WS(socket);
      // Anything Chrome pipelined after the handshake belongs to the ws stream.
      const rest = head.slice(end + 4);
      if (rest.length) socket.emit('data', rest);
      resolve(ws);
    };
    socket.on('data', onData);
  });
}

// A page session: send(method, params) → Promise(result), plus event waiting.
async function openPage(url, { width, height, dpr = 2, mobile = true, preload = '' } = {}) {
  const port = 9223 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-cdp-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=900,1000',
    'about:blank',
  ], { stdio: 'ignore' });

  await waitForPort(port);
  const targets = await getJSON(port, '/json/list');
  const page = targets.find((t) => t.type === 'page');
  const ws = await connect(page.webSocketDebuggerUrl);

  let nextId = 1;
  const pending = new Map();
  ws.onMessage((raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' timed out')); }
      }, 30000);
    });

  await send('Page.enable');
  await send('Runtime.enable');
  // The whole point: a genuine narrow viewport, which --window-size cannot give.
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dpr, mobile,
  });
  if (preload) await send('Page.addScriptToEvaluateOnNewDocument', { source: preload });
  await send('Page.navigate', { url });

  const close = () => {
    try { ws.socket.destroy(); } catch {}
    chrome.kill();
    // Chrome keeps a handle on its crashpad files for a moment after kill, so
    // the first unlink can fail with EBUSY. That's cosmetic — a temp dir left
    // behind must never take the test run down with it.
    setTimeout(() => {
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
      catch { /* Windows still holding it; the OS will clear %TEMP% eventually */ }
    }, 500).unref?.();
  };

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'evaluate threw');
    }
    return r.result.value;
  };

  const screenshot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  };

  return { send, evaluate, screenshot, close };
}

module.exports = { openPage };
