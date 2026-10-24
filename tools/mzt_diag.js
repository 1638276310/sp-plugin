#!/usr/bin/env node
import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeApiPayload } from "../lib/mzt-crypto.js";
import { buildAppApiUrl, resolveCertCandidates } from "../lib/mzt-chain.js";
import {
	buildHeaders,
	describeError,
	extractRayId,
	loadClientPemFile,
	sanitizeUrl,
	summarizeError,
} from "../lib/mzt-net.js";
import {
	formatProxyForLog,
	httpGetBuffer,
	parseProxyUrl,
} from "../lib/mzt-http.js";

/**
 * 妹子图 APP 接口（mTLS + 内置解密）链路诊断（独立运行，不依赖 Bot 启动）。
 *
 * 用法：
 *   node plugins/sp-plugin/tools/mzt_diag.js --id 171317
 *   node plugins/sp-plugin/tools/mzt_diag.js --id 171317 --proxy http://127.0.0.1:7890 --json
 *
 * 只检查出口 IP / DNS / 包内证书 / APP 接口状态与解密张数 / 图片 CDN；
 * 插件运行时不再访问站点 HTML 页面，因此这里也不探测网页/浏览器链路。
 */

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_CERT_PATH = path.join(PLUGIN_ROOT, "config", "mzt_client.pem");
const DEFAULT_APP_API = "https://api.iimzt.com/app/";
const APP_UA = "MztApp For Android Version/3.8.7";
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_TIMEOUT = 15000;

/**
 * 解析命令行参数。
 * @param {string[]} argv 命令行参数（不含 node 与脚本路径）
 * @returns {{id: string, appApi: string, proxy: string, timeout: number, json: boolean}}
 */
function parseArgs(argv) {
	const args = {
		id: "171317",
		appApi: DEFAULT_APP_API,
		proxy: process.env.MZT_PROXY || "",
		timeout: DEFAULT_TIMEOUT,
		json: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const key = argv[index];
		const next = () => {
			index += 1;
			return argv[index] ?? "";
		};
		switch (key) {
			case "--id":
				args.id = next() || args.id;
				break;
			case "--app-api":
				args.appApi = next();
				break;
			case "--proxy":
				args.proxy = next();
				break;
			case "--timeout": {
				const value = Number(next());
				if (Number.isFinite(value) && value > 0) args.timeout = value * 1000;
				break;
			}
			case "--json":
				args.json = true;
				break;
			case "--help":
			case "-h":
				console.log(
					"node tools/mzt_diag.js --id 171317 [--app-api URL] [--proxy URL] [--timeout 秒] [--json]",
				);
				process.exit(0);
				break;
			default:
				break;
		}
	}
	return args;
}

/** 日志用代理地址（隐藏账号密码）。 */
function maskProxy(raw) {
	const parsed = parseProxyUrl(raw);
	if (!parsed.configured) return "";
	return parsed.ok ? formatProxyForLog(parsed.proxy) : `<invalid:${parsed.reason}>`;
}

/** 去掉内部字段，只输出可序列化结果。 */
function shown(result) {
	const copy = {};
	for (const [key, value] of Object.entries(result)) {
		if (!key.startsWith("_")) copy[key] = value;
	}
	return copy;
}

/**
 * 发一个 GET 请求并返回脱敏后的结果；失败不抛异常。
 * @param {string} url 请求地址
 * @param {{headers?: object, proxy?: object|null, cert?: string, key?: string, timeout?: number}} options
 * @returns {Promise<object>}
 */
async function probe(url, options = {}) {
	const started = Date.now();
	try {
		const response = await httpGetBuffer(url, {
			headers: options.headers || {},
			proxy: options.proxy || null,
			cert: options.cert,
			key: options.key,
			timeout: options.timeout || DEFAULT_TIMEOUT,
			maxRedirects: 3,
		});
		return {
			url: sanitizeUrl(url),
			status: response.statusCode,
			ok: response.statusCode >= 200 && response.statusCode < 300,
			cf_ray: extractRayId(response.headers, response.body),
			elapsed_ms: Date.now() - started,
			bytes: response.body.length,
			error: "",
			_body: response.body,
			_headers: response.headers,
		};
	} catch (error) {
		return {
			url: sanitizeUrl(url),
			status: 0,
			ok: false,
			cf_ray: "",
			elapsed_ms: Date.now() - started,
			bytes: 0,
			error: describeError(error, 160),
			_body: Buffer.alloc(0),
			_headers: {},
		};
	}
}

/** 检查包内证书（只接受插件目录相对路径；不打印证书内容）。 */
function checkCertificates() {
	const { candidates, rejected } = resolveCertCandidates({
		configured: "",
		pluginRoot: PLUGIN_ROOT,
		defaultCertPath: DEFAULT_CERT_PATH,
	});
	const rows = candidates.map((candidate) => {
		const loaded = loadClientPemFile(candidate);
		return {
			path: path.relative(PLUGIN_ROOT, candidate).split(path.sep).join("/"),
			status: loaded.status,
		};
	});
	const selected = rows.find((row) => row.status === "loaded") || null;
	return { candidates: rows, selected, ok: Boolean(selected), rejected };
}

/** DNS 解析。 */
async function checkDns(hosts) {
	const result = {};
	for (const host of hosts.filter(Boolean)) {
		try {
			const addresses = await dns.lookup(host, { all: true });
			result[host] = {
				ok: true,
				addresses: [...new Set(addresses.map((item) => item.address))].slice(0, 6),
			};
		} catch (error) {
			result[host] = { ok: false, error: describeError(error, 120) };
		}
	}
	return result;
}

/** 出口 IP / Cloudflare 节点 / 时钟偏差。 */
async function checkEgress(proxy) {
	const trace = await probe("https://www.cloudflare.com/cdn-cgi/trace", {
		headers: { "User-Agent": UA },
		proxy,
	});
	const data = {
		trace: shown(trace),
		ip: "",
		loc: "",
		colo: "",
		warp: "",
		server_time_skew_seconds: null,
	};
	for (const line of trace._body.toString("utf8").split("\n")) {
		const [key, value = ""] = line.split("=");
		if (["ip", "loc", "colo", "warp"].includes(key)) data[key] = value.trim();
	}
	const dateHeader = String(trace._headers?.date || "");
	if (dateHeader) {
		const serverTime = Date.parse(dateHeader);
		if (Number.isFinite(serverTime)) {
			data.server_time_skew_seconds = Math.round((serverTime - Date.now()) / 100) / 10;
		}
	}
	return data;
}

/** APP 接口状态 + 内置解密张数 + 首图 CDN 探测。 */
async function checkAppApi(appApi, articleId, proxy, certificates, timeout) {
	if (!appApi) return { skipped: true, reason: "app_api 为空" };
	if (!certificates.ok) return { skipped: true, reason: "客户端证书不可用" };
	const certificate = loadClientPemFile(path.join(PLUGIN_ROOT, certificates.selected.path));
	const apiUrl = buildAppApiUrl(appApi, articleId);
	if (!apiUrl) return { skipped: true, reason: "app_api 不是合法 http(s) 地址" };

	const response = await probe(apiUrl, {
		headers: buildHeaders("app", { ua: APP_UA }),
		proxy,
		cert: certificate.cert,
		key: certificate.key,
		timeout,
	});
	const result = { ...shown(response), decode: {} };
	if (!response.ok) return result;
	try {
		const payload = JSON.parse(response._body.toString("utf8"));
		const decoded = decodeApiPayload(payload.data, articleId);
		const images = (decoded.images || []).filter(Boolean);
		result.decode = {
			scheme: decoded.scheme,
			images: images.length,
			count: Number(decoded.count) || 0,
			thumbs: Boolean(decoded.thumbs),
		};
		const firstImage = images[0];
		if (firstImage) {
			const referer = decoded.thumbs ? "https://weibo.com/" : "";
			const imageHeaders = buildHeaders("image", { referer: referer || undefined });
			result.image_cdn = {
				...shown(await probe(firstImage, { headers: imageHeaders, proxy, timeout })),
				referer: referer || "无",
			};
		} else {
			result.image_cdn = { skipped: true, reason: "没有可用图片 URL" };
		}
	} catch (error) {
		result.decode = { decode_error: summarizeError(error) };
	}
	return result;
}

/** 一句话判断。 */
function likelyCause(report) {
	const app = report.app_api || {};
	const status = Number(app.status) || 0;
	const images = Number(app.decode?.images) || 0;
	if (status === 200 && images > 0) return "APP 接口（mTLS）+ 内置解密链路正常";
	if (app.skipped) return `APP 接口未探测：${app.reason}`;
	if (status === 403 || status === 503 || app.cf_ray) {
		return "APP 接口被 Cloudflare 拦截：确认 mTLS 证书有效，必要时用 mzt_proxy 更换出口";
	}
	return "APP 接口异常，请结合 status/error 判断";
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const proxyParsed = parseProxyUrl(args.proxy);
	const proxy = proxyParsed.ok ? proxyParsed.proxy : null;
	const certificates = checkCertificates();
	const appHost = (() => {
		try {
			return new URL(args.appApi).hostname;
		} catch {
			return "";
		}
	})();
	const report = {
		generated_at: new Date().toISOString(),
		target: {
			id: String(args.id),
			app_api: args.appApi,
			proxy: maskProxy(args.proxy),
			proxy_enabled: Boolean(proxy),
		},
		environment: {
			node: process.version,
			platform: process.platform,
			plugin_root: PLUGIN_ROOT,
			clock: {
				iso: new Date().toISOString(),
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			},
		},
		dns: await checkDns([appHost, "ap.iimzt.com", "ax.iimzt.com"]),
		egress: await checkEgress(proxy),
		certificates,
	};
	report.app_api = await checkAppApi(
		args.appApi,
		String(args.id),
		proxy,
		certificates,
		args.timeout,
	);
	report.summary = {
		egress_ip: report.egress.ip || "",
		app_api_status: report.app_api.status ?? "skipped",
		decrypt_images: report.app_api.decode?.images ?? null,
		cert_ok: certificates.ok,
	};
	report.summary.likely_cause = likelyCause(report);
	console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
	console.error(`诊断脚本内部错误（${error?.name || "Error"}）：${summarizeError(error)}`);
	process.exitCode = 2;
});
