/**
 * 妹子图 HTTP 传输层：http(s) 代理 CONNECT 隧道、https.Agent、单次请求与
 * 「403/429/5xx 或网络超时重试 1 次」封装。图片下载、文章页、APP/网页接口
 * 与 tools/mzt_diag.js 全部复用这里，保证代理对每条链路都生效。
 * 仅依赖 Node 内置模块；纯函数辅助在 lib/mzt-net.js。
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { delay, sanitizeUrl, summarizeError } from "./mzt-net.js";

const HTTP_TIMEOUT = 60000;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const RETRY_MIN = 800;
const RETRY_MAX = 1500;

/* ------------------------------ 代理 ------------------------------ */
/** 只支持 http/https 代理；socks 等返回 ok=false（调用方降级直连）。 */
export function parseProxyUrl(raw) {
	const text = String(raw ?? "").trim();
	if (!text) return { configured: false, ok: true, reason: "", proxy: null };
	let parsed;
	try {
		parsed = new URL(text.includes("://") ? text : `http://${text}`);
	} catch {
		return { configured: true, ok: false, reason: "invalid-url", proxy: null };
	}
	const protocol = parsed.protocol.toLowerCase();
	if (protocol !== "http:" && protocol !== "https:") return { configured: true, ok: false, reason: `unsupported-protocol:${protocol.slice(0, -1)}`, proxy: null };
	if (!parsed.hostname) return { configured: true, ok: false, reason: "missing-host", proxy: null };
	const username = parsed.username ? decodeURIComponent(parsed.username) : "";
	const password = parsed.password ? decodeURIComponent(parsed.password) : "";
	const authorization = username || password ? `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}` : "";
	return {
		configured: true, ok: true, reason: "",
		proxy: { protocol: protocol === "https:" ? "https" : "http", host: parsed.hostname, port: Number(parsed.port) || (protocol === "https:" ? 443 : 80), authorization, hasAuth: Boolean(authorization), username, password },
	};
}
export function formatProxyForLog(proxy) {
	return proxy ? `${proxy.protocol}://${proxy.host}:${proxy.port}${proxy.hasAuth ? " (auth)" : ""}` : "";
}
/** 构造 CONNECT 请求文本（纯函数，测试可直接断言）。 */
export function buildConnectRequest(target, options = {}) {
	const host = String(target?.host ?? "").trim();
	const port = Number(target?.port) || 443;
	if (!host || /[\r\n]/.test(host)) throw new Error("CONNECT 目标非法");
	const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]:${port}` : `${host}:${port}`;
	const authorization = String(options.authorization || "");
	if (/[\r\n]/.test(authorization)) throw new Error("CONNECT 认证头非法");
	const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`];
	if (authorization) lines.push(`Proxy-Authorization: ${authorization}`);
	lines.push(`User-Agent: ${options.userAgent || "mzt"}`, "Proxy-Connection: Keep-Alive");
	return `${lines.join("\r\n")}\r\n\r\n`;
}
/** 解析 CONNECT 响应首行。 */
export function parseConnectResponse(data) {
	const statusLine = (Buffer.isBuffer(data) ? data.toString("latin1") : String(data ?? "")).split("\r\n")[0].trim();
	const match = /^HTTP\/1\.[01]\s+(\d{3})\s*(.*)$/i.exec(statusLine);
	if (!match) return { ok: false, status: 0, reason: "invalid-status-line" };
	const status = Number(match[1]);
	return { ok: status >= 200 && status < 300, status, reason: match[2] || "" };
}
/** 建立 CONNECT 隧道，返回尚未 TLS 握手的 socket。 */
export async function openProxyTunnel(proxy, target, timeoutMs = 15000) {
	const socket = await new Promise((resolve, reject) => {
		const raw = proxy.protocol === "https" ? tls.connect({ host: proxy.host, port: proxy.port, servername: proxy.host }) : net.connect({ host: proxy.host, port: proxy.port });
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			raw.destroy();
			reject(new Error(`代理连接超时（${timeoutMs}ms）`));
		}, timeoutMs);
		if (timer.unref) timer.unref();
		raw.once("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(error);
		});
		raw.once(proxy.protocol === "https" ? "secureConnect" : "connect", () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(raw);
		});
	});
	return new Promise((resolve, reject) => {
		let buffer = Buffer.alloc(0);
		let settled = false;
		let timer = null;
		const cleanup = () => {
			if (timer) clearTimeout(timer);
			socket.removeListener("data", onData);
			socket.removeListener("error", onError);
			socket.removeListener("close", onClose);
		};
		const finish = (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (error) {
				socket.destroy();
				reject(error);
			}
		};
		timer = setTimeout(() => finish(new Error(`代理 CONNECT 超时（${timeoutMs}ms）`)), timeoutMs);
		if (timer.unref) timer.unref();
		const onError = (error) => finish(error);
		const onClose = () => finish(new Error("代理连接在 CONNECT 完成前关闭"));
		const onData = (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			const end = buffer.indexOf("\r\n\r\n");
			if (end < 0) {
				if (buffer.length > 16 * 1024) finish(new Error("代理 CONNECT 响应头过大"));
				return;
			}
			const info = parseConnectResponse(buffer.subarray(0, end + 4));
			if (!info.ok) return finish(new Error(`代理 CONNECT 失败：HTTP ${info.status}`));
			settled = true;
			cleanup();
			socket.setTimeout(0);
			const rest = buffer.subarray(end + 4);
			if (rest.length) socket.unshift(rest);
			resolve(socket);
		};
		socket.on("data", onData);
		socket.on("error", onError);
		socket.on("close", onClose);
		socket.write(buildConnectRequest(target, { authorization: proxy.authorization }));
	});
}
/** 走 CONNECT 隧道的 https.Agent（直接在 https.request 里使用）。 */
export function createProxyAgent(proxy, tlsOptions = {}) {
	if (!proxy?.host) throw new Error("代理配置无效");
	const timeoutMs = Math.max(0, Number(tlsOptions.timeoutMs) || 15000);
	return new (class extends https.Agent {
		constructor() {
			super({ keepAlive: false });
		}
		createConnection(options, callback) {
			const target = { host: options.host || options.hostname, port: Number(options.port) || 443 };
			openProxyTunnel(proxy, target, timeoutMs).then((socket) => {
				const tlsSocket = tls.connect({ socket, servername: tlsOptions.servername || options.servername || target.host, rejectUnauthorized: tlsOptions.rejectUnauthorized !== false, cert: tlsOptions.cert, key: tlsOptions.key });
				let settled = false;
				tlsSocket.once("secureConnect", () => {
					if (settled) return;
					settled = true;
					callback(null, tlsSocket);
				});
				tlsSocket.once("error", (error) => {
					if (settled) return;
					settled = true;
					callback(error);
				});
			}).catch((error) => callback(error));
		}
	})();
}

/* ------------------------------ 请求 ------------------------------ */
function isRetryableStatus(status) {
	const code = Number(status) || 0;
	return code === 403 || code === 429 || code >= 500;
}
function isRetryableError(error) {
	const code = String(error?.code || "");
	return ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "ENETUNREACH"].includes(code) || /timeout|超时/i.test(String(error?.message || ""));
}
export function backoffDelayMs(random = Math.random) {
	const value = Math.min(Math.max(Number(random()) || 0, 0), 0.999999999);
	return RETRY_MIN + Math.floor(value * (RETRY_MAX - RETRY_MIN + 1));
}
/**
 * HTTP(S) GET。options.retry=true 时对 403/429/5xx 与网络超时重试 1 次；
 * 配置代理时 https 走 CONNECT 隧道，隧道失败记录回调后自动降级直连一次。
 */
export async function httpGetBuffer(url, options = {}) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			const response = await requestOnce(url, options);
			if (attempt === 0 && options.retry && isRetryableStatus(response.statusCode)) {
				const waitMs = backoffDelayMs();
				options.onRetry?.({ attempt: 1, reason: `HTTP ${response.statusCode}`, waitMs });
				await delay(waitMs);
				continue;
			}
			return response;
		} catch (error) {
			if (attempt === 0 && options.retry && isRetryableError(error)) {
				const waitMs = backoffDelayMs();
				options.onRetry?.({ attempt: 1, reason: summarizeError(error), waitMs });
				await delay(waitMs);
				continue;
			}
			throw error;
		}
	}
}
async function requestOnce(url, options = {}) {
	const proxy = options.proxy;
	let agent = null;
	if (proxy?.ok && proxy.proxy && /^https:/i.test(String(url))) {
		try {
			agent = createProxyAgent(proxy.proxy, { cert: options.cert, key: options.key, timeoutMs: options.timeout || HTTP_TIMEOUT });
		} catch (error) {
			options.onProxyFailure?.(error);
		}
	}
	if (!agent) return rawGet(url, options);
	try {
		return await rawGet(url, { ...options, agent });
	} catch (error) {
		options.onProxyFailure?.(error);
		return rawGet(url, options);
	}
}
function rawGet(url, options = {}) {
	const { headers = {}, key, cert, timeout = HTTP_TIMEOUT, maxRedirects = 3, redirectCount = 0, agent, cookieJar, method = "GET" } = options;
	return new Promise((resolve, reject) => {
		let target;
		try {
			target = new URL(url);
		} catch {
			reject(new Error(`URL 非法：${sanitizeUrl(url)}`));
			return;
		}
		if (target.protocol !== "http:" && target.protocol !== "https:") {
			reject(new Error(`不支持的协议：${target.protocol}`));
			return;
		}
		const transport = target.protocol === "http:" ? http : https;
		const requestOptions = { method, headers: { ...headers }, timeout };
		if (transport === https) {
			if (agent) requestOptions.agent = agent;
			else if (key || cert) {
				requestOptions.key = key;
				requestOptions.cert = cert;
			}
		}
		const req = transport.request(target, requestOptions, (res) => {
			const statusCode = res.statusCode || 0;
			try {
				cookieJar?.updateFromHeaders(res.headers);
			} catch {
				// Cookie 解析失败不影响请求
			}
			const location = res.headers.location;
			if (REDIRECT_CODES.has(statusCode) && location) {
				res.resume();
				if (redirectCount >= maxRedirects) {
					reject(new Error(`重定向次数超过 ${maxRedirects} 次：${sanitizeUrl(url)}`));
					return;
				}
				let nextUrl;
				try {
					nextUrl = new URL(location, target).toString();
				} catch {
					reject(new Error(`重定向地址非法：${sanitizeUrl(location)}`));
					return;
				}
				rawGet(nextUrl, { ...options, redirectCount: redirectCount + 1 }).then(resolve, reject);
				return;
			}
			const chunks = [];
			let total = 0;
			let settled = false;
			res.on("data", (chunk) => {
				if (settled) return;
				total += chunk.length;
				if (total > MAX_RESPONSE_BYTES) {
					settled = true;
					res.destroy();
					reject(new Error(`响应体超过大小上限 ${MAX_RESPONSE_BYTES} 字节：${sanitizeUrl(url)}`));
					return;
				}
				chunks.push(chunk);
			});
			res.on("end", () => {
				if (settled) return;
				settled = true;
				resolve({ statusCode, headers: res.headers, body: Buffer.concat(chunks), finalUrl: target.toString() });
			});
			res.on("error", (error) => {
				if (settled) return;
				settled = true;
				reject(error);
			});
		});
		req.on("timeout", () => req.destroy(new Error(`请求超时（${timeout}ms）：${sanitizeUrl(url)}`)));
		req.on("error", reject);
		req.end();
	});
}
