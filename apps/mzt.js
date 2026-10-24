import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";
import sharp from "sharp";
import { fileURLToPath } from "url";

import {
	decodeApiPayload,
	hdBeautyImageUrl,
	hdImageUrl,
} from "../lib/mzt-crypto.js";

/* ------------------------------------------------------------------ *
 * 配置区（对应 AstrBot 版 _conf_schema.json 里的 mzt_* 配置项）
 *
 * 说明：TRSS-Yunzai 侧暂时不读插件配置文件，保持原插件"常量即配置"的风格；
 * 需要临时改行为时直接改这里的值即可（语义与 AstrBot 完全一致）。
 * ------------------------------------------------------------------ */

/**
 * 妹子图相关配置
 * @type {{mzt_site: string, mzt_app_api: string, mzt_hd: boolean,
 *         mzt_max_images: number, mzt_browser_fallback: boolean}}
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
};

/**
 * 官方 APP 的 User-Agent（逆向自 APP 内 res/ua.txt；api.iimzt.com 会校验，
 * 用普通浏览器 UA 会直接被 Cloudflare 拦掉）
 */
const APP_UA = "MztApp For Android Version/3.8.7";

/** 文章页的 Accept（与 AstrBot app_core/mzt.py 的 ARTICLE_HEADERS 一致） */
const ARTICLE_ACCEPT =
	"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

/** 图片接口的 Accept（与 AstrBot 的 API_HEADERS 一致） */
const API_ACCEPT = "application/json, text/javascript, */*; q=0.01";

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
/** 单次 HTTP 响应体大小上限（字节），对齐 AstrBot fetch_bytes 的 max_size=64MB */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
/** 最多跟随的重定向次数（APP 接口/图片 CDN 可能 301 到真实节点） */
const MAX_REDIRECTS = 3;
/** 需要跟随的 HTTP 重定向状态码 */
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/** 图集类型 → 中文栏目名 */
const KIND_LABEL = { photo: "写真馆", beauty: "潮拍馆" };
/** 默认栏目：不写栏目时按写真馆处理 */
const DEFAULT_KIND = "photo";

/** 数据源 → 消息头里的中文标签（与 AstrBot AlbumInfo.source_label 一致） */
const SOURCE_LABEL = {
	app: "美之图 APP 接口（全量）",
	web: "网页接口",
	browser: "网页（浏览器兜底）",
};

/** 当前文件所在目录（ESM 没有 __dirname，用 import.meta.url 还原） */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * APP 端 mTLS 客户端证书路径。
 *
 * 注意：**不能用 process.cwd() 定位** —— TRSS-Yunzai 的工作目录是 Bot 根目录，
 * 而不是插件目录，用 cwd 拼路径在部署环境里必然找不到证书。
 */
const MZT_CLIENT_CERT_PATH = path.join(
	MODULE_DIR,
	"..",
	"config",
	"mzt_client.pem",
);

/**
 * 预定义的用户代理列表，用于模拟不同浏览器环境
 * @type {Array<string>}
 */
const USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
	"Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

/* ------------------------------------------------------------------ *
 * 通用小工具
 * ------------------------------------------------------------------ */

/**
 * 从预定义的用户代理列表中随机获取一个
 * @returns {string} 随机用户代理字符串
 */
function randomUserAgent() {
	return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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

/** mTLS 证书缓存：只读一次文件（进程内复用，避免每张图/每次请求都读盘） */
let cachedClientCertificate = null;
/** 是否已经尝试读取过证书（读取失败也标记，避免反复重试刷日志） */
let clientCertificateLoaded = false;

/**
 * 读取 APP 内置的 mTLS 客户端证书，并拆成 https.request 需要的 cert/key。
 *
 * 证书文件是从官方 APK 的 PKCS#12（assets/widget/res/config，密码在解密后的
 * res/key.xml）转换出来的 PEM，前半段是 CERTIFICATE、后半段是 PRIVATE KEY，
 * 这里按 `-----BEGIN PRIVATE KEY-----` 切成两段传给 https.request。
 *
 * 读取/解析失败时返回 null：APP 接口会 403（Cloudflare），随后自动回退网页接口，
 * 不影响功能可用性。
 *
 * @returns {{cert: string, key: string}|null}
 */
function loadClientCertificate() {
	if (clientCertificateLoaded) return cachedClientCertificate;
	clientCertificateLoaded = true;

	try {
		const pem = fs.readFileSync(MZT_CLIENT_CERT_PATH, "utf8");
		const privateKeyMarker = "-----BEGIN PRIVATE KEY-----";
		const privateKeyIndex = pem.indexOf(privateKeyMarker);
		if (privateKeyIndex < 0) {
			logger.warn(
				`[mzt] 证书文件缺少私钥段，APP 接口可能被 403 拦截：${MZT_CLIENT_CERT_PATH}`,
			);
			return null;
		}
		cachedClientCertificate = {
			cert: pem.slice(0, privateKeyIndex).trim(),
			key: pem.slice(privateKeyIndex).trim(),
		};
		logger.info(
			`[mzt] 已加载 APP 接口 mTLS 客户端证书：${path.basename(
				MZT_CLIENT_CERT_PATH,
			)}`,
		);
	} catch (error) {
		logger.warn(
			`[mzt] 加载 mTLS 客户端证书失败（${error.message}），APP 接口可能被 403 拦截`,
		);
		cachedClientCertificate = null;
	}
	return cachedClientCertificate;
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
 * 直连 HTTP 请求
 * ------------------------------------------------------------------ */

/**
 * 发起一次 HTTP(S) GET 请求，并把响应体完整读进 Buffer（自动跟随重定向）。
 *
 * 之所以不用 axios：APP 接口必须走 mTLS（客户端证书），而项目现有依赖里
 * axios 是可选依赖、且 https.Agent 配置不直观；Node 内置 https.request
 * 直接支持 key/cert，零新增依赖。
 *
 * @param {string} url 请求地址
 * @param {object} [options]
 * @param {object} [options.headers] 附加请求头
 * @param {string|Buffer} [options.key] mTLS 客户端私钥（APP 接口用）
 * @param {string|Buffer} [options.cert] mTLS 客户端证书（APP 接口用）
 * @param {number} [options.timeout] 超时毫秒数
 * @param {number} [options.maxRedirects] 最多跟随的重定向次数
 * @param {number} [options.redirectCount] 内部使用：当前已跟随次数
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer, finalUrl: string}>}
 */
function httpGetBuffer(url, options = {}) {
	const {
		headers = {},
		key,
		cert,
		timeout = HTTP_TIMEOUT,
		maxRedirects = MAX_REDIRECTS,
		redirectCount = 0,
	} = options;

	return new Promise((resolve, reject) => {
		let target;
		try {
			target = new URL(url);
		} catch {
			reject(new Error(`URL 非法：${url}`));
			return;
		}
		if (target.protocol !== "http:" && target.protocol !== "https:") {
			reject(new Error(`不支持的协议：${target.protocol}`));
			return;
		}

		const transport = target.protocol === "http:" ? http : https;
		const requestOptions = {
			method: "GET",
			headers: { ...headers },
			// 这里的 timeout 只负责在 socket 空闲时触发 'timeout' 事件，
			// 真正的销毁在下面 req.on('timeout') 里做，避免慢图床把请求挂死。
			timeout,
		};
		// 客户端证书只对 https 有意义（http 请求带上反而多余）
		if (transport === https && (key || cert)) {
			requestOptions.key = key;
			requestOptions.cert = cert;
		}

		const req = transport.request(target, requestOptions, (res) => {
			const statusCode = res.statusCode || 0;
			const location = res.headers.location;

			// 跟随 301/302/303/307/308（APP 接口可能跳转到真实节点）
			if (REDIRECT_CODES.has(statusCode) && location) {
				res.resume(); // 丢弃重定向响应体，释放连接
				if (redirectCount >= maxRedirects) {
					reject(new Error(`重定向次数超过 ${maxRedirects} 次：${url}`));
					return;
				}
				let nextUrl;
				try {
					nextUrl = new URL(location, target).toString();
				} catch {
					reject(new Error(`重定向地址非法：${location}`));
					return;
				}
				httpGetBuffer(nextUrl, {
					headers,
					key,
					cert,
					timeout,
					maxRedirects,
					redirectCount: redirectCount + 1,
				}).then(resolve, reject);
				return;
			}

			// 完整读流：图片/HTML/JSON 都一次性读进内存。
			// 加大小上限，避免异常/恶意响应把进程内存打爆（对齐 AstrBot 的 max_size）。
			const chunks = [];
			let totalBytes = 0;
			let settled = false;
			res.on("data", (chunk) => {
				if (settled) return;
				totalBytes += chunk.length;
				if (totalBytes > MAX_RESPONSE_BYTES) {
					settled = true;
					res.destroy();
					reject(
						new Error(
							`响应体超过大小上限 ${MAX_RESPONSE_BYTES} 字节：${url}`,
						),
					);
					return;
				}
				chunks.push(chunk);
			});
			res.on("end", () => {
				if (settled) return;
				settled = true;
				resolve({
					statusCode,
					headers: res.headers,
					body: Buffer.concat(chunks),
					finalUrl: target.toString(),
				});
			});
			res.on("error", (error) => {
				if (settled) return;
				settled = true;
				reject(error);
			});
		});

		req.on("timeout", () => {
			req.destroy(new Error(`请求超时（${timeout}ms）：${url}`));
		});
		req.on("error", reject);
		req.end();
	});
}

/* ------------------------------------------------------------------ *
 * 图集获取：APP 接口 → 文章页元信息 → 网页接口 → 浏览器兜底
 * ------------------------------------------------------------------ */

/**
 * 获取文章页元信息（标题/发布时间/首图/总张数/真实栏目）。
 *
 * 这一步失败不致命：APP 接口成功时仍能正常出图，只是标题/时间用 APP 返回值。
 *
 * @param {string|number} articleId 文章 ID
 * @param {string} kind 请求栏目（photo/beauty）
 * @returns {Promise<object>} parseArticleHtml 的结果
 * @throws {Error} 文章页请求失败或返回非 2xx
 */
async function fetchArticleMeta(articleId, kind) {
	const pageUrl = albumUrl(articleId, kind);
	const response = await httpGetBuffer(pageUrl, {
		headers: {
			Accept: ARTICLE_ACCEPT,
			"User-Agent": randomUserAgent(),
			Referer: `${MZT_CONFIG.mzt_site.replace(/\/+$/, "")}/`,
		},
		timeout: HTTP_TIMEOUT,
	});
	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new Error(`文章页 HTTP ${response.statusCode}`);
	}
	return parseArticleHtml(response.body.toString("utf8"), kind);
}

/**
 * 调用官方 APP 接口获取全量图集（mTLS + hex/AES-128-CBC）。
 *
 * 与网页接口同路径（`post/p?id=`），但：
 * * 必须携带 APP 内置的 mTLS 客户端证书，否则 Cloudflare 直接 403；
 * * 响应 `data` 是 hex 编码的 AES-128-CBC 密文；
 * * 解密后是 `{images:[完整URL...], count:N, title, date, thumbs}`，
 *   其中 count 是全量张数，images 已带 `?sign=`。
 *
 * @param {string|number} articleId 文章 ID
 * @param {string} kind 栏目（photo/beauty）
 * @returns {Promise<object|null>} 成功返回图集对象，任何失败返回 null（外层走兜底）
 */
async function fetchAppAlbum(articleId, kind) {
	const base = String(MZT_CONFIG.mzt_app_api || "")
		.trim()
		.replace(/\/+$/, "");
	if (!base) {
		logger.info("[mzt] 未配置 mzt_app_api，跳过 APP 接口");
		return null;
	}
	const apiUrl = `${base}/post/p?id=${encodeURIComponent(articleId)}`;
	const certificate = loadClientCertificate();
	logger.info(
		`[mzt] GET ${apiUrl}（mTLS=${certificate ? "on" : "off"}）`,
	);

	let decoded;
	try {
		const response = await httpGetBuffer(apiUrl, {
			headers: {
				Accept: API_ACCEPT,
				"X-Requested-With": "XMLHttpRequest",
				"User-Agent": APP_UA,
			},
			key: certificate ? certificate.key : undefined,
			cert: certificate ? certificate.cert : undefined,
			timeout: HTTP_TIMEOUT,
		});

		if (response.statusCode < 200 || response.statusCode >= 300) {
			logger.info(
				`[mzt] APP 接口 HTTP ${response.statusCode}，回退网页接口`,
			);
			return null;
		}

		let payload;
		try {
			payload = JSON.parse(response.body.toString("utf8"));
		} catch (error) {
			logger.info(`[mzt] APP 接口返回的不是 JSON：${error.message}`);
			return null;
		}
		if (!payload || !payload.data) {
			logger.info("[mzt] APP 接口返回格式异常（没有 data 字段）");
			return null;
		}
		decoded = decodeApiPayload(payload.data, articleId);
	} catch (error) {
		logger.info(`[mzt] APP 接口失败：${error.message}`);
		return null;
	}

	if (decoded.scheme !== "app") {
		logger.info("[mzt] APP 接口返回的是网页端 GCM 格式，改走网页接口");
		return null;
	}

	let images = (decoded.images || []).filter(Boolean);
	if (images.length === 0) {
		logger.info("[mzt] APP 接口没有返回图片");
		return null;
	}

	// 高清处理：潮拍馆（带 thumbs，新浪图床）mw1024→mw2000；
	// 写真馆（ap/ax.iimzt.com）ap→ax 并重新签名。
	if (MZT_CONFIG.mzt_hd) {
		images = decoded.thumbs
			? images.map((url) => hdBeautyImageUrl(url))
			: images.map((url) => hdImageUrl(url));
	}

	const total = Number(decoded.count) || images.length;
	logger.info(
		`[mzt] APP 接口成功：${images.length} 张（接口 count=${decoded.count}，` +
			`HD=${MZT_CONFIG.mzt_hd}，thumbs=${decoded.thumbs}）`,
	);

	return {
		articleId: String(articleId),
		title: decoded.title || "未知标题",
		publishTime: decoded.date || "未知时间",
		kind,
		imageUrls: images,
		total,
		// 注意：truncated 用"截断前"的张数比较，与 AstrBot 一致
		truncated: total > images.length,
		source: "app",
		// 潮拍馆图片在新浪图床（tva1.sinaimg.cn），有防盗链，需要 weibo.com Referer；
		// 写真馆 ap/ax.iimzt.com 不需要 Referer。
		referer: decoded.thumbs ? "https://weibo.com/" : null,
		pageUrl: albumUrl(articleId, kind),
	};
}

/**
 * 走网页接口 `{站点}/app/post/p?id=` 获取图片（base64 + AES-256-GCM）。
 *
 * 写真馆网页端被服务端限制为**前 20 张预览**，因此 total（来自文章页进度条）
 * 可能大于实际拿到的张数，此时 truncated=true。
 *
 * @param {string|number} articleId 文章 ID
 * @param {object} meta 文章页元信息（parseArticleHtml 的结果）
 * @param {string} kind 真实栏目
 * @returns {Promise<object>} 图集对象
 * @throws {Error} 接口请求/解密失败
 */
async function fetchWebAlbum(articleId, meta, kind) {
	const pageUrl = albumUrl(articleId, kind);
	const apiUrl = `${MZT_CONFIG.mzt_site.replace(
		/\/+$/,
		"",
	)}/app/post/p?id=${encodeURIComponent(articleId)}`;
	logger.info(`[mzt] GET 网页图片接口 ${apiUrl}`);

	const response = await httpGetBuffer(apiUrl, {
		headers: {
			Accept: API_ACCEPT,
			"X-Requested-With": "XMLHttpRequest",
			Referer: pageUrl,
			"User-Agent": randomUserAgent(),
		},
		timeout: HTTP_TIMEOUT,
	});
	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new Error(`网页接口 HTTP ${response.statusCode}`);
	}

	let payload;
	try {
		payload = JSON.parse(response.body.toString("utf8"));
	} catch (error) {
		throw new Error(`网页接口返回的不是 JSON：${error.message}`);
	}
	if (!payload || !payload.data) {
		throw new Error("网页接口没有 data 字段");
	}

	const decoded = decodeApiPayload(payload.data, articleId);

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
		imageUrls = (decoded.images || [])
			.filter(Boolean)
			.map((name) => prefix + name);
		referrerPolicy = meta.referrerPolicy;
		total = Number(meta.total) || 0;
	}

	const truncated = Boolean(total && imageUrls.length < total);
	logger.info(
		`[mzt] 网页接口解密得到 ${imageUrls.length} 张（页面总数 ${
			total || "未知"
		}${truncated ? "，受网页端 20 张预览限制" : ""}）`,
	);

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
 * 浏览器兜底：用 puppeteer 打开文章页，在页面内 fetch + WebCrypto 解密。
 *
 * @param {string|number} articleId 文章 ID
 * @param {string} kind 请求栏目（photo/beauty）
 * @returns {Promise<object>} 图集对象
 * @throws {Error} 浏览器启动/页面加载/页面内解密失败
 */
async function fetchAlbumBrowser(articleId, kind) {
	const pageUrl = albumUrl(articleId, kind);
	logger.info(`[mzt] 浏览器兜底：打开 ${pageUrl}`);

	let browser = null;
	let result;
	try {
		browser = await puppeteer.launch({
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
			headless: "new",
		});
		const page = await browser.newPage();
		await page.setUserAgent(randomUserAgent());
		await page.goto(pageUrl, {
			waitUntil: "domcontentloaded",
			timeout: 60000,
		});
		// page.evaluate 没有 deadline：页面内 fetch 卡住时整个指令会永久挂起，
		// 这里用总超时兜底，超时后由 finally 关闭浏览器。
		result = await withTimeout(
			page.evaluate(browserFetchDecrypt, String(articleId)),
			BROWSER_DECRYPT_TIMEOUT,
			`浏览器内解密超时（${BROWSER_DECRYPT_TIMEOUT}ms）`,
		);
	} finally {
		if (browser) await browser.close();
	}

	const meta = (result && result.meta) || {};
	const names = (result && result.names) || [];
	if (
		!Array.isArray(names) ||
		!names.every((name) => typeof name === "string")
	) {
		throw new Error("浏览器内解密结果不是字符串数组");
	}

	// 用 location.pathname 判断真实栏目（用户可能把潮拍链接当成写真馆发）
	const decodedPath = String(meta.path || "");
	let actualKind = kind;
	if (decodedPath.startsWith("/beauty/")) actualKind = "beauty";
	else if (decodedPath.startsWith("/photo/")) actualKind = "photo";

	const prefix = dirPrefix(meta.firstImage);
	const imageUrls = names.filter(Boolean).map((name) => prefix + name);
	const total = Number(meta.total) || 0;
	const truncated = Boolean(total && imageUrls.length < total);
	const referrerPolicy = String(meta.referrerPolicy || "origin");
	logger.info(`[mzt] 浏览器兜底解密得到 ${imageUrls.length} 张`);

	return {
		articleId: String(articleId),
		title: meta.title || "未知标题",
		publishTime: meta.publishTime || "未知时间",
		kind: actualKind,
		imageUrls,
		total,
		truncated,
		source: "browser",
		referer:
			referrerPolicy === "no-referrer" ? null : MZT_CONFIG.mzt_site,
		pageUrl,
	};
}

/**
 * 获取一个写真/潮拍图集（完整回退链）。
 *
 * 顺序与 AstrBot app_core/mzt.py 的 fetch_album 一致：
 * 1. APP 接口（全量，需要 mTLS 证书）；
 * 2. 文章页元信息（标题/时间/首图目录/总张数/真实栏目，失败不致命）；
 * 3. APP 失败且文章页可用 → 网页接口（写真馆仅前 20 张预览）；
 * 4. 两套直连都失败且允许兜底 → puppeteer 页面内 fetch + WebCrypto；
 * 5. 全部失败抛错，由调用方回复"连接网页失败"。
 *
 * @param {string|number} articleId 文章 ID
 * @param {string} kind 请求栏目（photo/beauty）
 * @returns {Promise<object>} 图集对象：
 *   {articleId, title, publishTime, kind, imageUrls, total, truncated,
 *    source, referer, pageUrl}
 * @throws {Error} 所有途径都失败（message 里带上各途径的错误原因）
 */
async function fetchAlbum(articleId, kind) {
	const id = String(articleId);
	const requestedKind = String(kind).toLowerCase() === "beauty"
		? "beauty"
		: "photo";
	const errors = [];

	// 1) APP 接口优先：全量图片，且不依赖文章页
	let appAlbum = null;
	try {
		appAlbum = await fetchAppAlbum(id, requestedKind);
	} catch (error) {
		errors.push(`APP 接口异常：${error.message}`);
	}
	if (!appAlbum) {
		// 具体原因 fetchAppAlbum 内部已打日志（403/非 JSON/解密失败/没有图片）；
		// 这里只保留一句汇总，供最终全部失败时拼进机器人回复。
		errors.push("APP 接口不可用");
	}

	// 2) 文章页元信息（失败不致命，APP 接口仍可用）
	let meta = null;
	try {
		meta = await fetchArticleMeta(id, requestedKind);
		logger.info(
			`[mzt] 文章页：标题=${meta.title}，时间=${meta.publishTime}，` +
				`类型=${meta.kind}，总数=${meta.total || "未知"}`,
		);
	} catch (error) {
		errors.push(`文章页失败：${error.message}`);
		logger.info(
			`[mzt] 文章页获取失败（${error.message}），继续尝试接口`,
		);
	}
	const actualKind = meta ? meta.kind : requestedKind;

	// 3) APP 成功：用文章页的标题/时间/真实栏目覆盖（页面拿不到时保留 APP 返回值）
	if (appAlbum) {
		if (meta) {
			if (meta.title) appAlbum.title = meta.title;
			if (meta.publishTime && meta.publishTime !== "未知时间") {
				appAlbum.publishTime = meta.publishTime;
			}
			appAlbum.kind = actualKind;
		}
		appAlbum.imageUrls = applyImageLimit(appAlbum.imageUrls);
		return appAlbum;
	}

	// 4) APP 失败且文章页可用 → 网页接口兜底（写真馆只有前 20 张预览）
	if (meta) {
		try {
			const webAlbum = await fetchWebAlbum(id, meta, actualKind);
			webAlbum.imageUrls = applyImageLimit(webAlbum.imageUrls);
			if (webAlbum.imageUrls.length > 0) return webAlbum;
			errors.push("网页接口没有返回图片");
		} catch (error) {
			errors.push(`网页接口失败：${error.message}`);
			logger.info(
				`[mzt] 网页接口失败（${error.message}），尝试浏览器兜底`,
			);
		}
	} else {
		errors.push("文章页不可用，无法调用网页接口");
	}

	// 5) 浏览器兜底（可在 MZT_CONFIG 里关闭）
	if (MZT_CONFIG.mzt_browser_fallback !== false) {
		try {
			const browserAlbum = await fetchAlbumBrowser(id, requestedKind);
			browserAlbum.imageUrls = applyImageLimit(browserAlbum.imageUrls);
			if (browserAlbum.imageUrls.length > 0) return browserAlbum;
			errors.push("浏览器兜底没有解密出图片");
		} catch (error) {
			errors.push(`浏览器兜底失败：${error.message}`);
			logger.info(`[mzt] 浏览器兜底失败：${error.message}`);
		}
	} else {
		errors.push("已禁用浏览器兜底（mzt_browser_fallback=false）");
	}

	throw new Error(errors.join("；") || "未知原因");
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
		const headers = {
			Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
			"User-Agent": randomUserAgent(),
		};
		if (referer) headers.Referer = referer;

		const response = await httpGetBuffer(imageUrl, {
			headers,
			timeout: DOWNLOAD_TIMEOUT,
			maxRedirects: MAX_REDIRECTS,
		});
		if (response.statusCode !== 200) {
			logger.warn(
				`[mzt] 下载图片失败（HTTP ${response.statusCode}）：${imageUrl.slice(0, 100)}`,
			);
			return null;
		}
		return response.body;
	} catch (error) {
		logger.warn(
			`[mzt] 下载图片出错：${error.message} - ${imageUrl.slice(0, 100)}`,
		);
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
			"⚠️ 网页接口仅提供前 20 张预览（APP 接口暂时不可用），完整图集需“美之图”APP",
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
	 * 从预定义的用户代理列表中随机获取一个
	 * @returns {string} 随机用户代理字符串
	 */
	getRandomUserAgent() {
		return randomUserAgent();
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
			logger.error(
				`[mzt] 解析文章 ${articleId}（${kind}）失败：${error.message}`,
			);
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
			browser = await puppeteer.launch({
				args: ["--no-sandbox", "--disable-setuid-sandbox"],
				headless: "new",
			});
			const page = await browser.newPage();
			await page.setUserAgent(this.getRandomUserAgent());

			while (!stop) {
				const url = pageNo === 1 ? baseUrl : `${baseUrl}page/${pageNo}/`;
				logger.info(`[增量] 拉取列表页 ${url}`);
				await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

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
