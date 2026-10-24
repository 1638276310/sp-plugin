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
	MAX_IDS_PER_COMMAND,
	albumDownloadUrls,
	applyImageLimit,
	buildAppApiUrl,
	parseArticleRefs,
	resolveCertCandidates as resolveCertCandidatesFromConfig,
} from "../lib/mzt-chain.js";
import {
	buildHeaders,
	clampStageText,
	cloudflareStageText,
	createRateLimiter,
	delay,
	describeError,
	detectCloudflare,
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

/* ------------------------------------------------------------------ *
 * 配置区（对应 AstrBot 版 _conf_schema.json 里的 mzt_* 配置项）
 *
 * 说明：TRSS-Yunzai 侧暂时不读插件配置文件，保持原插件"常量即配置"的风格；
 * 需要临时改行为时直接改这里的值即可（语义与 AstrBot 完全一致）。
 * ------------------------------------------------------------------ */

/**
 * 妹子图相关配置（对应 AstrBot 版 MZT_CONFIG，常量即配置）
 * @type {{mzt_site: string, mzt_app_api: string, mzt_hd: boolean,
 *         mzt_max_images: number, mzt_proxy: string, mzt_app_cert: string}}
 */
const MZT_CONFIG = {
	/** 站点根地址（仅用于 APP 请求的 Referer；抓取链路不再访问站点页面） */
	mzt_site: "https://kkmzt.com",
	/** 美之图 APP 接口根地址（去掉尾斜杠后拼 /post/p?id=<ID>；需要 mTLS 客户端证书） */
	mzt_app_api: "https://api.iimzt.com/app/",
	/** 是否请求 APP 端高清图：写真馆 ap→ax 重新签名，潮拍馆 mw1024→mw2000 */
	mzt_hd: false,
	/** 最多发送多少张；0 表示不限制（对应 AstrBot 的 mzt_max_images） */
	mzt_max_images: 0,
	/**
	 * APP 接口与图片下载统一代理，例如 `http://127.0.0.1:7890`；空=直连。
	 * socks 不支持（记录警告后降级直连）。临时改：直接改这里的值。
	 */
	mzt_proxy: "",
	/** APP 接口 mTLS 证书路径；只接受插件目录内相对路径，空=config/mzt_client.pem */
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
/** APP 接口请求超时（毫秒）—— 对齐 AstrBot fetch_album 默认 timeout=60 秒 */
const HTTP_TIMEOUT = 60000;
/** 最多跟随的重定向次数（APP 接口/图片 CDN 可能 301 到真实节点） */
const MAX_REDIRECTS = 3;

/** 图集类型 → 中文栏目名 */
const KIND_LABEL = { photo: "写真馆", beauty: "潮拍馆" };
/** 默认栏目：不写栏目时按写真馆处理 */
const DEFAULT_KIND = "photo";

/** 数据源 → 消息头里的中文标签（与 AstrBot AlbumInfo.source_label 一致） */
const SOURCE_LABEL = {
	app: "美之图 APP 接口（mTLS 解密，全量）",
};

/** 当前文件所在目录（ESM 没有 __dirname，用 import.meta.url 还原） */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.join(MODULE_DIR, "..");
/** 默认 mTLS 证书路径（注意不能用 process.cwd()：Bot 根目录不是插件目录） */
const DEFAULT_CLIENT_CERT_PATH = path.join(PLUGIN_ROOT, "config", "mzt_client.pem");

/** mTLS 证书缓存：只读一次文件（进程内复用，避免每次请求都读盘） */
let clientCertificateState = null;

/** 日志用证书路径：插件内显示相对路径，插件外只显示文件名（绝不打印内容）。 */
function displayCertPath(filePath) {
	const relative = path.relative(PLUGIN_ROOT, filePath);
	return relative && !relative.startsWith("..") ? relative.split(path.sep).join("/") : path.basename(filePath);
}

/** 证书候选路径：配置值必须为插件目录内相对路径；空 = 默认 config/mzt_client.pem。 */
function resolveCertCandidates() {
	const result = resolveCertCandidatesFromConfig({
		configured: MZT_CONFIG.mzt_app_cert,
		pluginRoot: PLUGIN_ROOT,
		defaultCertPath: DEFAULT_CLIENT_CERT_PATH,
	});
	if (result.rejected) {
		logger.warn(`[mzt] stage=cert path=<configured> state=rejected reason=${result.rejected}`);
	}
	return result.candidates;
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
		`url=${sanitizeUrl(url)}`,
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
						`url=${sanitizeUrl(url)}`,
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
	if (state.certInvalid) hints.push("检查 config/mzt_client.pem 是否为官方 APP 证书且随插件一起上传");
	if (state.cloudflare) hints.push("APP 接口被 Cloudflare 拒绝时，先确认 mTLS 证书有效");
	if (state.proxyConfigured && proxyFailureSeen) hints.push("代理不可用，已自动降级直连");
	if (hints.length === 0) hints.push("请检查网络或稍后重试");
	return hints.slice(0, 2).join("；");
}

/* ------------------------------------------------------------------ *
 * 图集获取：ID → APP 接口（mTLS）→ 内置解密 → 图片 URL
 * ------------------------------------------------------------------ */

/**
 * APP 接口（mTLS + hex/AES-128-CBC）获取全量图集；证书无效/接口失败抛 stage 错误。
 *
 * @param {string|number} articleId 文章 ID
 * @param {string} kind 栏目（photo/beauty）
 * @param {object} proxy 已解析代理配置
 * @returns {Promise<object>} 成功返回图集；未配置/证书无效/接口失败抛 MztStageError
 * @throws {MztStageError}
 */
async function fetchAppAlbum(articleId, kind, proxy) {
	const apiUrl = buildAppApiUrl(MZT_CONFIG.mzt_app_api, articleId);
	if (!apiUrl) {
		logger.info("[mzt] stage=app skipped=config");
		throw new MztStageError("APP接口", "未配置 mzt_app_api", { code: "config" });
	}
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
	const status = response.statusCode || 0;
	const rayId = cf?.rayId || extractRayId(response.headers || {}, response.body) || "-";
	if (cf?.blocked || status < 200 || status >= 300) {
		throw stageErrorForResponse("APP接口", response, cf);
	}

	let payload;
	try {
		payload = JSON.parse(response.body.toString("utf8"));
	} catch {
		throw new MztStageError("APP接口", "返回的不是 JSON", { status, cf });
	}
	if (!payload?.data) {
		throw new MztStageError("APP接口", "返回格式异常（缺少 data）", { status, cf });
	}
	let decoded;
	try {
		decoded = decodeApiPayload(payload.data, articleId);
	} catch {
		logger.info(`[mzt] stage=decrypt id=${articleId} state=failed status=${status} cf-ray=${rayId}`);
		throw new MztStageError("APP接口", "数据解密失败", { status, cf });
	}
	if (decoded.scheme !== "app") {
		throw new MztStageError("APP接口", "返回了网页端加密格式", { status, cf });
	}

	let images = (decoded.images || []).filter(Boolean);
	const count = Number(decoded.count) || 0;
	logger.info(
		`[mzt] stage=decrypt id=${articleId} state=ok scheme=${decoded.scheme} ` +
			`count=${count} images=${images.length} status=${status} cf-ray=${rayId}`,
	);
	if (images.length === 0) {
		// 解密成功但列表为空/数量异常：记录 kind（scheme）/状态码/ray，明确报错，绝不改走其它链路
		logger.info(
			`[mzt] stage=decrypt id=${articleId} state=empty kind=${decoded.scheme} ` +
				`count=${count} status=${status} cf-ray=${rayId}`,
		);
		throw new MztStageError("APP接口", "解密返回图片列表为空", { status, cf });
	}
	if (count && images.length !== count) {
		logger.info(
			`[mzt] stage=decrypt id=${articleId} state=count-mismatch count=${count} ` +
				`images=${images.length} status=${status} cf-ray=${rayId}`,
		);
	}
	if (MZT_CONFIG.mzt_hd) {
		images = decoded.thumbs ? images.map(hdBeautyImageUrl) : images.map(hdImageUrl);
	}
	const total = count || images.length;
	logger.info(`[mzt] stage=app decoded=${images.length} count=${count} hd=${MZT_CONFIG.mzt_hd} thumbs=${decoded.thumbs}`);
	logger.info(`[mzt] chain=app+decrypt id=${articleId} kind=${kind} images=${images.length} total=${total}`);

	return {
		articleId: String(articleId),
		title: decoded.title || "未知标题",
		publishTime: decoded.date || "未知时间",
		kind,
		imageUrls: images,
		total,
		// 截断标记在 fetchAlbum 按 mzt_max_images 截断后重算（与 AstrBot 版一致）
		truncated: false,
		source: "app",
		// 潮拍馆图片在新浪图床，有防盗链需要 weibo.com Referer；写真馆不需要
		referer: decoded.thumbs ? "https://weibo.com/" : null,
		pageUrl: apiUrl,
	};
}

/**
 * 获取一个写真/潮拍图集（唯一链路，与 AstrBot 版一致）：
 * 指令 ID → APP 接口（mTLS）→ 内置解密 → 完整图片 URL；
 * 失败直接抛 MztFetchError（带 stageErrors/hint），不再回退网页/浏览器/首图。
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

	// 唯一阶段：APP 接口（mTLS，全量）→ 内置解密
	try {
		const album = await fetchAppAlbum(id, requestedKind, proxy);
		if (album && album.imageUrls.length > 0) {
			album.imageUrls = applyImageLimit(album.imageUrls, MZT_CONFIG.mzt_max_images);
			album.truncated = Boolean(album.total && album.imageUrls.length < album.total);
			logResult(album);
			return album;
		}
		errors.push("APP接口:未返回任何图片");
	} catch (error) {
		recordStageError(errors, error);
		noteStageFailure(state, error);
	}

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
			headers: buildHeaders("image", { referer }),
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
		lines.push(`⚠️ 已按配置 mzt_max_images 截断，仅发送前 ${album.imageUrls.length} 张`);
	}
	return lines.join("\n");
}

/**
 * 妹子图图片提取插件
 * @class mztPlugin
 * @classdesc 从妹子图网站提取写真、潮拍和模特图片的插件
 *
 * 功能包括：
 * 1. 根据 ID/链接获取写真馆图集（唯一链路：APP 接口 + 内置解密，无网页/浏览器回退）
 * 2. 根据 ID/链接获取潮拍馆图集（APP 接口全量）
 * 3. 支持多个 ID 逐个获取；#更新写真ID 已停用（仅提示导入本地列表）
 * 4. 随机获取写真图片（ID 来自 data/sp-plugin/mztids.json）
 *
 * 支持 NapCat.Onebot 的特殊转发格式
 *
 * @property {string} name - 插件名称
 * @property {string} dsc - 插件描述
 * @property {string} event - 监听事件
 * @property {number} priority - 优先级
 * @property {Array} rule - 命令规则
 * @property {Array} mztIds - 存储写真ID的数组
 *
 * @example
 * // 使用示例：
 * // #写真馆12345  /  #写真馆 12345  /  #写真馆 171317 171318
 * // #潮拍馆191566
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
					// 兼容 #写真馆12345、#写真馆 12345、#写真馆 171317 171318（多 ID 逐个处理）
					reg: "^#?写真馆\\s*(.+)$",
					fnc: "processmztRequest",
				},
				{
					// 潮拍馆（与写真馆共用链路，栏目固定为 beauty）
					reg: "^#?潮拍馆\\s*(.+)$",
					fnc: "processBeautyRequest",
				},
				{
					// 已停用：仅提示如何导入本地 ID 列表（不再直连列表页）
					reg: "^#?更新写真(ID|id)$",
					fnc: "fetchAllmztArticleIds",
				},
				{
					reg: "^#?随机写真$",
					fnc: "randommztRequest",
				},
			],
		});

		// 不再注册定时任务：写真 ID 列表改为本地 mztids.json 导入（列表页直连已移除）
		this.task = [];

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
				logger.info("写真ID文件不存在：请手动放入 data/sp-plugin/mztids.json（不再自动抓取列表页）");
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
			await e.reply("写真ID列表为空：请把 mztids.json 放入 data/sp-plugin 后重载插件，或直接使用 #写真馆 <ID>", true);
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
	 * 处理写真馆请求（支持多个 ID 逐个处理；链接里的栏目优先）
	 * @param {Object} e - 消息事件对象
	 * @param {boolean} [skipTip=false] - 是否跳过"正在搜索"提示
	 * @async
	 * @returns {Promise<void>}
	 */
	async processmztRequest(e, skipTip = false) {
		const refs = parseArticleRefs(e.msg, "photo");
		if (refs.length === 0) {
			await e.reply(
				"请补充写真 ID 或链接，例如：#写真馆 171317\n一次多个：#写真馆 171317 171318",
				true,
			);
			return;
		}
		await this.sendMztAlbums(e, refs, skipTip);
	}

	/**
	 * 处理潮拍馆请求（栏目固定为 beauty，支持多个 ID）
	 * @param {Object} e - 消息事件对象
	 * @param {boolean} [skipTip=false] - 是否跳过"正在搜索"提示
	 * @async
	 * @returns {Promise<void>}
	 */
	async processBeautyRequest(e, skipTip = false) {
		const refs = parseArticleRefs(e.msg, "beauty").map((ref) => ({ ...ref, kind: "beauty" }));
		if (refs.length === 0) {
			await e.reply(
				"请补充潮拍馆 ID 或链接，例如：#潮拍馆 191566\n一次多个：#潮拍馆 191566 191567",
				true,
			);
			return;
		}
		await this.sendMztAlbums(e, refs, skipTip);
	}

	/**
	 * 按解析结果逐个发送图集（超过 MAX_IDS_PER_COMMAND 时截断并提示）。
	 * @param {Object} e - 消息事件对象
	 * @param {Array<{articleId: string, kind: string}>} refs - 解析结果
	 * @param {boolean} skipTip - 是否跳过提示
	 * @async
	 * @returns {Promise<void>}
	 */
	async sendMztAlbums(e, refs, skipTip) {
		let list = refs;
		if (list.length > MAX_IDS_PER_COMMAND) {
			await e.reply(
				`一次最多处理 ${MAX_IDS_PER_COMMAND} 个 ID，已截取前 ${MAX_IDS_PER_COMMAND} 个。`,
				true,
			);
			list = list.slice(0, MAX_IDS_PER_COMMAND);
		}
		if (!skipTip) {
			await e.reply(
				list.length === 1
					? "正在搜索，请稍等..."
					: `共 ${list.length} 个图集，逐个获取，请稍等...`,
				false,
				{ at: true, recallMsg: 60 },
			);
		}
		for (let index = 0; index < list.length; index += 1) {
			const ref = list[index];
			if (list.length > 1) {
				await e.reply(`[${index + 1}/${list.length}] 图集 ID：${ref.articleId}`, false, {
					at: true,
				});
			}
			await this.sendMztAlbum(e, ref.articleId, ref.kind);
		}
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
			await e.reply(`获取图集失败，请稍后再试（${error.message}）`, true);
			return;
		}

		// 下载只以解密返回的图片 URL 为准
		const urls = albumDownloadUrls(album);
		if (urls.length === 0) {
			logger.warn(`[mzt] 文章 ${articleId} 没有解析到图片`);
			await e.reply("没有找到任何图片，请稍后再试。", true);
			return;
		}

		logger.info(
			`[mzt] 文章 ${articleId}：${urls.length}/${
				album.total || "未知"
			} 张，数据源=${album.source}，预览截断=${album.truncated}，` +
				`referer=${album.referer}`,
		);

		// 1) 先按图集自带的 Referer 下载
		let results = await downloadImages(urls, album.referer);
		let successCount = results.filter((item) => item.base64).length;

		// 2) 全部失败：图床 Referer 策略可能随站点调整，换成"相反"策略重试一次
		//    （网页端 → 不带 Referer；App/浏览器端 → 带站点 Referer）
		if (successCount === 0) {
			const altReferer =
				album.referer === MZT_CONFIG.mzt_site ? null : MZT_CONFIG.mzt_site;
			logger.info(
				`[mzt] 文章 ${articleId} 首次下载全部失败，改用 referer=${altReferer} 重试`,
			);
			results = await downloadImages(urls, altReferer);
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
	 * 已停用的列表页抓取入口：保留指令用于提示，不再访问站点列表页。
	 * @param {Object|null} e - 消息事件对象（定时任务时为 null）
	 * @async
	 * @returns {Promise<void|boolean>}
	 */
	async fetchAllmztArticleIds(e) {
		// 权限检查
		if (e && !e.isMaster) {
			await e.reply("仅主人可用", true);
			return true;
		}
		const message =
			"该指令已停用：插件不再直连 kkmzt 列表页（Cloudflare 403）。" +
			"请把 mztids.json 放入 data/sp-plugin 后重载插件；" +
			"单个图集请直接用 #写真馆 <ID> 或 #潮拍馆 <ID>。";
		if (e) await e.reply(message, true);
		else logger.info(`[定时任务] ${message}`);
	}
}
