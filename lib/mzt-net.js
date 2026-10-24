/**
 * 妹子图网络辅助模块（纯函数层）：统一请求头、Cloudflare 识别、Cookie 会话、
 * 证书校验、日志脱敏与限速。供 apps/mzt.js、lib/mzt-http.js 与
 * tools/mzt_diag.js 共用；仅依赖 Node 内置模块。
 */
import fs from "node:fs";

export const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en;q=0.8";
export const API_ACCEPT = "application/json, text/javascript, */*; q=0.01";
const ARTICLE_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";
const CF_STRONG = ["cf-error-details", "just a moment", "attention required", "you have been blocked", "sorry, you have been blocked"];
// 200 正常页面也会注入 challenge-platform 等脚本，因此 200 分支只认硬拦截特征
const CF_BODY_200 = ["you have been blocked", "cf-error-details"];
const CF_BLOCK_ONLY = ["cf-chl-", "challenge-platform", "cf-browser-verification"];

/* ------------------------------ 基础工具 ------------------------------ */
export function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
function truncate(text, maxLength = 120) {
	const value = String(text ?? "");
	const limit = Math.max(1, Math.floor(Number(maxLength) || 120));
	return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
export function clampStageText(text, maxLength = 90) {
	return truncate(String(text ?? "").replace(/\s+/g, " ").trim(), maxLength);
}
export function resolveUserAgent(configured) {
	const value = typeof configured === "string" ? configured.trim() : "";
	return value || DEFAULT_USER_AGENT;
}

/* ------------------------------ 统一请求头 ------------------------------ */
/** kind: article | api | app | image；cookie 仅 article/api 使用（会话复用）。 */
export function buildHeaders(kind, options = {}) {
	const headers = { "User-Agent": resolveUserAgent(options.ua), "Accept-Language": ACCEPT_LANGUAGE };
	const map = {
		article: { Accept: ARTICLE_ACCEPT, "Upgrade-Insecure-Requests": "1", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": options.sameOrigin ? "same-origin" : "none", "Sec-Fetch-User": "?1" },
		api: { Accept: API_ACCEPT, "X-Requested-With": "XMLHttpRequest", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": options.crossSite ? "cross-site" : "same-origin" },
		// 官方 APP 是原生请求：只带 APP UA/接口头，不混入浏览器 Sec-Fetch/Referer
		app: { Accept: API_ACCEPT, "X-Requested-With": "XMLHttpRequest" },
		image: { Accept: IMAGE_ACCEPT, "Sec-Fetch-Dest": "image", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Site": options.sameOrigin ? "same-origin" : "cross-site" },
	};
	const extra = map[kind];
	if (!extra) throw new Error(`未知请求头类型：${kind}`);
	Object.assign(headers, extra);
	if (options.referer) headers.Referer = String(options.referer).trim();
	if (options.cookie && (kind === "article" || kind === "api")) headers.Cookie = String(options.cookie).trim();
	return headers;
}

/* ------------------------------ URL 脱敏 ------------------------------ */
/** 日志用 URL：保留协议/域名/path，query 只留 id（图片 sign 等全部丢弃）。 */
export function sanitizeUrl(rawUrl, options = {}) {
	const keepOrigin = options.keepOrigin !== false;
	const maxLength = Math.max(16, Number(options.maxLength) || 200);
	const text = String(rawUrl ?? "").trim();
	if (!text) return "";
	if (/^data:/i.test(text)) return "[data-url]";
	try {
		const parsed = new URL(text);
		const route = sanitizePath(`${parsed.pathname || "/"}${parsed.search || ""}`, Infinity);
		return truncate(keepOrigin ? `${parsed.protocol}//${parsed.host}${route}` : route, maxLength);
	} catch {
		return sanitizePath(text, maxLength);
	}
}
function sanitizePath(text, maxLength) {
	const withoutHash = text.split("#")[0];
	const at = withoutHash.indexOf("?");
	if (at < 0) return truncate(withoutHash, maxLength);
	let id = "";
	try {
		id = new URLSearchParams(withoutHash.slice(at + 1)).get("id") || "";
	} catch {
		id = "";
	}
	return truncate(id ? `${withoutHash.slice(0, at)}?id=${id}` : withoutHash.slice(0, at), maxLength);
}

/* ------------------------------ Cloudflare ------------------------------ */
function getHeader(headers, name) {
	if (!headers) return undefined;
	const lower = name.toLowerCase();
	for (const key of Object.keys(headers)) if (String(key).toLowerCase() === lower) return headers[key];
	return undefined;
}
function bodyToText(body, limit = 200 * 1024) {
	if (!body) return "";
	if (Buffer.isBuffer(body)) return body.toString("utf8", 0, Math.min(body.length, limit));
	if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, Math.min(body.byteLength, limit)).toString("utf8");
	if (body instanceof ArrayBuffer) return Buffer.from(body, 0, Math.min(body.byteLength, limit)).toString("utf8");
	return String(body).slice(0, limit);
}
/** 提取 16 位 CF Ray ID（仅日志/错误展示，不参与拦截判定）。 */
export function extractRayId(headers = {}, body = "") {
	const fromHeader = String(getHeader(headers, "cf-ray") || "").trim().split("-")[0].toLowerCase();
	if (/^[0-9a-f]{16}$/.test(fromHeader)) return fromHeader;
	const match = /ray\s*id[:\s]+([0-9a-f]{16})/i.exec(bodyToText(body)) || /cf-ray[:\s]+([0-9a-f]{16})/i.exec(bodyToText(body));
	return match ? match[1].toLowerCase() : "";
}
/**
 * 识别 Cloudflare 拦截/挑战。
 * - 200：仅 title 含 just a moment/attention required，或正文含
 *   you have been blocked/cf-error-details 才算（正常页面注入的
 *   challenge-platform 脚本、cf-ray、server: cloudflare 一律不算）；
 * - 403/503：CF 头（server/cf-ray/cf-mitigated）、CF 正文特征，或 text/html
 *   且不像正常文章页。
 */
export function detectCloudflare(input = {}) {
	const status = Number(input.status) || 0;
	const headers = input.headers || {};
	const title = String(input.title || "").toLowerCase();
	const contentType = String(getHeader(headers, "content-type") || "").toLowerCase();
	const server = String(getHeader(headers, "server") || "").toLowerCase();
	const mitigated = String(getHeader(headers, "cf-mitigated") || "").toLowerCase();
	const text = bodyToText(input.body).toLowerCase();
	const rayId = extractRayId(headers, input.body);

	const blockStatus = status === 403 || status === 503;
	const challengeTitle = /just a moment|attention required/.test(title);
	// 200（或挑战轮询 status=0）只认硬拦截特征
	const blocked200 = challengeTitle || CF_BODY_200.some((marker) => text.includes(marker));
	const cfHeader = server.includes("cloudflare") || Boolean(rayId) || mitigated === "challenge";
	const blockedStatus =
		blockStatus &&
		(CF_STRONG.some((marker) => text.includes(marker)) ||
			CF_BLOCK_ONLY.some((marker) => text.includes(marker)) ||
			cfHeader ||
			(contentType.includes("text/html") && text.length > 0 && !looksLikeArticle(text)));
	const blocked = blocked200 || blockedStatus;

	let mode = "none";
	if (blocked) {
		const combined = `${title} ${text}`;
		const hard = /attention required|you have been blocked|sorry, you have been blocked/.test(combined) || text.includes("cf-error-details");
		const challenge = /just a moment|checking your browser|enable javascript and cookies/.test(combined) || mitigated === "challenge";
		mode = hard ? "blocked" : challenge ? "challenge" : "blocked";
	}
	return { blocked, mode, rayId, status };
}
function looksLikeArticle(text) {
	return text.includes("progressbar") || text.includes("uk-article-title") || /<h1[\s>]/.test(text);
}
/** 统一「Cloudflare 拦截」错误文案（拿不到 Ray ID 时退回状态码）。 */
export function cloudflareStageText(info, status = 0) {
	if (!info?.blocked) return `HTTP ${Number(status) || 0}`;
	return info.rayId ? `Cloudflare 拦截 Ray ID ${info.rayId}` : `Cloudflare 拦截 HTTP ${Number(status) || info.status || 403}`;
}

/* ------------------------------ 错误脱敏 ------------------------------ */
const SENSITIVE = [
	[/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?(?:-----END[^-]*PRIVATE KEY-----|$)/gi, "[redacted-key]"],
	[/-----BEGIN CERTIFICATE-----[\s\S]*?(?:-----END CERTIFICATE-----|$)/gi, "[redacted-cert]"],
	[/(cf_clearance|cf_authorization|session|token|authorization)(\s*[=:]\s*)[^\s;,]+/gi, "$1$2[redacted]"],
	[/\b(cookie)\s*:\s*[^\r\n]+/gi, "Cookie: [redacted]"],
	[/\b(sign=)[^&\s"'#]+/gi, "$1[redacted]"],
	[/<html[\s\S]*/i, "[html]"],
];
function redact(text) {
	let value = String(text ?? "");
	for (const [pattern, replacement] of SENSITIVE) value = value.replace(pattern, replacement);
	return value.replace(/\s+/g, " ").trim();
}
/** 日志用异常文本：类型 + 清洗/截断后的 message（默认 120 字符）。 */
export function describeError(error, maxLength = 120) {
	if (!error) return "";
	const name = String(error.name || "Error");
	const message = redact(error.message || String(error));
	return truncate(message && message !== name ? `${name}: ${message}` : name, maxLength);
}
/** stage 错误用的简短中文原因。 */
export function summarizeError(error) {
	const code = String(error?.code || "");
	const message = String(error?.message || "");
	if (/timeout|超时|ETIMEDOUT|CONNECT_TIMEOUT/i.test(message) || code === "ETIMEDOUT") return "请求超时";
	if (code === "ECONNREFUSED") return "连接被拒绝";
	if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "域名解析失败";
	if (code === "ECONNRESET" || code === "EPIPE") return "连接被重置";
	if (/证书|certificate/i.test(message)) return "证书校验失败";
	return truncate(redact(message), 60) || "请求失败";
}

/* ------------------------------ Cookie 会话 ------------------------------ */
/** 解析 Set-Cookie（测试可直接调用）。 */
export function parseSetCookie(headerValue) {
	const text = String(headerValue ?? "").trim();
	if (!text) return null;
	const segments = text.split(";");
	const first = segments[0];
	const at = first.indexOf("=");
	if (at <= 0) return null;
	const name = first.slice(0, at).trim();
	if (!name) return null;
	const attrs = Object.create(null);
	for (const segment of segments.slice(1)) {
		const index = segment.indexOf("=");
		const key = (index < 0 ? segment : segment.slice(0, index)).trim().toLowerCase();
		if (key) attrs[key] = index < 0 ? "" : segment.slice(index + 1).trim();
	}
	const maxAge = attrs["max-age"] !== undefined ? Number.parseInt(attrs["max-age"], 10) : NaN;
	const expires = attrs.expires ? Date.parse(attrs.expires) : NaN;
	return { name, value: first.slice(at + 1).trim(), expired: (Number.isFinite(maxAge) && maxAge <= 0) || (Number.isFinite(expires) && expires <= Date.now()) };
}
/** 进程内 Cookie 会话（文章页 Set-Cookie → 网页接口 Cookie 头）。 */
export function createCookieJar() {
	const cookies = new Map();
	const add = (value) => {
		const parsed = parseSetCookie(value);
		if (!parsed) return false;
		if (parsed.expired) {
			cookies.delete(parsed.name);
			return false;
		}
		cookies.set(parsed.name, { name: parsed.name, value: parsed.value });
		return true;
	};
	return {
		updateFromHeaders(headers) {
			const value = getHeader(headers, "set-cookie");
			const values = Array.isArray(value) ? value : value ? [value] : [];
			let count = 0;
			for (const item of values) if (add(item)) count += 1;
			return count;
		},
		add,
		cookieHeader: () => [...cookies.values()].map((c) => `${c.name}=${c.value}`).join("; "),
		size: () => cookies.size,
		clear: () => cookies.clear(),
		toJSON: () => ({ count: cookies.size, names: [...cookies.keys()] }),
	};
}

/* ------------------------------ 客户端证书 ------------------------------ */
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/;
/** 校验 PEM 是否同时含证书与私钥。 */
export function isClientPemValid(pem) {
	const text = typeof pem === "string" ? pem : "";
	return text.includes("-----BEGIN CERTIFICATE-----") && PRIVATE_KEY_PATTERN.test(text);
}
/** 拆分「证书 + 私钥」合并 PEM；缺任一段返回 null。 */
export function splitClientPem(pem) {
	const text = typeof pem === "string" ? pem : "";
	const certStart = text.indexOf("-----BEGIN CERTIFICATE-----");
	const keyMatch = PRIVATE_KEY_PATTERN.exec(text);
	if (certStart < 0 || !keyMatch) return null;
	const keyStart = keyMatch.index;
	return keyStart > certStart
		? { cert: text.slice(certStart, keyStart).trim(), key: text.slice(keyStart).trim() }
		: { cert: text.slice(certStart).trim(), key: text.slice(keyStart, certStart).trim() };
}
/** 读取并校验证书文件；不打印内容，只返回状态。 */
export function loadClientPemFile(filePath) {
	let pem;
	try {
		pem = fs.readFileSync(filePath, "utf8");
	} catch {
		return { status: "missing", path: filePath };
	}
	if (!isClientPemValid(pem)) return { status: "invalid", path: filePath };
	const parts = splitClientPem(pem);
	return parts ? { status: "loaded", path: filePath, ...parts } : { status: "invalid", path: filePath };
}

/* ------------------------------ 限速 ------------------------------ */
/** 同一 key 最小间隔限速；reserve() 返回需要等待的毫秒数。 */
export function createRateLimiter(intervalMs = 3000) {
	const next = new Map();
	const interval = Math.max(0, Number(intervalMs) || 0);
	return {
		reserve(key, now = Date.now()) {
			const id = String(key);
			const previous = next.get(id);
			const wait = previous === undefined ? 0 : Math.max(0, previous - now);
			next.set(id, wait + now + interval);
			return wait;
		},
		size: () => next.size,
		clear: () => next.clear(),
	};
}
