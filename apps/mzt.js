import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";

import {
	decodeApiPayload,
	hdBeautyImageUrl,
	hdImageUrl,
} from "../lib/mzt-crypto.js";
import {
	ACCEPT_LANGUAGE,
	API_ACCEPT,
	buildHeaders,
	clampStageText,
	cloudflareStageText,
	createCookieJar,
	createRateLimiter,
	delay,
	describeError,
	detectCloudflare,
	extractRayId,
	loadClientPemFile,
	resolveUserAgent,
	sanitizeUrl,
	summarizeError,
} from "../lib/mzt-net.js";
import {
	formatProxyForLog,
	httpGetBuffer,
	parseProxyUrl,
} from "../lib/mzt-http.js";

/* ------------------------------------------------------------------ *
 * 配置区（对应 AstrBot 版 _conf_schema.json 里的 mzt_* 配置项）
 *
 * 说明：TRSS-Yunzai 侧暂时不读插件配置文件，保持原插件"常量即配置"的风格；
 * 需要临时改行为时直接改这里的值即可（语义与 AstrBot 完全一致）。
 * ------------------------------------------------------------------ */

/**
 * 妹子图相关配置
 * @type {{mzt_site: string, mzt_app_api: string, mzt_hd: boolean,
 *         mzt_max_images: number, mzt_browser_fallback: boolean,
 *         mzt_proxy: string, mzt_ua: string, mzt_cf_wait: number,
 *         mzt_app_cert: string}}
 */
const MZT_CONFIG = {
	/** 站点根地址（文章页 / 网页接口都基于它；末尾不带斜杠） */
	mzt_site: "https://kkmzt.com",
	/** 美之图 APP 接口根地址（去掉尾斜杠后拼 /post/p?id=<ID>；需要 mTLS 客户端证书） */
	mzt_app_api: "https://api.iimzt.com/app/",
	/** 是否请求 APP 端高清图：写真馆 ap→ax 重新签名，潮拍馆 mw1024→mw2000 */
	mzt_hd: false,
	/** 最多发送多少张；0 表示不限制（对应 AstrBot 的 mzt_max_images） */
	mzt_max_images: 0,
	/** 两套直连接口都失败时，是否用 puppeteer 在页面内解密兜底 */
	mzt_browser_fallback: true,
	/**
	 * 直连与浏览器统一代理，例如 `http://127.0.0.1:7890`；空=直连。
	 * socks 不支持（记录警告后降级直连）。临时改：直接改这里的值。
	 */
	mzt_proxy: "",
	/** 覆盖统一浏览器 UA；空=内置 Chrome/124。禁止 Firefox/Safari UA 配 Chromium。 */
	mzt_ua: "",
	/** 浏览器打开文章页后等待 Cloudflare 挑战通过的最长秒数（0=不等待） */
	mzt_cf_wait: 8,
	/** APP 接口 mTLS 证书路径；空=config/mzt_client.pem（相对路径按插件根目录解析） */
	mzt_app_cert: "",
};

/**
 * 官方 APP 的 User-Agent（逆向自 APP 内 res/ua.txt；api.iimzt.com 会校验，
 * 用普通浏览器 UA 会直接被 Cloudflare 拦掉）
 */
const APP_UA = "MztApp For Android Version/3.8.7";

/** 每批合并转发的节点数（文本头算第一个节点） */
const BATCH_SIZE = 20;
/** 图片下载并发数 */
const DOWNLOAD_CONCURRENCY = 5;
/** 单张图片下载超时（毫秒）—— 对齐 AstrBot 配置项 download_timeout 的默认值 20 秒 */
const DOWNLOAD_TIMEOUT = 20000;
/** 发送前图片长边上限（像素）—— 对应 AstrBot imaging.shrink_for_send */
const MAX_SEND_SIDE = 1280;
/** 发送前重新压缩使用的 JPEG 质量 */
const SEND_JPEG_QUALITY = 80;
/**
 * 文章页 / 图片接口的请求超时（毫秒）—— 对齐 AstrBot fetch_album 的默认
 * timeout=60 秒（网页被 Cloudflare 拦时慢一点也能等到响应，再交给兜底）。
 */
const HTTP_TIMEOUT = 60000;
/** 浏览器页面内解密的兜底超时（毫秒）：避免页面内 fetch 卡死导致指令永久挂起 */
const BROWSER_DECRYPT_TIMEOUT = 60000;
/** 最多跟随的重定向次数（APP 接口/图片 CDN 可能 301 到真实节点） */
const MAX_REDIRECTS = 3;

/** 图集类型 → 中文栏目名 */
const KIND_LABEL = { photo: "写真馆", beauty: "潮拍馆" };
/** 默认栏目：不写栏目时按写真馆处理 */
const DEFAULT_KIND = "photo";

/** 数据源 → 消息头里的中文标签（与 AstrBot AlbumInfo.source_label 一致） */
const SOURCE_LABEL = {
	app: "美之图 APP 接口（全量）",
	web: "网页接口",
	browser: "网页（浏览器兜底）",
	page: "网页首图（兜底）",
};

/** 当前文件所在目录（ESM 没有 __dirname，用 import.meta.url 还原） */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(MODULE_DIR, "..");
/** 默认 mTLS 证书路径（注意不能用 process.cwd()：Bot 根目录不是插件目录） */
const DEFAULT_CLIENT_CERT_PATH = path.join(PLUGIN_ROOT, "config", "mzt_client.pem");

/** 浏览器兜底：打开文章页 / 启动浏览器超时（毫秒） */
const BROWSER_GOTO_TIMEOUT = 60000;
const BROWSER_LAUNCH_TIMEOUT = 30000;
/** 浏览器兜底：Cloudflare 挑战轮询间隔（毫秒） */
const CF_POLL_INTERVAL = 1000;
/** 浏览器启动参数：与真实桌面 Chrome 对齐并关闭自动化特征；代理参数动态追加 */
const BROWSER_LAUNCH_ARGS = [
	"--no-sandbox",
	"--disable-setuid-sandbox",
	"--disable-dev-shm-usage",
	"--disable-gpu",
	"--disable-blink-features=AutomationControlled",
	"--ignore-certificate-errors",
	"--no-first-run",
	"--no-default-browser-check",
	"--lang=zh-CN",
	"--window-size=1920,1080",
];

/** 统一浏览器 UA：mzt_ua 覆盖，否则内置 Chrome/124（不再随机混用 Firefox/Safari）。 */
function browserUserAgent() {
	return resolveUserAgent(MZT_CONFIG.mzt_ua);
}

/**
 * 给 Promise 加一个总超时：超时后 reject，并清理定时器。
 *
 * 用于 ``page.evaluate`` —— puppeteer 的页面内执行没有 deadline，如果页面里的
 * fetch 一直不返回，整个指令会永久挂起且浏览器来不及关闭。``timer.unref()``
 * 保证已完成的请求不会因为兜底定时器而拖住 Node 的事件循环。
 *
 * @template T
 * @param {Promise<T>} promise 原始 Promise
 * @param {number} timeoutMs 超时毫秒数
 * @param {string} message 超时错误信息
 * @returns {Promise<T>}
 */
function withTimeout(promise, timeoutMs, message) {
	let timer = null;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), timeoutMs);
		if (typeof timer.unref === "function") timer.unref();
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

/** mTLS 证书缓存：只读一次文件（进程内复用，避免每次请求都读盘） */
let clientCertificateState = null;

/** 日志用证书路径：插件内显示相对路径，插件外只显示文件名（绝不打印内容）。 */
function displayCertPath(filePath) {
	const relative = path.relative(PLUGIN_ROOT, filePath);
	return relative && !relative.startsWith("..") ? relative.split(path.sep).join("/") : path.basename(filePath);
}

/** 证书候选路径：mzt_app_cert（可选）优先，其次 config/mzt_client.pem。 */
function resolveCertCandidates() {
	const configured = String(MZT_CONFIG.mzt_app_cert || "").trim();
	const candidates = configured
		? [path.isAbsolute(configured) ? configured : path.resolve(PLUGIN_ROOT, configured)]
		: [];
	candidates.push(DEFAULT_CLIENT_CERT_PATH);
	return [...new Set(candidates)];
}

/**
 * 读取 APP mTLS 客户端证书（加载前校验 PEM 同时含证书与私钥，否则 cert-invalid）。
 * @returns {{status: "loaded"|"missing"|"invalid", path: string, cert?: string, key?: string}}
 */
function loadClientCertificate() {
	if (clientCertificateState) return clientCertificateState;
	let fallback = { status: "missing", path: DEFAULT_CLIENT_CERT_PATH };
	for (const candidate of resolveCertCandidates()) {
		const loaded = loadClientPemFile(candidate);
		if (loaded.status === "loaded") {
			clientCertificateState = loaded;
			logger.info(`[mzt] stage=cert path=${displayCertPath(candidate)} status=loaded`);
			return clientCertificateState;
		}
		if (loaded.status === "invalid") fallback = loaded;
	}
	clientCertificateState = fallback;
	logger.warn(`[mzt] stage=cert path=${displayCertPath(fallback.path)} status=${fallback.status}（APP 接口跳过）`);
	return clientCertificateState;
}

/**
 * 解码 HTML 实体（对应 Python html.unescape 的常用场景）。
 *
 * 文章标题/时间是从 HTML 里抠出来的文本，站点偶尔会做实体转义（&amp; 等），
 * 不解码会直接把 `&amp;` 原样发到群里。
 *
 * @param {string} text 原始文本
 * @returns {string} 解码后的文本
 */
function decodeHtmlEntities(text) {
	// 常用命名实体（Python 用 html.unescape 支持全表；这里覆盖标题/时间里
	// 实际会出现的常见符号，未知实体按原样保留，不会误伤）。
	// 用 null 原型对象避免 "constructor" 之类的实体名命中原型链属性。
	const named = Object.assign(Object.create(null), {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: "\u00a0",
		hellip: "…",
		mdash: "—",
		ndash: "–",
		lsquo: "‘",
		rsquo: "’",
		ldquo: "“",
		rdquo: "”",
		sbquo: "‚",
		bdquo: "„",
		middot: "·",
		bull: "•",
		times: "×",
		divide: "÷",
		laquo: "«",
		raquo: "»",
		copy: "©",
		reg: "®",
		trade: "™",
		deg: "°",
		plusmn: "±",
		emsp: "\u2003",
		ensp: "\u2002",
		thinsp: "\u2009",
		permil: "‰",
		euro: "€",
		pound: "£",
		yen: "¥",
		cent: "¢",
		sect: "§",
		para: "¶",
		dagger: "†",
		prime: "′",
		Prime: "″",
		larr: "←",
		rarr: "→",
		uarr: "↑",
		darr: "↓",
		harr: "↔",
		le: "≤",
		ge: "≥",
		ne: "≠",
		asymp: "≈",
		infin: "∞",
		radic: "√",
		hearts: "♥",
		star: "☆",
		starf: "★",
		check: "✓",
	});
	return String(text ?? "").replace(
		/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
		(match, entity) => {
			if (entity[0] === "#") {
				const isHex = entity[1] === "x" || entity[1] === "X";
				const code = Number.parseInt(
					isHex ? entity.slice(2) : entity.slice(1),
					isHex ? 16 : 10,
				);
				if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) {
					try {
						return String.fromCodePoint(code);
					} catch {
						return match;
					}
				}
				return match;
			}
			// 先按原大小写查（Prime / prime 结果不同），再回退小写；
			// 未知实体原样保留，避免把普通文本搞坏。
			const value = named[entity] ?? named[entity.toLowerCase()];
			return value === undefined ? match : value;
		},
	);
}

/**
 * 去掉 HTML 标签（对应 Python 版 re.sub(r"<[^>]+>", "", ...)）
 * @param {string} text 原始 HTML 片段
 * @returns {string}
 */
function stripTags(text) {
	return String(text ?? "").replace(/<[^>]+>/g, "");
}

/**
 * 用正则取第一个分组并 trim（对应 AstrBot app_core/mzt.py 的 _first_match）
 * @param {RegExp} pattern 正则
 * @param {string} text 被搜索文本
 * @returns {string}
 */
function firstMatch(pattern, text) {
	const match = pattern.exec(text);
	return match ? String(match[1] || "").trim() : "";
}

/**
 * 取图片 URL 所在的目录前缀（用于网页接口把"文件名"拼成完整 URL）。
 *
 * 例如 `https://f.meizitu.net/2026/04/01a01abc.jpg` → `https://f.meizitu.net/2026/04/`
 *
 * @param {string} imageUrl 文章页的第一张图
 * @returns {string} 目录前缀（含末尾斜杠）；无法解析时返回空串
 */
function dirPrefix(imageUrl) {
	const url = String(imageUrl ?? "").trim();
	if (!url) return "";
	const slashIndex = url.lastIndexOf("/");
	if (slashIndex < 0) return "";
	return url.slice(0, slashIndex + 1);
}

/**
 * 拼出文章页 URL
 * @param {string|number} articleId 文章 ID
 * @param {string} kind 栏目（photo/beauty）
 * @returns {string}
 */
function albumUrl(articleId, kind) {
	const kindPath = String(kind).toLowerCase() === "beauty" ? "beauty" : "photo";
	return `${MZT_CONFIG.mzt_site.replace(/\/+$/, "")}/${kindPath}/${articleId}`;
}

/**
 * 按 mzt_max_images 截断图片列表（0 表示不限制）。
 * @param {string[]} imageUrls 完整图片 URL 列表
 * @returns {string[]}
 */
function applyImageLimit(imageUrls) {
	const limit = Number(MZT_CONFIG.mzt_max_images) || 0;
	if (limit > 0) return imageUrls.slice(0, limit);
	return imageUrls;
}

/**
 * 从用户消息中解析出文章 ID 与栏目。
 *
 * 支持（与 AstrBot parse_article_ref 一致）：
 * * 完整链接：`https://kkmzt.com/photo/171317`、`.../beauty/191566`
 * * 指令 + ID：`#写真馆 171317`、`#潮拍馆191566`
 * * 裸 ID（2-12 位数字，默认按写真馆处理）
 *
 * @param {string} text 用户消息文本
 * @returns {{articleId: string, kind: "photo"|"beauty"}|null}
 */
function parseArticleRef(text) {
	const raw = String(text ?? "").trim();
	if (!raw) return null;

	// 1) 链接优先：/photo/<id> 或 /beauty/<id>
	let match = /(photo|beauty)\/(\d+)/i.exec(raw);
	if (match) {
		return {
			articleId: match[2],
			kind: match[1].toLowerCase() === "beauty" ? "beauty" : "photo",
		};
	}

	// 2) 指令 + 数字：写真馆/潮拍馆 决定栏目
	match = /写真馆\s*(\d{1,12})/.exec(raw);
	if (match) return { articleId: match[1], kind: "photo" };
	match = /潮拍馆\s*(\d{1,12})/.exec(raw);
	if (match) return { articleId: match[1], kind: "beauty" };

	// 3) 裸 ID：默认写真馆（负数/带斜杠的数字不算，避免误吞其它指令）
	match = /(?<![\d/])(\d{2,12})(?![\d/])/.exec(raw);
	if (match) return { articleId: match[1], kind: DEFAULT_KIND };

	return null;
}

/**
 * 解析文章页 HTML，提取标题/发布时间/首图目录/总张数/真实栏目。
 *
 * 对应 AstrBot app_core/mzt.py 的 _parse_article_html；解析失败不致命，
 * 调用方会用"未知标题/未知时间"兜底。
 *
 * @param {string} html 文章页 HTML
 * @param {string} fallbackKind 请求时使用的栏目（用于页面判断不出来的情况）
 * @returns {{title: string, publishTime: string, firstImage: string,
 *            referrerPolicy: string, total: number, kind: "photo"|"beauty"}}
 */
function parseArticleHtml(html, fallbackKind) {
	const page = String(html ?? "");

	// 标题：<h1 ...>...</h1>
	const title = decodeHtmlEntities(
		stripTags(firstMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/i, page)),
	).trim();

	// 发布时间：<time ...>...</time>
	const publishTime = decodeHtmlEntities(
		stripTags(firstMatch(/<time[^>]*>([\s\S]*?)<\/time>/i, page)),
	).trim();

	// 首图 + referrerpolicy：<figure ...><img width height referrerpolicy=... src=...>
	let firstImage = "";
	let referrerPolicy = "origin";
	const figureMatch = /<figure[^>]*>([\s\S]*?)<\/figure>/i.exec(page);
	const figureHtml = figureMatch ? figureMatch[1] : page;
	const imgMatch = /<img[^>]*>/i.exec(figureHtml);
	if (imgMatch) {
		const imgTag = imgMatch[0];
		const srcMatch = /\bsrc="([^"]+)"/i.exec(imgTag);
		const refMatch = /\breferrerpolicy="([^"]+)"/i.exec(imgTag);
		if (srcMatch) firstImage = decodeHtmlEntities(srcMatch[1]).trim();
		if (refMatch) referrerPolicy = refMatch[1].trim().toLowerCase() || "origin";
	}

	// 总张数：<progress ... max="N">（页面用进度条展示图集总张数）
	let total = 0;
	const progressMatch =
		/<progress[^>]*\bmax="(\d+)"[^>]*>/i.exec(page) ||
		/<progress[^>]*\bid="progressBar"[^>]*\bmax="(\d+)"[^>]*>/i.exec(page);
	if (progressMatch) {
		const parsed = Number.parseInt(progressMatch[1], 10);
		total = Number.isFinite(parsed) ? parsed : 0;
	}

	// canonical / 页面前缀：判断用户给的 ID 实际属于哪个栏目
	let canonical = firstMatch(
		/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i,
		page,
	);
	if (!canonical) {
		canonical = firstMatch(
			/<link[^>]+href="([^"]+)"[^>]+rel="canonical"/i,
			page,
		);
	}
	const head = page.slice(0, 4000);
	let kind = fallbackKind;
	if (canonical.includes("/beauty/")) kind = "beauty";
	else if (canonical.includes("/photo/")) kind = "photo";
	else if (head.includes("/beauty/")) kind = "beauty";
	else if (head.includes("/photo/")) kind = "photo";

	return {
		title: title || "未知标题",
		publishTime: publishTime || "未知时间",
		firstImage,
		referrerPolicy,
		total,
		kind,
	};
}

/* ------------------------------------------------------------------ *
 * 阶段日志 / 结构化错误 / 代理配置 / 请求封装（DESIGN 第 5、6 节）
 * ------------------------------------------------------------------ */

/** 单个抓取阶段的失败：message 为 `标签:原因`（每个阶段最多 90 字符）。 */
class MztStageError extends Error {
	constructor(stage, detail, extra = {}) {
		const text = clampStageText(`${stage}:${detail || "请求失败"}`);
		super(text);
		this.name = "MztStageError";
		this.stage = stage;
		this.stageText = text;
		this.code = extra.code || "";
		this.status = Number(extra.status) || 0;
		this.cf = extra.cf || null;
		this.meta = extra.meta || null;
	}
}

/** 全部阶段失败：message 一行摘要，额外带 stageErrors / hint。 */
class MztFetchError extends Error {
	constructor(stageErrors, hint = "") {
		const errors = (stageErrors || []).filter(Boolean);
		super([...errors, hint].filter(Boolean).join("；") || "未知原因");
		this.name = "MztFetchError";
		this.stageErrors = errors;
		this.hint = hint || "";
	}
}

/** 代理失败过（已降级直连）：仅用于最终 hint */
let proxyFailureSeen = false;
/** 代理配置缓存（只解析/记录一次） */
let proxyConfigCache = null;

/** 解析 mzt_proxy；socks 等不支持协议记录警告后按直连处理。 */
function resolveProxyConfig() {
	if (proxyConfigCache) return proxyConfigCache;
	proxyConfigCache = parseProxyUrl(MZT_CONFIG.mzt_proxy);
	if (proxyConfigCache.configured && proxyConfigCache.ok) {
		logger.info(`[mzt] proxy=${formatProxyForLog(proxyConfigCache.proxy)}`);
	} else if (proxyConfigCache.configured) {
		logger.warn(`[mzt] 代理不可用（${proxyConfigCache.reason}），按直连处理`);
	}
	return proxyConfigCache;
}

/** 同一 ID 抓取限速（模块级 Map + 3 秒） */
const articleRateLimiter = createRateLimiter(3000);

/** 输出一条 stage 日志；URL 去掉 sign 等 query 值，不打印 Cookie/证书/HTML。 */
function emitStageLog(stage, url, info = {}) {
	const parts = [
		`[mzt] stage=${stage}`,
		`url=${sanitizeUrl(url, { keepOrigin: stage !== "web" })}`,
	];
	if (info.status) parts.push(`status=${info.status}`);
	parts.push(`cf-ray=${info.cf?.rayId || extractRayId(info.headers || {}, info.body || "") || "-"}`);
	if (info.challenge) parts.push(`challenge=${info.challenge}`);
	if (info.error) parts.push(`error=${describeError(info.error, 120)}`);
	if (info.elapsed !== undefined) parts.push(`elapsed=${Math.max(0, Number(info.elapsed) || 0)}ms`);
	logger.info(parts.join(" "));
}

/** 输出成功结果摘要（DESIGN 第 5.2 节）。 */
function logResult(album) {
	logger.info(`[mzt] result source=${album.source} images=${album.imageUrls.length} total=${album.total || "-"} truncated=${album.truncated}`);
}

/** 根据响应状态/Cloudflare 特征生成 stage 错误。 */
function stageErrorForResponse(stage, response, cf) {
	const status = response?.statusCode || 0;
	if (cf?.blocked) return new MztStageError(stage, cloudflareStageText(cf, status), { cf, status });
	return new MztStageError(stage, `HTTP ${status}`, { status });
}

/**
 * 带 stage 日志 + 单次重试（403/429/5xx 与超时）的 GET；
 * 代理失败时由 lib/mzt-http.js 自动降级直连并回调记录。
 */
async function requestStage(stage, url, options = {}) {
	const startedAt = Date.now();
	try {
		const response = await httpGetBuffer(url, {
			...options,
			retry: true,
			onRetry: ({ reason, waitMs }) =>
				logger.info(
					`[mzt] stage=${stage} retry=1 reason=${reason} wait=${waitMs}ms ` +
						`url=${sanitizeUrl(url, { keepOrigin: stage !== "web" })}`,
				),
			onProxyFailure: (error) => {
				proxyFailureSeen = true;
				logger.warn(
					`[mzt] stage=proxy url=${sanitizeUrl(url)} ` +
						`error=${describeError(error, 120)} fallback=direct`,
				);
			},
		});
		const cf = detectCloudflare({
			status: response.statusCode,
			headers: response.headers,
			body: response.body,
		});
		emitStageLog(stage, url, {
			status: response.statusCode,
			headers: response.headers,
			cf,
			elapsed: Date.now() - startedAt,
			challenge: cf.blocked ? cf.mode : "",
		});
		return { response, cf };
	} catch (error) {
		emitStageLog(stage, url, { elapsed: Date.now() - startedAt, error });
		throw error instanceof MztStageError ? error : new MztStageError(stage, summarizeError(error));
	}
}

/** 记录一条 stage 错误（去重 + clamp 90 字符）。 */
function recordStageError(errors, error) {
	const text = error instanceof MztStageError ? error.stageText : clampStageText(`阶段失败:${summarizeError(error)}`);
	if (!errors.includes(text)) errors.push(text);
	return text;
}

/** 记录失败特征（用于最终 hint）。 */
function noteStageFailure(state, error) {
	if (!(error instanceof MztStageError)) return;
	if (error.code === "cert-invalid" || /cert-invalid/.test(error.stageText)) state.certInvalid = true;
	if (error.cf?.blocked) state.cloudflare = true;
	if (/HTTP (403|429|5\d\d)/.test(error.stageText)) state.httpBlocked = true;
}

/** 生成最终 hint（只在全部阶段失败后输出）。 */
function buildFetchHint(state) {
	const hints = [];
	if (state.cloudflare || state.httpBlocked) hints.push("可在配置 mzt_proxy 使用可用代理后重试");
	if (state.certInvalid) hints.push("APP 接口持续 403 时请检查 mzt_app_cert 客户端证书");
	if (state.proxyConfigured && proxyFailureSeen) hints.push("代理不可用，已自动降级直连");
	if (hints.length === 0) hints.push("请检查网络或稍后重试");
	return hints.slice(0, 2).join("；");
}

/* ------------------------------------------------------------------ *
 * 图集获取：APP 接口 → 文章页元信息 → 网页接口 → 浏览器兜底
 * ------------------------------------------------------------------ */

/**
 * 获取文章页元信息（标题/时间/首图/总张数/真实栏目），并把 Set-Cookie 存入会话。
 * 失败不致命：APP 接口成功时仍能出图，只是标题/时间用 APP 返回值。
 *
 * @param {string|number} articleId 文章 ID
 * @param {string} kind 请求栏目（photo/beauty）
 * @param {object} cookieJar 本次抓取的 Cookie 会话
 * @param {object} proxy 已解析代理配置
 * @returns {Promise<object>} parseArticleHtml 的结果
 * @throws {MztStageError} 文章页请求失败 / 被 Cloudflare 拦截 / 非 2xx
 */
async function fetchArticleMeta(articleId, kind, cookieJar, proxy) {
	const pageUrl = albumUrl(articleId, kind);
	const siteRoot = `${MZT_CONFIG.mzt_site.replace(/\/+$/, "")}/`;
	const { response, cf } = await requestStage("article", pageUrl, {
		headers: buildHeaders("article", {
			ua: browserUserAgent(),
			referer: siteRoot,
			cookie: cookieJar.cookieHeader(),
		}),
		timeout: HTTP_TIMEOUT,
		proxy,
		cookieJar,
	});
	if (cf?.blocked || response.statusCode < 200 || response.statusCode >= 300) {
		throw stageErrorForResponse("文章页", response, cf);
	}
	return parseArticleHtml(response.body.toString("utf8"), kind);
}

/**
 * APP 接口（mTLS + hex/AES-128-CBC）获取全量图集；证书无效/接口失败抛 stage 错误。
 *
 * @param {string|number} articleId 文章 ID
 * @param {string} kind 栏目（photo/beauty）
 * @param {object} proxy 已解析代理配置
 * @returns {Promise<object|null>} 成功返回图集；未配置 mzt_app_api 返回 null
 * @throws {MztStageError}
 */
async function fetchAppAlbum(articleId, kind, proxy) {
	const base = String(MZT_CONFIG.mzt_app_api || "").trim().replace(/\/+$/, "");
	if (!base) {
		logger.info("[mzt] stage=app skipped=config");
		return null;
	}
	const apiUrl = `${base}/post/p?id=${encodeURIComponent(articleId)}`;
	const certificate = loadClientCertificate();
	if (certificate.status !== "loaded") {
		logger.info(`[mzt] stage=app skipped=cert-invalid url=${sanitizeUrl(apiUrl)}`);
		throw new MztStageError("APP接口", "cert-invalid", { code: "cert-invalid" });
	}

	const { response, cf } = await requestStage("app", apiUrl, {
		headers: buildHeaders("app", { ua: APP_UA }),
		key: certificate.key,
		cert: certificate.cert,
		timeout: HTTP_TIMEOUT,
		proxy,
	});
	if (cf?.blocked || response.statusCode < 200 || response.statusCode >= 300) {
		throw stageErrorForResponse("APP接口", response, cf);
	}

	let payload;
	try {
		payload = JSON.parse(response.body.toString("utf8"));
	} catch {
		throw new MztStageError("APP接口", "返回的不是 JSON");
	}
	if (!payload?.data) throw new MztStageError("APP接口", "返回格式异常（缺少 data）");
	let decoded;
	try {
		decoded = decodeApiPayload(payload.data, articleId);
	} catch {
		throw new MztStageError("APP接口", "数据解密失败");
	}
	if (decoded.scheme !== "app") throw new MztStageError("APP接口", "返回了网页端加密格式");

	let images = (decoded.images || []).filter(Boolean);
	if (images.length === 0) throw new MztStageError("APP接口", "没有返回图片");
	if (MZT_CONFIG.mzt_hd) {
		images = decoded.thumbs ? images.map(hdBeautyImageUrl) : images.map(hdImageUrl);
	}
	const total = Number(decoded.count) || images.length;
	logger.info(`[mzt] stage=app decoded=${images.length} count=${decoded.count} hd=${MZT_CONFIG.mzt_hd} thumbs=${decoded.thumbs}`);

	return {
		articleId: String(articleId),
		title: decoded.title || "未知标题",
		publishTime: decoded.date || "未知时间",
		kind,
		imageUrls: images,
		total,
		// truncated 用"截断前"的张数比较，与 AstrBot 一致
		truncated: total > images.length,
		source: "app",
		// 潮拍馆图片在新浪图床，有防盗链需要 weibo.com Referer；写真馆不需要
		referer: decoded.thumbs ? "https://weibo.com/" : null,
		pageUrl: albumUrl(articleId, kind),
	};
}

/**
 * 网页接口（base64 + AES-256-GCM）获取图片，复用文章页 Cookie 会话与统一请求头。
 * 写真馆网页端仅前 20 张预览，truncated 由文章页 progressBar 总数判断。
 *
 * @param {string|number} articleId 文章 ID
 * @param {object} meta 文章页元信息
 * @param {string} kind 真实栏目
 * @param {object} cookieJar 文章页会话 Cookie
 * @param {object} proxy 已解析代理配置
 * @returns {Promise<object>} 图集对象
 * @throws {MztStageError}
 */
async function fetchWebAlbum(articleId, meta, kind, cookieJar, proxy) {
	const pageUrl = albumUrl(articleId, kind);
	const apiUrl = `${MZT_CONFIG.mzt_site.replace(/\/+$/, "")}/app/post/p?id=${encodeURIComponent(articleId)}`;
	const { response, cf } = await requestStage("web", apiUrl, {
		headers: buildHeaders("api", {
			ua: browserUserAgent(),
			referer: pageUrl,
			cookie: cookieJar.cookieHeader(),
		}),
		timeout: HTTP_TIMEOUT,
		proxy,
		cookieJar,
	});
	if (cf?.blocked || response.statusCode < 200 || response.statusCode >= 300) {
		throw stageErrorForResponse("网页接口", response, cf);
	}

	let payload;
	try {
		payload = JSON.parse(response.body.toString("utf8"));
	} catch {
		throw new MztStageError("网页接口", "返回的不是 JSON");
	}
	if (!payload?.data) throw new MztStageError("网页接口", "返回格式异常（缺少 data）");
	let decoded;
	try {
		decoded = decodeApiPayload(payload.data, articleId);
	} catch {
		throw new MztStageError("网页接口", "数据解密失败");
	}

	let imageUrls;
	let referrerPolicy;
	let total;
	if (decoded.scheme === "app") {
		// 理论上不会在网页域出现；若出现则直接使用完整 URL
		imageUrls = (decoded.images || []).filter(Boolean);
		referrerPolicy = "no-referrer";
		total = Number(decoded.count) || imageUrls.length;
	} else {
		// 网页端只给文件名：用文章页第一张图的目录拼出完整 URL
		const prefix = dirPrefix(meta.firstImage);
		if (!prefix) throw new MztStageError("网页接口", "文章页缺少首图目录");
		imageUrls = (decoded.images || []).filter(Boolean).map((name) => prefix + name);
		referrerPolicy = meta.referrerPolicy;
		total = Number(meta.total) || 0;
	}
	if (imageUrls.length === 0) throw new MztStageError("网页接口", "没有返回图片");

	const truncated = Boolean(total && imageUrls.length < total);
	logger.info(`[mzt] stage=web decoded=${imageUrls.length} total=${total || "-"} truncated=${truncated}`);

	return {
		articleId: String(articleId),
		title: meta.title,
		publishTime: meta.publishTime,
		kind,
		imageUrls,
		total,
		truncated,
		source: "web",
		// 文章页 <img referrerpolicy>：origin → 带站点 Referer；no-referrer → 不带
		referer: referrerPolicy === "no-referrer" ? null : MZT_CONFIG.mzt_site,
		pageUrl,
	};
}

/* ------------------------------------------------------------------ *
 * 浏览器兜底（puppeteer）：挑战等待 + page.evaluate + page.request/页面内 fetch
 * ------------------------------------------------------------------ */

/** 读取页面标题/正文摘要 + 文章元信息（会被 pid 序列化到页面，不能用 Node 变量）。 */
async function readBrowserState(page) {
	try {
		return await page.evaluate(() => {
			const query = (selector) => document.querySelector(selector);
			const img = query("figure img");
			const h1 = query("h1.uk-article-title") || query("h1");
			const time = query("time");
			const progress = query("#progressBar") || query("progress");
			return {
				title: document.title || "",
				bodyText: document.body ? String(document.body.innerText || "").slice(0, 4000) : "",
				path: location.pathname || "",
				meta: {
					title: h1 ? (h1.textContent || "").trim() : String(document.title || "").replace(/_美之图$/, "").trim(),
					publishTime: time ? (time.textContent || "").trim() : "",
					firstImage: img ? img.getAttribute("src") || "" : "",
					referrerPolicy: img ? img.getAttribute("referrerpolicy") || "origin" : "origin",
					total: progress ? Number.parseInt(progress.getAttribute("max") || "0", 10) || 0 : 0,
					path: location.pathname || "",
				},
			};
		});
	} catch {
		return { title: "", bodyText: "", path: "", meta: null };
	}
}

/** 启动无头浏览器：统一 UA/语言/反自动化参数，代理用 --proxy-server 注入。 */
async function launchBrowser(proxy) {
	const args = [...BROWSER_LAUNCH_ARGS];
	if (proxy?.ok && proxy.proxy) args.push(`--proxy-server=${proxy.proxy.protocol}://${proxy.proxy.host}:${proxy.proxy.port}`);
	return puppeteer.launch({ headless: true, args });
}

/** 设置统一 UA / Accept-Language / Referer / viewport，并隐藏 navigator.webdriver。 */
async function prepareBrowserPage(page, proxy) {
	await page.setUserAgent(browserUserAgent());
	await page.setViewport({ width: 1920, height: 1080 });
	await page.setExtraHTTPHeaders({
		"Accept-Language": ACCEPT_LANGUAGE,
		Referer: `${MZT_CONFIG.mzt_site.replace(/\/+$/, "")}/`,
	});
	if (proxy?.ok && proxy.proxy?.hasAuth) {
		// Chromium --proxy-server 不支持 userinfo，尝试用 page.authenticate 完成 407 认证
		try {
			await page.authenticate({ username: proxy.proxy.username, password: proxy.proxy.password });
		} catch (error) {
			logger.warn(`[mzt] stage=browser proxy-auth=failed error=${describeError(error, 120)}`);
		}
	}
	await page.evaluateOnNewDocument(() => {
		try {
			Object.defineProperty(navigator, "webdriver", { get: () => undefined });
			Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en"] });
			Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
			window.chrome = window.chrome || { runtime: {} };
		} catch {
			// 某些环境禁止改写 navigator，忽略
		}
	});
}

/** 轮询等待 Cloudflare 挑战通过（最多 mzt_cf_wait 秒）。 */
async function waitCloudflareChallenge(page, waitSeconds) {
	const deadline = Date.now() + Math.max(0, Number(waitSeconds) || 0) * 1000;
	let last = null;
	while (Date.now() < deadline) {
		await delay(Math.min(CF_POLL_INTERVAL, Math.max(0, deadline - Date.now())));
		const state = await readBrowserState(page);
		if (!state.title && !state.bodyText) continue;
		last = state;
		const cf = detectCloudflare({ status: 0, headers: {}, body: state.bodyText, title: state.title });
		if (!cf.blocked) return { passed: true, state, cf };
	}
	const state = last || (await readBrowserState(page));
	const cf = detectCloudflare({ status: 0, headers: {}, body: state.bodyText, title: state.title });
	return { passed: false, state, cf };
}

/** 由 meta + 图片 URL 组装浏览器阶段图集。 */
function browserAlbum(articleId, kind, meta, imageUrls, pageUrl, totalOverride) {
	const total = Number(totalOverride ?? meta?.total) || 0;
	const path = String(meta?.path || "");
	const referrerPolicy = String(meta?.referrerPolicy || "origin");
	return {
		articleId: String(articleId),
		title: meta?.title || "未知标题",
		publishTime: meta?.publishTime || "未知时间",
		kind: path.startsWith("/beauty/") ? "beauty" : path.startsWith("/photo/") ? "photo" : kind,
		imageUrls,
		total,
		truncated: Boolean(total && imageUrls.length < total),
		source: "browser",
		referer: referrerPolicy === "no-referrer" ? null : MZT_CONFIG.mzt_site,
		pageUrl,
	};
}

/** 页面内 WebCrypto 解密结果（文件名词数组）→ 完整图集。 */
function browserAlbumFromNames(articleId, kind, meta, names, pageUrl) {
	if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) return null;
	const cleaned = names.filter(Boolean);
	const prefix = dirPrefix(meta?.firstImage);
	const imageUrls = cleaned.map((name) => (/^https?:\/\//i.test(name) ? name : prefix + name));
	if (imageUrls.length === 0 || imageUrls.some((url) => !/^https?:\/\//i.test(url))) return null;
	return browserAlbum(articleId, kind, meta || {}, imageUrls, pageUrl);
}

/** page.request（Playwright 风格，若环境支持）或页面内 fetch 取接口原始 JSON。 */
async function browserPayload(page, articleId) {
	const apiUrl = `${MZT_CONFIG.mzt_site.replace(/\/+$/, "")}/app/post/p?id=${encodeURIComponent(articleId)}`;
	if (typeof page?.request?.get === "function") {
		try {
			const response = await withTimeout(
				page.request.get(apiUrl, { headers: { Accept: API_ACCEPT, "X-Requested-With": "XMLHttpRequest", Referer: page.url() } }),
				BROWSER_DECRYPT_TIMEOUT,
				`浏览器接口请求超时（${BROWSER_DECRYPT_TIMEOUT}ms）`,
			);
			if (response?.ok?.()) return await response.text();
		} catch (error) {
			logger.info(`[mzt] stage=browser page.request=failed error=${describeError(error, 120)}`);
		}
	}
	const result = await withTimeout(
		page.evaluate(async (path) => {
			const response = await fetch(path, {
				credentials: "same-origin",
				headers: { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" },
			});
			return { ok: response.ok, status: response.status, text: await response.text() };
		}, `/app/post/p?id=${encodeURIComponent(articleId)}`),
		BROWSER_DECRYPT_TIMEOUT,
		`浏览器接口请求超时（${BROWSER_DECRYPT_TIMEOUT}ms）`,
	);
	if (!result?.ok) throw new MztStageError("浏览器", `图片接口 HTTP ${Number(result?.status) || 0}`);
	return result.text;
}

/** 解析页面内拿到的接口 JSON 并在 Node 侧解密（page.evaluate 解密失败的兜底）。 */
function browserAlbumFromPayload(articleId, kind, meta, payloadText, pageUrl) {
	let payload;
	try {
		payload = JSON.parse(payloadText);
	} catch {
		throw new MztStageError("浏览器", "接口返回的不是 JSON");
	}
	if (!payload?.data) throw new MztStageError("浏览器", "接口返回格式异常（缺少 data）");
	let decoded;
	try {
		decoded = decodeApiPayload(payload.data, articleId);
	} catch {
		throw new MztStageError("浏览器", "接口数据解密失败");
	}
	const images = (decoded.images || []).filter(Boolean);
	if (images.length === 0) throw new MztStageError("浏览器", "没有解密出图片");
	let effectiveMeta = meta || {};
	let imageUrls;
	let total;
	if (decoded.scheme === "app") {
		imageUrls = images;
		total = Number(decoded.count) || images.length;
		effectiveMeta = { ...effectiveMeta, referrerPolicy: "no-referrer" };
	} else {
		const prefix = dirPrefix(effectiveMeta.firstImage);
		if (!prefix) throw new MztStageError("浏览器", "文章页缺少首图目录");
		imageUrls = images.map((name) => prefix + name);
		total = Number(effectiveMeta.total) || 0;
	}
	return browserAlbum(articleId, kind, effectiveMeta, imageUrls, pageUrl, total);
}

/**
 * 在浏览器页面上下文里执行的函数：打开文章页后，在页面内请求网页图片接口
 * 并用 WebCrypto 解密（等价 AstrBot mzt.py 的 _BROWSER_FETCH_JS）。
 *
 * 用途：直连接口被 Cloudflare 拦截时，借用真实浏览器环境绕过人机校验；
 * 此时写真馆同样只有 20 张预览。
 *
 * 注意：puppeteer 会把这个函数序列化后注入页面，**不能引用 Node 侧的变量**，
 * 只能使用参数和浏览器全局对象。
 *
 * @param {string} articleId 文章 ID
 * @returns {Promise<{meta: object, names: string[]}>}
 */
async function browserFetchDecrypt(articleId) {
	const query = (selector) => document.querySelector(selector);
	const img = query("figure img");
	const h1 = query("h1.uk-article-title") || query("h1");
	const time = query("time");
	const progressBar = query("#progressBar");
	const meta = {
		title: h1 ? (h1.textContent || "").trim() : "",
		publishTime: time ? (time.textContent || "").trim() : "",
		firstImage: img ? img.getAttribute("src") || "" : "",
		referrerPolicy: img
			? img.getAttribute("referrerpolicy") || "origin"
			: "origin",
		total: progressBar
			? Number.parseInt(progressBar.getAttribute("max") || "0", 10) || 0
			: 0,
		path: location.pathname,
	};

	const response = await fetch(
		"/app/post/p?id=" + encodeURIComponent(String(articleId)),
		{
			credentials: "same-origin",
			headers: {
				Accept: "application/json, text/javascript, */*; q=0.01",
				"X-Requested-With": "XMLHttpRequest",
			},
		},
	);
	if (!response.ok) throw new Error("图片接口 HTTP " + response.status);
	const payload = await response.json();
	if (!payload || !payload.data) throw new Error("图片接口没有 data 字段");

	// base64 → 字节：salt16 + iv12 + (密文 + GCM tag)
	const raw = Uint8Array.from(atob(payload.data), (char) =>
		char.charCodeAt(0),
	);
	const salt = raw.slice(0, 16);
	const iv = raw.slice(16, 28);
	const encrypted = raw.slice(28);

	// WebCrypto：HKDF-SHA256 派生 AES-256-GCM 密钥
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(String(articleId)),
		"HKDF",
		false,
		["deriveKey"],
	);
	const key = await crypto.subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt, info: new Uint8Array(0) },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["decrypt"],
	);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		key,
		encrypted,
	);
	const names = JSON.parse(new TextDecoder().decode(plaintext));
	return { meta, names };
}

/**
 * 浏览器兜底：打开文章页 → 识别/等待 Cloudflare 挑战 → page.evaluate 解密 →
 * page.request（若环境支持）/页面内 fetch 取原始 JSON 兜底。
 *
 * puppeteer 没有 Playwright 的 page.request API；browserPayload 会先探测，
 * 不存在时用页面内 fetch（自动复用浏览器 Cookie），再由 Node 侧解密。
 *
 * @param {string|number} articleId 文章 ID
 * @param {string} kind 请求栏目（photo/beauty）
 * @param {object} proxy 已解析代理配置
 * @returns {Promise<object>} 图集对象
 * @throws {MztStageError}
 */
async function fetchAlbumBrowser(articleId, kind, proxy) {
	const pageUrl = albumUrl(articleId, kind);
	const startedAt = Date.now();
	let browser = null;
	let lastDoc = null;
	let state = { title: "", bodyText: "", meta: null };
	let pageMeta = null;
	let cf = null;
	let challenge = "";
	let logged = false;

	const logStage = (extra = {}) => {
		if (logged) return;
		logged = true;
		emitStageLog("browser", pageUrl, {
			status: lastDoc?.status,
			headers: lastDoc?.headers,
			cf,
			challenge,
			elapsed: Date.now() - startedAt,
			...extra,
		});
	};

	try {
		browser = await withTimeout(launchBrowser(proxy), BROWSER_LAUNCH_TIMEOUT, `浏览器启动超时（${BROWSER_LAUNCH_TIMEOUT}ms）`);
		const page = await browser.newPage();
		await prepareBrowserPage(page, proxy);
		// 记录最后一次导航响应（挑战通过后页面会重新导航，新响应的 cf-ray 更准确）
		page.on("response", (response) => {
			try {
				if (response.request().isNavigationRequest()) {
					lastDoc = { status: response.status(), headers: response.headers() || {} };
				}
			} catch {
				// 已销毁页面的响应对象可能不可用
			}
		});

		let response = null;
		try {
			response = await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: BROWSER_GOTO_TIMEOUT });
		} catch (error) {
			throw new MztStageError("浏览器", `页面加载失败：${summarizeError(error)}`);
		}
		lastDoc = { status: response?.status() || 0, headers: response?.headers() || {} };
		state = await readBrowserState(page);
		pageMeta = state.meta;
		cf = detectCloudflare({ status: lastDoc.status, headers: lastDoc.headers, body: state.bodyText, title: state.title });

		// Cloudflare 挑战：等待 mzt_cf_wait 秒；硬拦截不等待
		if (cf.blocked) {
			const waitSeconds = Math.max(0, Number(MZT_CONFIG.mzt_cf_wait) || 0);
			if (cf.mode === "challenge" && waitSeconds > 0) {
				const waited = await waitCloudflareChallenge(page, waitSeconds);
				state = waited.state || state;
				pageMeta = state.meta || pageMeta;
				if (waited.passed) {
					challenge = "passed";
					// 挑战通过后页面已 200，不能再拿旧 challenge 响应的 403/cf-ray 判定
					cf = waited.cf;
				} else {
					challenge = "blocked";
					cf = { ...cf, blocked: true, mode: "blocked", rayId: waited.cf.rayId || cf.rayId || extractRayId(lastDoc?.headers || {}, state.bodyText) };
				}
			} else {
				challenge = "blocked";
			}
		}
		if (cf?.blocked) {
			logStage();
			throw new MztStageError("浏览器", cloudflareStageText(cf, lastDoc?.status || 0), { cf, status: lastDoc?.status || 0, meta: pageMeta });
		}

		// 优先 page.evaluate 页面内 fetch + WebCrypto
		try {
			const result = await withTimeout(
				page.evaluate(browserFetchDecrypt, String(articleId)),
				BROWSER_DECRYPT_TIMEOUT,
				`浏览器内解密超时（${BROWSER_DECRYPT_TIMEOUT}ms）`,
			);
			const album = browserAlbumFromNames(articleId, kind, result?.meta || pageMeta || {}, result?.names || [], pageUrl);
			if (album) {
				logStage();
				return album;
			}
		} catch (error) {
			logger.info(`[mzt] stage=browser decrypt=page-evaluate-failed error=${describeError(error, 120)}`);
		}

		// 兜底：page.request / 页面内 fetch 取原始 JSON，Node 侧解密
		try {
			const album = browserAlbumFromPayload(articleId, kind, pageMeta || {}, await browserPayload(page, articleId), pageUrl);
			logStage();
			return album;
		} catch (error) {
			const stageError = error instanceof MztStageError ? error : new MztStageError("浏览器", summarizeError(error));
			if (pageMeta) stageError.meta = pageMeta;
			logStage({ error: stageError });
			throw stageError;
		}
	} catch (error) {
		if (!logged) {
			const stageError = error instanceof MztStageError ? error : new MztStageError("浏览器", summarizeError(error));
			if (pageMeta) stageError.meta = pageMeta;
			logStage({ error: stageError });
			throw stageError;
		}
		throw error;
	} finally {
		if (browser) {
			try {
				await browser.close();
			} catch {
				// 关闭失败不影响结果
			}
		}
	}
}

/**
 * 获取一个写真/潮拍图集（与 AstrBot 一致的完整回退链）：
 * 1. APP 接口（mTLS，全量）；
 * 2. 文章页元信息 + 网页接口（同 Cookie 会话，写真馆前 20 张预览）；
 * 3. 浏览器兜底（挑战等待 + page.evaluate + page.request/页面内 fetch）；
 * 4. 文章页首图兜底（source="page", truncated=true）；
 * 5. 全失败抛 MztFetchError（带 stageErrors/hint），由调用方回复"连接网页失败"。
 *
 * @param {string|number} articleId 文章 ID
 * @param {string} kind 请求栏目（photo/beauty）
 * @returns {Promise<object>} 图集对象
 * @throws {MztFetchError}
 */
async function fetchAlbum(articleId, kind) {
	const id = String(articleId);
	const requestedKind = String(kind).toLowerCase() === "beauty" ? "beauty" : "photo";
	const proxy = resolveProxyConfig();
	const waitMs = articleRateLimiter.reserve(id);
	if (waitMs > 0) {
		logger.info(`[mzt] rate-limit wait=${waitMs}ms`);
		await delay(waitMs);
	}
	proxyFailureSeen = false;
	const errors = [];
	const state = { certInvalid: false, cloudflare: false, httpBlocked: false, proxyConfigured: Boolean(proxy?.proxy) };

	// 1) APP 接口（全量；证书无效时记 cert-invalid）
	let appAlbum = null;
	try {
		appAlbum = await fetchAppAlbum(id, requestedKind, proxy);
	} catch (error) {
		recordStageError(errors, error);
		noteStageFailure(state, error);
	}
	if (appAlbum) {
		appAlbum.imageUrls = applyImageLimit(appAlbum.imageUrls);
		logResult(appAlbum);
		return appAlbum;
	}

	// 2) 文章页 + 网页接口共用同一个 Cookie 会话（APP 失败才走这里）
	const cookieJar = createCookieJar();
	let meta = null;
	try {
		meta = await fetchArticleMeta(id, requestedKind, cookieJar, proxy);
	} catch (error) {
		recordStageError(errors, error);
		noteStageFailure(state, error);
	}
	const actualKind = meta ? meta.kind : requestedKind;
	let webAlbum = null;
	if (meta) {
		try {
			webAlbum = await fetchWebAlbum(id, meta, actualKind, cookieJar, proxy);
		} catch (error) {
			recordStageError(errors, error);
			noteStageFailure(state, error);
		}
	} else {
		errors.push("网页接口:文章页不可用");
	}
	if (webAlbum && webAlbum.imageUrls.length > 0) {
		webAlbum.imageUrls = applyImageLimit(webAlbum.imageUrls);
		logResult(webAlbum);
		return webAlbum;
	}

	// 3) 浏览器兜底（mzt_browser_fallback=false 时跳过，仍允许首图兜底）
	let browserMeta = null;
	if (MZT_CONFIG.mzt_browser_fallback !== false) {
		try {
			const album = await fetchAlbumBrowser(id, requestedKind, proxy);
			album.imageUrls = applyImageLimit(album.imageUrls);
			if (album.imageUrls.length > 0) {
				logResult(album);
				return album;
			}
		} catch (error) {
			browserMeta = error?.meta || null;
			recordStageError(errors, error);
			noteStageFailure(state, error);
		}
	} else {
		errors.push("浏览器:已禁用（mzt_browser_fallback=false）");
	}

	// 4) 文章页首图兜底（直连或浏览器页面拿到的 meta 均可）
	const pageMeta = meta || browserMeta;
	if (pageMeta?.firstImage) {
		const album = {
			articleId: id,
			title: pageMeta.title || "未知标题",
			publishTime: pageMeta.publishTime || "未知时间",
			kind: pageMeta.kind || (String(pageMeta.path || "").startsWith("/beauty/") ? "beauty" : requestedKind),
			imageUrls: applyImageLimit([pageMeta.firstImage]),
			total: Number(pageMeta.total) || 0,
			truncated: true,
			source: "page",
			referer: pageMeta.referrerPolicy === "no-referrer" ? null : MZT_CONFIG.mzt_site,
			pageUrl: albumUrl(id, requestedKind),
		};
		logResult(album);
		return album;
	}
	errors.push("网页首图:文章页未提供首图");

	throw new MztFetchError(errors, buildFetchHint(state));
}

/* ------------------------------------------------------------------ *
 * 图片下载与发送前压缩
 * ------------------------------------------------------------------ */

/**
 * 下载单张图片，返回原始 Buffer；失败返回 null（不抛异常，由调用方回退 URL）。
 *
 * @param {string} imageUrl 图片地址
 * @param {string|null} referer 防盗链 Referer（null 表示不发送）
 * @returns {Promise<Buffer|null>}
 */
async function downloadImageBuffer(imageUrl, referer) {
	try {
		// 与解析链路共用 mzt_proxy：部署机 IP 被拦时图片也必须走代理
		const response = await httpGetBuffer(imageUrl, {
			headers: buildHeaders("image", { ua: browserUserAgent(), referer }),
			timeout: DOWNLOAD_TIMEOUT,
			maxRedirects: MAX_REDIRECTS,
			proxy: resolveProxyConfig(),
		});
		if (response.statusCode !== 200) {
			logger.warn(`[mzt] 下载图片失败（HTTP ${response.statusCode}）：${sanitizeUrl(imageUrl)}`);
			return null;
		}
		return response.body;
	} catch (error) {
		logger.warn(`[mzt] 下载图片出错：${describeError(error, 120)} - ${sanitizeUrl(imageUrl)}`);
		return null;
	}
}

/**
 * 发送前压缩：长边缩到 1280、按 JPEG 质量 80 重新压缩（渐进式）。
 *
 * 对应 AstrBot imaging.shrink_for_send：肉眼几乎无感，但体积能降一个数量级，
 * 避免几十张原图塞进合并转发时超出 OneBot 的负载上限导致连接被断开。
 * rotate() 用于按 EXIF 方向摆正手机拍摄的图；处理失败（损坏图片、sharp 缺失等）
 * 时回退原始 Buffer，保证不会因为"压缩失败"丢图。
 *
 * @param {Buffer} buffer 原始图片字节
 * @returns {Promise<Buffer>} 压缩后的 JPEG 字节（失败时为原 Buffer）
 */
async function shrinkForSend(buffer) {
	try {
		return await sharp(buffer)
			.rotate()
			.resize({
				width: MAX_SEND_SIDE,
				height: MAX_SEND_SIDE,
				fit: "inside",
				withoutEnlargement: true,
			})
			.jpeg({ quality: SEND_JPEG_QUALITY, progressive: true })
			.toBuffer();
	} catch (error) {
		logger.warn(`[mzt] 图片压缩失败，回退原图：${error.message}`);
		return buffer;
	}
}

/**
 * 并发下载整批图片，并转成 `base64://...` 字符串。
 *
 * 使用"共享游标 + 固定数量 worker"实现并发（与 mtb.js 的队列 worker 语义相同，
 * 但保证结果顺序与输入 URL 顺序一致，避免图片乱序）。
 *
 * @param {string[]} imageUrls 图片地址列表
 * @param {string|null} referer 防盗链 Referer
 * @returns {Promise<Array<{url: string, base64: string|null}>>}
 */
async function downloadImages(imageUrls, referer) {
	const results = new Array(imageUrls.length);
	let cursor = 0;

	const worker = async () => {
		while (true) {
			const index = cursor;
			cursor += 1;
			if (index >= imageUrls.length) return;

			const url = imageUrls[index];
			const raw = await downloadImageBuffer(url, referer);
			if (!raw) {
				results[index] = { url, base64: null };
				continue;
			}
			const compressed = await shrinkForSend(raw);
			results[index] = {
				url,
				base64: `base64://${compressed.toString("base64")}`,
			};
		}
	};

	const workerCount = Math.min(DOWNLOAD_CONCURRENCY, imageUrls.length);
	await Promise.all(
		Array.from({ length: workerCount }, () => worker()),
	);
	return results;
}

/**
 * 组装合并转发的文本消息头（与 AstrBot AlbumInfo.header 逐行一致）。
 *
 * @param {object} album 图集对象
 * @returns {string} 多行文本
 */
function formatAlbumHeader(album) {
	const lines = [
		`📌 文章标题: ${album.title}`,
		`⏰ 发布时间: ${album.publishTime}`,
		`🆔 文章ID: ${album.articleId}`,
		`🗂️ 图集类型: ${KIND_LABEL[album.kind] || album.kind}`,
	];
	if (album.total > 0) {
		lines.push(`🖼️ 图片数量: ${album.imageUrls.length}/${album.total}`);
	} else {
		lines.push(`🖼️ 图片数量: ${album.imageUrls.length}`);
	}
	lines.push(`🔗 数据源: ${SOURCE_LABEL[album.source] || album.source}`);
	if (album.truncated) {
		lines.push(
			album.source === "page"
				? "⚠️ 网页首图兜底：接口暂不可用，仅发送文章首图（完整图集需“美之图”APP）"
				: "⚠️ 网页接口仅提供前 20 张预览（APP 接口暂时不可用），完整图集需“美之图”APP",
		);
	}
	return lines.join("\n");
}

/**
 * 妹子图图片提取插件
 * @class mztPlugin
 * @classdesc 从妹子图网站提取写真、潮拍和模特图片的插件
 *
 * 功能包括：
 * 1. 根据 ID/链接获取写真馆图集（优先美之图 APP 全量接口，失败自动回退网页/浏览器）
 * 2. 根据 ID/链接获取潮拍馆图集（新增）
 * 3. 手动/自动更新写真ID列表
 * 4. 随机获取写真图片
 *
 * 支持 NapCat.Onebot 的特殊转发格式
 *
 * @property {string} name - 插件名称
 * @property {string} dsc - 插件描述
 * @property {string} event - 监听事件
 * @property {number} priority - 优先级
 * @property {Array} rule - 命令规则
 * @property {Array} task - 定时任务配置
 * @property {Array} mztIds - 存储写真ID的数组
 *
 * @example
 * // 使用示例：
 * // #写真馆12345  /  #写真馆 12345  /  #写真馆 https://kkmzt.com/photo/12345
 * // #潮拍馆191566
 * // #更新写真ID
 * // #随机写真
 */
export class mztPlugin extends plugin {
	/**
	 * 插件构造函数
	 * @constructs mztPlugin
	 * @description 初始化插件配置、规则和定时任务
	 */
	constructor() {
		super({
			name: "mzt图片提取插件",
			dsc: "从妹子图网站提取妹子的图片",
			event: "message",
			priority: -Infinity,
			rule: [
				{
					// 兼容 #写真馆12345、#写真馆 12345、#写真馆 https://kkmzt.com/photo/12345
					reg: "^#?写真馆\\s*(\\S+)$",
					fnc: "processmztRequest",
				},
				{
					// 新增：潮拍馆（与写真馆共用解析链路，只是默认栏目不同）
					reg: "^#?潮拍馆\\s*(\\S+)$",
					fnc: "processBeautyRequest",
				},
				{
					reg: "^#?更新写真(ID|id)$",
					fnc: "fetchAllmztArticleIds",
				},
				{
					reg: "^#?随机写真$",
					fnc: "randommztRequest",
				},
			],
		});

		/**
		 * 定时任务配置
		 * @type {Array}
		 * @property {string} cron - cron表达式
		 * @property {string} name - 任务名称
		 * @property {Function} fnc - 任务执行函数
		 * @property {boolean} log - 是否记录日志
		 */
		this.task = [
			{
				cron: "0 30 7 * * *", // 每天07:30执行
				name: "自动增量更新写真ID",
				fnc: this.fetchAllmztArticleIds.bind(this, null),
				log: true,
			},
		];

		/**
		 * 写真ID列表
		 * @type {Array<number>}
		 */
		this.mztIds = [];

		// 初始化时加载写真ID
		this.loadmztIds();
	}

	/**
	 * 加载写真ID列表
	 * @async
	 * @description 从文件系统加载存储的写真ID列表
	 * @returns {Promise<void>}
	 */
	async loadmztIds() {
		try {
			const filePath = path.join(
				process.cwd(),
				"data",
				"sp-plugin",
				"mztids.json"
			);

			if (fs.existsSync(filePath)) {
				const data = fs.readFileSync(filePath, "utf8");
				this.mztIds = JSON.parse(data);
				logger.info(`成功加载 ${this.mztIds.length} 个写真ID`);
			} else {
				logger.info("写真ID文件不存在，将在下次更新时创建");
			}
		} catch (error) {
			logger.error("加载写真ID失败:", error);
		}
	}

	/**
	 * 处理随机写真请求
	 * @param {Object} e - 消息事件对象
	 * @async
	 * @description 从已加载的写真ID列表中随机选择一个ID进行请求
	 * @returns {Promise<void>}
	 */
	async randommztRequest(e) {
		if (this.mztIds.length === 0) {
			await e.reply("写真ID列表为空，请先使用 #更新写真ID", true);
			return;
		}

		const randomId =
			this.mztIds[Math.floor(Math.random() * this.mztIds.length)];

		await e.reply(`写真ID：${randomId} 正在搜索，请稍等...`, false, {
			at: true,
		});
		// 合成一条 #写真馆{id} 消息，复用写真馆的处理链路（与原实现一致）
		await this.processmztRequest(
			{
				...e,
				msg: `#写真馆${randomId}`,
			},
			true
		);
	}

	/**
	 * 处理写真馆请求（兼容 /beauty 链接：链接里的栏目优先）
	 * @param {Object} e - 消息事件对象
	 * @param {boolean} [skipTip=false] - 是否跳过"正在搜索"提示
	 * @async
	 * @returns {Promise<void>}
	 */
	async processmztRequest(e, skipTip = false) {
		const ref = parseArticleRef(e.msg);
		if (!ref) {
			await e.reply(
				"用法：#写真馆 <ID或链接>，例如 #写真馆 171317 或 " +
					"#写真馆 https://kkmzt.com/photo/171317",
				true
			);
			return;
		}
		if (!skipTip) {
			await e.reply("正在搜索，请稍等...", false, {
				at: true,
				recallMsg: 60,
			});
		}
		await this.sendMztAlbum(e, ref.articleId, ref.kind);
	}

	/**
	 * 处理潮拍馆请求（新增指令，栏目强制为 beauty）
	 * @param {Object} e - 消息事件对象
	 * @param {boolean} [skipTip=false] - 是否跳过"正在搜索"提示
	 * @async
	 * @returns {Promise<void>}
	 */
	async processBeautyRequest(e, skipTip = false) {
		const ref = parseArticleRef(e.msg);
		if (!ref) {
			await e.reply(
				"用法：#潮拍馆 <ID或链接>，例如 #潮拍馆 191566 或 " +
					"#潮拍馆 https://kkmzt.com/beauty/191566",
				true
			);
			return;
		}
		if (!skipTip) {
			await e.reply("正在搜索，请稍等...", false, {
				at: true,
				recallMsg: 60,
			});
		}
		await this.sendMztAlbum(e, ref.articleId, "beauty");
	}

	/**
	 * 解析并发送一个写真/潮拍图集（下载 → 压缩 → 分批合并转发）。
	 *
	 * 发送流程与 AstrBot features/mzt.py 的 _send_mzt_album 对齐：
	 * * 图片全部下载失败时，用"相反"的 Referer 再试一次；
	 * * 文本消息头单独作为一个节点，图片每 20 个节点一批；
	 * * 下载失败的单张图回退成原 URL（与 mtb.js 一致）。
	 *
	 * @param {Object} e 消息事件对象
	 * @param {string|number} articleId 文章 ID
	 * @param {string} kind 栏目（photo/beauty）
	 * @async
	 * @returns {Promise<void>}
	 */
	async sendMztAlbum(e, articleId, kind) {
		let album;
		try {
			album = await fetchAlbum(articleId, kind);
		} catch (error) {
			// 异常只打类型 + 截断文本；各阶段详情已在 stage 日志里，HTML/Cookie/证书不进日志
			logger.error(`[mzt] 解析文章 ${articleId}（${kind}）失败：${describeError(error, 120)}`);
			await e.reply(`连接网页失败，请稍后再试（${error.message}）`, true);
			return;
		}

		if (!album.imageUrls || album.imageUrls.length === 0) {
			logger.warn(`[mzt] 文章 ${articleId} 没有解析到图片`);
			await e.reply("没有找到任何图片，请稍后再试。", true);
			return;
		}

		logger.info(
			`[mzt] 文章 ${articleId}：${album.imageUrls.length}/${
				album.total || "未知"
			} 张，数据源=${album.source}，预览截断=${album.truncated}，` +
				`referer=${album.referer}`,
		);

		// 1) 先按图集自带的 Referer 下载
		let results = await downloadImages(album.imageUrls, album.referer);
		let successCount = results.filter((item) => item.base64).length;

		// 2) 全部失败：图床 Referer 策略可能随站点调整，换成"相反"策略重试一次
		//    （网页端 → 不带 Referer；App/浏览器端 → 带站点 Referer）
		if (successCount === 0) {
			const altReferer =
				album.referer === MZT_CONFIG.mzt_site ? null : MZT_CONFIG.mzt_site;
			logger.info(
				`[mzt] 文章 ${articleId} 首次下载全部失败，改用 referer=${altReferer} 重试`,
			);
			results = await downloadImages(album.imageUrls, altReferer);
			successCount = results.filter((item) => item.base64).length;
		}

		if (successCount === 0) {
			logger.warn(`[mzt] 文章 ${articleId} 图片全部下载失败`);
			await e.reply("图片下载失败，请稍后再试。", true);
			return;
		}

		// 3) 组装合并转发节点：文本头算第一个节点，图片每张一个节点
		const nickname = String(e.user_id);
		const nodes = [
			{
				message: formatAlbumHeader(album),
				nickname,
				user_id: e.user_id,
			},
			...results.map((item) => ({
				// 下载成功的用 base64（不暴露图片源），失败的回退原 URL
				message: segment.image(item.base64 || item.url),
				nickname,
				user_id: e.user_id,
			})),
		];

		// 4) 每 BATCH_SIZE 个节点一批发送
		const batchCount = Math.ceil(nodes.length / BATCH_SIZE);
		for (let index = 0; index < nodes.length; index += BATCH_SIZE) {
			const batch = nodes.slice(index, index + BATCH_SIZE);
			await this.sendForward(batch, e);
			const batchIndex = index / BATCH_SIZE + 1;
			logger.info(
				`[mzt] 文章 ${articleId}：已发送第 ${batchIndex}/${batchCount} 批`,
			);
			// 批次间稍作延迟，避免 OneBot 端短时间收到大量合并转发
			if (batchIndex < batchCount) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		}
	}

	/**
	 * 发送合并转发消息（兼容 NapCat.Onebot 与普通 Bot）
	 *
	 * 代码与 mtb.js 的 sendForward 保持一致：
	 * NapCat 走 sendApi 的 node 结构，其它 Bot 走 Bot.makeForwardMsg。
	 *
	 * @param {Array} messages 消息节点数组
	 * @param {Object} e 事件对象
	 * @async
	 * @returns {Promise<void>}
	 */
	async sendForward(messages, e) {
		if (e.bot?.version?.app_name === "NapCat.Onebot") {
			const nodes = messages.map((msg) => {
				const content = [];
				const msgArray = Array.isArray(msg.message)
					? msg.message
					: [msg.message];
				for (const item of msgArray) {
					if (typeof item === "string") {
						content.push({ type: "text", data: { text: item } });
					} else if (item?.type === "image") {
						// 安全获取图片URL（base64:// 或 http(s)://）
						const fileUrl =
							item.data?.file || item.data?.url || item.file || "";
						if (fileUrl) {
							content.push({ type: "image", data: { file: fileUrl } });
						} else {
							logger.error("图片URL解析失败:", item);
							content.push({
								type: "text",
								data: { text: "[图片解析失败]" },
							});
						}
					} else {
						content.push({
							type: "text",
							data: { text: "不支持的消息类型" },
						});
					}
				}
				return {
					type: "node",
					data: { nickname: msg.nickname, user_id: msg.user_id, content },
				};
			});

			const requestBody = {
				group_id: e.group_id,
				user_id: e.user_id,
				messages: nodes,
				news: [{ text: "QQ/VX：1638276310" }],
				prompt: "QQ/VX：1638276310",
				summary: "QQ/VX：1638276310",
				source: "QQ/VX：1638276310",
			};

			try {
				if (e.isGroup) {
					await e.bot.sendApi("send_group_forward_msg", requestBody);
				} else {
					await e.bot.sendApi("send_private_forward_msg", requestBody);
				}
			} catch (error) {
				logger.error("NapCat转发消息失败:", error);
				await e.reply("消息发送失败，请稍后再试", true);
			}
		} else {
			try {
				const forwardMsg = await Bot.makeForwardMsg(messages);
				await e.reply(forwardMsg);
			} catch (error) {
				logger.error("创建转发消息失败:", error);
				await e.reply("消息发送失败，请稍后再试", true);
			}
		}
	}

	/**
	 * 增量更新写真ID列表
	 * @param {Object|null} e - 消息事件对象（定时任务时为null）
	 * @async
	 * @description 增量爬取妹子图网站的写真ID并保存
	 * @returns {Promise<void>}
	 */
	async fetchAllmztArticleIds(e) {
		// 权限检查
		if (e && !e.isMaster) {
			e.reply("仅主人可用", true);
			return true;
		}

		// 通知用户
		if (e) {
			await e.reply("开始增量更新写真ID列表，这可能需要几分钟时间...", true);
		} else {
			logger.info("[定时任务] 开始自动增量更新写真ID");
		}

		const baseUrl = "https://kkmzt.com/photo/";
		const existSet = new Set(this.mztIds);
		let newlyAdded = 0;
		let browser;
		let pageNo = 1;
		let stop = false;

		try {
			// 与图集抓取共用统一 UA / 代理 / 反自动化参数（代理对列表页同样生效）
			browser = await launchBrowser(resolveProxyConfig());
			const page = await browser.newPage();
			await prepareBrowserPage(page, resolveProxyConfig());

			while (!stop) {
				const url = pageNo === 1 ? baseUrl : `${baseUrl}page/${pageNo}/`;
				logger.info(`[增量] 拉取列表页 ${url}`);
				const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: BROWSER_GOTO_TIMEOUT });
				const state = await readBrowserState(page);
				const cf = detectCloudflare({ status: response?.status() || 0, headers: response?.headers() || {}, body: state.bodyText, title: state.title });
				if (cf.blocked) throw new Error(cloudflareStageText(cf, response?.status() || 0));

				// 提取当前页面ID
				const pageIds = await page.$$eval("a.uk-inline.u-thumb-v", (links) =>
					links
						.map((link) => {
							const match = link.href.match(/\/photo\/(\d+)\/?$/);
							return match ? match[1] : null;
						})
						.filter(Boolean)
				);

				if (pageIds.length === 0) break;

				const allExists = pageIds.every((id) => existSet.has(id));
				if (allExists) {
					logger.info("[增量] 本页ID已全部存在，终止翻页");
					stop = true;
				} else {
					for (const id of pageIds) {
						if (!existSet.has(id)) {
							existSet.add(id);
							this.mztIds.unshift(id); // 新ID放最前
							newlyAdded++;
						}
					}
				}

				// 延迟防止请求过快
				await new Promise((resolve) => setTimeout(resolve, 800));
				pageNo++;
			}

			await browser.close();

			// 去重并保存ID
			const filePath = path.join(
				process.cwd(),
				"data",
				"sp-plugin",
				"mztids.json"
			);

			// 确保目录存在
			const dir = path.dirname(filePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			// 写入文件
			fs.writeFileSync(filePath, JSON.stringify(this.mztIds), "utf8");
			logger.info(`文章ID已保存到 ${filePath}`);

			// 完成通知
			const msg = `增量更新完成！新增 ${newlyAdded} 个ID，当前总计 ${this.mztIds.length} 个`;
			if (e) {
				await e.reply(msg, true);
			} else {
				logger.info(`[定时任务] ${msg}`);
			}
		} catch (error) {
			logger.error("增量更新失败:", error);
			if (e) {
				await e.reply(`更新失败: ${error.message}`, true);
			} else {
				logger.error(`[定时任务] 增量更新失败: ${error.message}`);
			}
		} finally {
			if (browser) await browser.close();
		}
	}
}
