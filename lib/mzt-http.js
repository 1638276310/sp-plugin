/**
 * 妹子图 HTTP 传输层：固定直连（设备本机网络出口）+ TLS 证书校验 +
 * 「403/429/5xx 或网络超时重试 1 次」封装。图片下载、APP 接口与
 * tools/mzt_diag.js 全部复用这里；不使用任何代理。
 * 仅依赖 Node 内置模块；纯函数辅助在 lib/mzt-net.js。
 */
import http from "node:http";
import https from "node:https";
import { delay, sanitizeUrl, summarizeError } from "./mzt-net.js";

const HTTP_TIMEOUT = 60000;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const RETRY_MIN = 800;
const RETRY_MAX = 1500;

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
 * HTTP(S) GET。固定直连，不读取任何代理；options.retry=true 时对
 * 403/429/5xx 与网络超时重试 1 次。
 */
export async function httpGetBuffer(url, options = {}) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			const response = await rawGet(url, options);
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
function rawGet(url, options = {}) {
	const { headers = {}, key, cert, timeout = HTTP_TIMEOUT, maxRedirects = 3, redirectCount = 0, cookieJar, method = "GET" } = options;
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
			// 显式校验证书链：默认 CA（系统信任库）+ 主机名校验，禁止跳过。
			requestOptions.rejectUnauthorized = true;
			requestOptions.servername = target.hostname;
			if (key || cert) {
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
