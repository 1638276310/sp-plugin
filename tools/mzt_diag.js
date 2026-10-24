#!/usr/bin/env node
/**
 * 妹子图链路诊断（独立运行，不依赖 Yunzai 启动）：
 *   node tools/mzt_diag.js --id 171317 [--site https://kkmzt.com]
 *                          [--proxy http://127.0.0.1:7890] [--json]
 *
 * 输出脱敏 JSON：代理环境变量、出口 IP、DNS、时间、mTLS 证书状态、
 * 文章页/网页接口/APP 接口/图片 HEAD 状态与 cf-ray、puppeteer 可用性。
 * 不打印 Cookie / 证书内容 / HTML 正文。
 */
import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildHeaders, createCookieJar, describeError, detectCloudflare, extractRayId, loadClientPemFile, sanitizeUrl, summarizeError } from "../lib/mzt-net.js";
import { httpGetBuffer, parseProxyUrl } from "../lib/mzt-http.js";
import { decodeApiPayload } from "../lib/mzt-crypto.js";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CERT_PATH = path.join(ROOT, "config", "mzt_client.pem");
const APP_API = "https://api.iimzt.com/app";
const APP_UA = "MztApp For Android Version/3.8.7";

function parseArgs(argv) {
	const args = { id: "171317", site: "https://kkmzt.com", proxy: "", json: false };
	for (let i = 0; i < argv.length; i += 1) {
		const key = argv[i];
		const next = () => argv[++i] || "";
		if (key === "--id") args.id = next() || args.id;
		else if (key === "--site") args.site = next() || args.site;
		else if (key === "--proxy") args.proxy = next();
		else if (key === "--json") args.json = true;
	}
	return { ...args, site: args.site.replace(/\/+$/, "") };
}

function sanitizeProxyEnv(value) {
	if (!value) return "";
	try {
		const parsed = new URL(value.includes("://") ? value : `http://${value}`);
		return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.username || parsed.password ? " (auth)" : ""}`;
	} catch {
		return "[invalid]";
	}
}

async function get(url, options = {}) {
	const started = Date.now();
	try {
		const response = await httpGetBuffer(url, {
			headers: options.headers || {},
			key: options.key,
			cert: options.cert,
			method: options.method || "GET",
			timeout: options.timeout || 20000,
			maxRedirects: 2,
			proxy: options.proxy,
			cookieJar: options.cookieJar,
		});
		const cf = detectCloudflare({ status: response.statusCode, headers: response.headers, body: response.body });
		return {
			ok: response.statusCode >= 200 && response.statusCode < 400,
			status: response.statusCode,
			cf_ray: cf.rayId || extractRayId(response.headers, response.body) || null,
			blocked: cf.blocked,
			content_type: String(response.headers["content-type"] || ""),
			bytes: response.body.length,
			elapsed_ms: Date.now() - started,
			body: response.body,
			headers: response.headers,
		};
	} catch (error) {
		return { ok: false, status: 0, error: describeError(error, 120), elapsed_ms: Date.now() - started };
	}
}

/** 去掉响应体/响应头，避免 JSON 里带 HTML 或敏感头。 */
function strip({ body, headers, ...rest } = {}) {
	return { ...rest };
}

function decode(record, articleId) {
	if (!record?.body) return { error: "no body" };
	try {
		const payload = JSON.parse(record.body.toString("utf8"));
		if (!payload?.data) return { error: "missing data" };
		const decoded = decodeApiPayload(payload.data, articleId);
		return { scheme: decoded.scheme, images: (decoded.images || []).filter(Boolean).length, count: Number(decoded.count) || 0 };
	} catch (error) {
		return { error: describeError(error, 100) };
	}
}

/** 从接口响应中取第一张图的完整 URL（网页端用文章页首图目录拼）。 */
function firstImageUrl(record, articleId, articleFirstImage = "") {
	try {
		const decoded = decodeApiPayload(JSON.parse(record.body.toString("utf8")).data, articleId);
		const first = (decoded.images || []).filter(Boolean)[0] || "";
		if (!first) return "";
		if (decoded.scheme === "app" || /^https?:\/\//i.test(first)) return first;
		return articleFirstImage ? articleFirstImage.replace(/[^/]+$/, "") + first : "";
	} catch {
		return "";
	}
}

function articleInfo(record) {
	if (!record?.body) return { parse_error: "no body" };
	const html = record.body.toString("utf8");
	const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || "";
	const image = /<figure[^>]*>[\s\S]*?<img[^>]*\bsrc="([^"]+)"/i.exec(html)?.[1] || "";
	return { title: title.slice(0, 80), has_progress: /id="progressBar"/i.test(html), first_image: sanitizeUrl(image) || null };
}

async function resolveHost(host) {
	const result = { host };
	try { result.ipv4 = await dns.resolve4(host); } catch (error) { result.ipv4 = []; result.ipv4_error = summarizeError(error); }
	try { result.ipv6 = await dns.resolve6(host); } catch { result.ipv6 = []; }
	return result;
}

async function checkPuppeteer(proxy) {
	const started = Date.now();
	let puppeteer;
	try { puppeteer = (await import("puppeteer")).default; } catch (error) { return { importable: false, launch_ok: false, error: describeError(error, 120), elapsed_ms: Date.now() - started }; }
	const args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"];
	if (proxy?.ok && proxy.proxy) args.push(`--proxy-server=${proxy.proxy.protocol}://${proxy.proxy.host}:${proxy.proxy.port}`);
	try {
		const browser = await puppeteer.launch({ headless: true, args, timeout: 20000 });
		const version = await browser.version();
		await browser.close();
		return { importable: true, launch_ok: true, version, elapsed_ms: Date.now() - started };
	} catch (error) {
		return { importable: true, launch_ok: false, error: describeError(error, 120), elapsed_ms: Date.now() - started };
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const proxy = args.proxy ? parseProxyUrl(args.proxy) : { configured: false, ok: true, proxy: null };
	const articleUrl = `${args.site}/photo/${encodeURIComponent(args.id)}`;
	const webApiUrl = `${args.site}/app/post/p?id=${encodeURIComponent(args.id)}`;
	const appApiUrl = `${APP_API}/post/p?id=${encodeURIComponent(args.id)}`;

	const report = {
		ts: new Date().toISOString(),
		node: process.version,
		platform: `${process.platform}/${process.arch}`,
		article_id: String(args.id),
		site: args.site,
		env_proxy: {
			HTTP_PROXY: sanitizeProxyEnv(process.env.HTTP_PROXY || process.env.http_proxy),
			HTTPS_PROXY: sanitizeProxyEnv(process.env.HTTPS_PROXY || process.env.https_proxy),
			ALL_PROXY: sanitizeProxyEnv(process.env.ALL_PROXY || process.env.all_proxy),
			NO_PROXY: String(process.env.NO_PROXY || process.env.no_proxy || "").slice(0, 200),
		},
		proxy: proxy.configured
			? { ok: proxy.ok, reason: proxy.reason, protocol: proxy.proxy?.protocol, host: proxy.proxy?.host, port: proxy.proxy?.port, auth: Boolean(proxy.proxy?.hasAuth) }
			: { configured: false },
		time: { local: new Date().toString(), utc: new Date().toUTCString() },
		dns: {},
		cert: { path: "config/mzt_client.pem" },
		egress: {},
		checks: {},
		puppeteer: {},
		hints: [],
	};
	const cert = loadClientPemFile(CERT_PATH);
	report.cert = { path: "config/mzt_client.pem", status: cert.status, valid: cert.status === "loaded" };

	const [kkmztDns, apiDns] = await Promise.all([resolveHost("kkmzt.com"), resolveHost("api.iimzt.com")]);
	report.dns = { "kkmzt.com": kkmztDns, "api.iimzt.com": apiDns };
	if (proxy.proxy?.host) report.dns.proxy = await resolveHost(proxy.proxy.host);

	// 出口 IP
	const trace = await get("https://www.cloudflare.com/cdn-cgi/trace", { proxy });
	if (trace.body) {
		const fields = Object.fromEntries(
			trace.body.toString("utf8").split(/\r?\n/).filter((line) => line.includes("=")).map((line) => line.split("=", 2)),
		);
		report.egress.cloudflare_trace = { status: trace.status, ip: fields.ip || null, loc: fields.loc || null, colo: fields.colo || null, warp: fields.warp || null, cf_ray: trace.cf_ray };
	} else {
		report.egress.cloudflare_trace = strip(trace);
	}
	const ipify = await get("https://api.ipify.org?format=json", { proxy });
	let ipifyIp = null;
	try {
		ipifyIp = JSON.parse(ipify.body.toString("utf8")).ip || null;
	} catch {
		ipifyIp = null;
	}
	report.egress.ipify = { status: ipify.status, ip: ipifyIp, error: ipify.error || null };

	// 文章页（Cookie 会话）
	const cookieJar = createCookieJar();
	const article = await get(articleUrl, {
		proxy,
		cookieJar,
		headers: buildHeaders("article", { referer: `${args.site}/` }),
	});
	const articleMeta = article.body ? articleInfo(article) : { parse_error: "no body" };
	report.checks.article = { url: sanitizeUrl(articleUrl), ...strip(article), ...articleMeta };

	// 网页接口（复用文章页 Cookie）
	const webApi = await get(webApiUrl, {
		proxy,
		cookieJar,
		headers: buildHeaders("api", { referer: articleUrl, cookie: cookieJar.cookieHeader() }),
	});
	report.checks.web_api = { url: sanitizeUrl(webApiUrl), ...strip(webApi), decoded: decode(webApi, args.id) };

	// APP 接口（mTLS）
	const appApi = cert.status === "loaded"
		? await get(appApiUrl, { proxy, headers: buildHeaders("app", { ua: APP_UA }), key: cert.key, cert: cert.cert })
		: { ok: false, status: 0, error: "cert-invalid" };
	report.checks.app_api = { url: sanitizeUrl(appApiUrl), mtls: cert.status, ...strip(appApi), decoded: decode(appApi, args.id) };

	// 图片 HEAD：优先 APP 首图，其次网页接口首图
	const imageUrl =
		(report.checks.app_api.decoded?.scheme === "app" && appApi.body && firstImageUrl(appApi, args.id)) ||
		(report.checks.web_api.decoded?.scheme === "web" && webApi.body && firstImageUrl(webApi, args.id, articleMeta.first_image || "")) ||
		"";
	if (imageUrl) {
		const isAppImage = report.checks.app_api.decoded?.scheme === "app";
		const image = await get(imageUrl, {
			proxy,
			method: "HEAD",
			headers: buildHeaders("image", { referer: isAppImage ? "" : args.site }),
		});
		report.checks.image_head = { url: sanitizeUrl(imageUrl), ...strip(image) };
	} else {
		report.checks.image_head = { skipped: "no image url decoded" };
	}

	// puppeteer 是否可 import / 能否启动
	report.puppeteer = await checkPuppeteer(proxy);

	// 提示
	if (!report.checks.article.ok) report.hints.push("文章页不可达（看 status/cf_ray/error）");
	if (report.checks.article.blocked) report.hints.push("文章页被 Cloudflare 拦截：部署机 IP 可能被风控，配置 mzt_proxy");
	if (cert.status !== "loaded") report.hints.push("APP mTLS 证书缺失/无效（config/mzt_client.pem 需同时含证书与私钥）");
	else if (!report.checks.app_api.ok) report.hints.push("APP 接口失败（mTLS 已加载，看 status/cf_ray）");
	if (!report.puppeteer.importable) report.hints.push("puppeteer 未安装：浏览器兜底不可用");
	else if (!report.puppeteer.launch_ok) report.hints.push("puppeteer 可 import 但无法启动（检查 Chromium/依赖）");
	if (proxy.configured && !proxy.ok) report.hints.push("--proxy 不可用（仅支持 http/https）");
	process.stdout.write(`${JSON.stringify(report, null, args.json ? 0 : 2)}\n`);
}
main().catch((error) => {
	process.stderr.write(`${JSON.stringify({ error: describeError(error, 200) })}\n`);
	process.exitCode = 1;
});
