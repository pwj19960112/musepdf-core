/**
 * Minimal Chrome DevTools Protocol client for the workbench verification scripts.
 *
 *   node scripts/cdp-lib.mjs                     # smoke: connect, print the browser version
 *
 * WHY THIS EXISTS: `browser_exec(local=True)` falls back to a cloud browser whenever the user's
 * Chrome profile is locked, and the cloud browser cannot reach localhost nor paint a canvas — so
 * every mount check against a local preview server looks broken. Driving a LOCAL Chrome over raw CDP
 * needs no dependencies (Node >= 22 has a global WebSocket) and is what the /edit-pdf/ verification
 * playbook prescribes.
 *
 * Usage:
 *   "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
 *     --remote-debugging-port=9335 --user-data-dir=<scratch>/cdp-markup \
 *     --no-first-run --no-proxy-server --disable-gpu --window-size=1400,900 --lang=en about:blank &
 *   node scripts/verify-workbench-markup.mjs --cdp 9335
 */
import { setTimeout as sleep } from 'node:timers/promises';

const json = async (url, init) => {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} -> ${res.status}`);
    return res.status === 204 ? null : res.json();
};

export class Cdp {
    constructor(ws, sessionId = null) {
        this.ws = ws;
        this.sessionId = sessionId;
        this.nextId = 0;
        this.pending = new Map();
        this.listeners = new Set();
        ws.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { resolve, reject } = this.pending.get(msg.id);
                this.pending.delete(msg.id);
                if (msg.error) reject(new Error(JSON.stringify(msg.error)));
                else resolve(msg.result);
                return;
            }
            for (const listener of this.listeners) listener(msg);
        });
    }

    static async attachPage(port, { url = 'about:blank', timeoutMs = 20000 } = {}) {
        const deadline = Date.now() + timeoutMs;
        let target = null;
        while (Date.now() < deadline) {
            try {
                target = await json(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
                    method: 'PUT',
                });
                break;
            } catch {
                await sleep(250);
            }
        }
        if (!target) throw new Error(`no CDP page target on port ${port}`);
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve);
            ws.addEventListener('error', reject);
        });
        const cdp = new Cdp(ws);
        cdp.targetId = target.id;
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('DOM.enable');
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 1400,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
        });
        return cdp;
    }

    send(method, params = {}) {
        const id = ++this.nextId;
        const payload = { id, method, params };
        if (this.sessionId) payload.sessionId = this.sessionId;
        this.ws.send(JSON.stringify(payload));
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`${method} timed out`));
                }
            }, 60000);
        });
    }

    onMessage(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async goto(url) {
        await this.send('Page.navigate', { url });
        await this.waitFor('document.readyState === "complete"');
    }

    /** Evaluate an expression, optionally with awaitPromise, returning the value. */
    async eval(expression, { awaitPromise = true } = {}) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise,
            userGesture: true,
        });
        if (result.exceptionDetails) {
            throw new Error(
                `eval failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
            );
        }
        return result.result?.value;
    }

    /** Poll an expression until it is truthy. */
    async waitFor(expression, { timeoutMs = 30000, intervalMs = 200, label } = {}) {
        const deadline = Date.now() + timeoutMs;
        let last;
        while (Date.now() < deadline) {
            try {
                last = await this.eval(`(() => ${expression})()`);
                if (last) return last;
            } catch (error) {
                last = String(error.message);
            }
            await sleep(intervalMs);
        }
        throw new Error(`waitFor timed out (${label ?? expression}): last=${JSON.stringify(last)}`);
    }

    /** Set a controlled React input's value the way a user's keystrokes would. */
    async fill(selector, value) {
        return this.eval(
            `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return "no-element";
                const setter = Object.getOwnPropertyDescriptor(
                    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
                    "value",
                ).set;
                setter.call(el, ${JSON.stringify(value)});
                el.dispatchEvent(new Event("input", { bubbles: true }));
                return "ok";
            })()`,
        );
    }

    async click(selector) {
        return this.eval(
            `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return "no-element";
                el.click();
                return "ok";
            })()`,
        );
    }

    /** Where an element is on screen right now (viewport CSS pixels). */
    async rect(selector) {
        return this.eval(
            `(() => {
                const el = document.querySelector(${JSON.stringify(selector)});
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height };
            })()`,
        );
    }

    async mouse(type, x, y, extra = {}) {
        await this.send('Input.dispatchMouseEvent', {
            type,
            x: Math.round(x),
            y: Math.round(y),
            button: 'left',
            buttons: type === 'mouseReleased' ? 0 : 1,
            clickCount: 1,
            ...extra,
        });
    }

    async drag(from, to, { steps = 8 } = {}) {
        await this.mouse('mousePressed', from.x, from.y);
        for (let i = 1; i <= steps; i++) {
            await this.mouse(
                'mouseMoved',
                from.x + ((to.x - from.x) * i) / steps,
                from.y + ((to.y - from.y) * i) / steps,
            );
            await sleep(20);
        }
        await this.mouse('mouseReleased', to.x, to.y);
        await sleep(150);
    }

    async clickPoint(point) {
        await this.mouse('mousePressed', point.x, point.y);
        await sleep(30);
        await this.mouse('mouseReleased', point.x, point.y);
        await sleep(150);
    }

    /** Pick a file with the page's own <input type=file>, via the DOM node id. */
    async setFileInput(selector, filePath) {
        const doc = await this.send('DOM.getDocument', { depth: -1, pierce: true });
        const node = await this.send('DOM.querySelector', {
            nodeId: doc.root.nodeId,
            selector,
        });
        if (!node?.nodeId) throw new Error(`no ${selector} in the DOM`);
        await this.send('DOM.setFileInputFiles', { files: [filePath], nodeId: node.nodeId });
    }

    async close() {
        try {
            await json(`http://127.0.0.1:${new URL(this.ws.url).port}/json/close/${this.targetId}`);
        } catch {
            /* the browser may already be gone */
        }
        this.ws.close();
    }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
    const port = process.argv[2] ?? '9335';
    const cdp = await Cdp.attachPage(port);
    console.log(await cdp.eval('navigator.userAgent'));
    console.log(await cdp.eval('location.href'));
    await cdp.close();
}
