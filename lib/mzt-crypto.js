/**
 * kkmzt（美之图）图片接口解密 —— Node.js 版（对应 AstrBot 版
 * ``astrbot_plugin_sp/app_core/mzt_crypto.py``）。
 *
 * 站点对同一路径 ``app/post/p?id=<文章ID>`` 提供了两套接口：域名不同、加密方式不同，
 * 返回的图片数量也不同。下面的结论来自对官方 Android APP 的逆向分析，以及网页端
 * 接口的实际抓包验证（详细说明见 AstrBot 仓的 app_core/mzt_crypto.py 文件头注释）：
 *
 * 1. **网页端** ``GET {站点}/app/post/p?id=<文章ID>``（kkmzt.com）
 *    * ``raw = base64decode(data)``；
 *    * ``salt = raw[0:16]``、``iv = raw[16:28]``、``密文 + 16 字节 GCM tag = raw[28:]``；
 *    * ``key = HKDF-SHA256(ikm = str(文章ID), salt, info = b"", length = 32)``；
 *    * 解密算法是 **AES-256-GCM**（tag 在密文末尾，Node 侧需要单独 setAuthTag）；
 *    * 明文是 JSON **字符串数组**（图片文件名，不含目录）；
 *    * 写真馆（/photo/）网页接口被服务端限制为**前 20 张预览**，页面上
 *      "预览结束，安装美之图APP，免费观赏全片" 就是这条限制。
 *
 * 2. **APP 端** ``GET https://api.iimzt.com/app/post/p?id=<文章ID>``
 *    * 逆向自官方 Android APP（美之图 3.8.7，APICloud 混合应用，widget JS 已解出）；
 *    * **必须携带 APP 内置的 mTLS 客户端证书**：APK 内 ``assets/widget/res/config``
 *      是 PKCS#12，密码在解密后的 ``res/key.xml``，APP 启动时通过
 *      ``api.applyCertificates`` 安装。没有证书时 Cloudflare 直接返回 403；
 *    * 响应同样是 ``{"data": "<payload>"}``，但 payload 是 **hex 字符串**；
 *    * hex 解码后是 **AES-128-CBC/PKCS7** 密文：
 *      - ``key = md5(str(文章ID)).hexdigest()[8:24]``（16 个 ASCII 字符，见 appCbcKey）；
 *      - ``iv = b"0809060801020609"``（来自 APP 解密后的 ``res/key.xml``）；
 *    * 明文是 JSON **对象**：``{"id", "date", "title", "count", "thumbs", "images", ...}``；
 *      ``images`` 是带 ``?sign=`` 的完整图片 URL（如 ``https://ap.iimzt.com/...jpg``），
 *      ``count`` 即全量张数（写真馆也是全量 —— 这正是网页端只有 20 张的根因）；
 *    * 图片 CDN（ap/ax.iimzt.com）本身不需要客户端证书。
 *
 * 高清图（APP 的 toggleHD）同样逆向自 ``pages/page/view.js``：
 *   * 写真馆：``https://ap.iimzt.com/....jpg`` → ``https://ax.iimzt.com/....jpg``，
 *     并重新生成 ``?sign=base64url_nopad(md5("auavax" + path))``（见 hdImageUrl）；
 *   * 潮拍馆（响应带 ``thumbs`` 列表，图片在新浪图床）：``mw1024`` → ``mw2000``，
 *     无需签名（见 hdBeautyImageUrl）。
 *
 * 本文件只依赖 Node 内置的 ``node:crypto``（Node 18+ 已提供 ``hkdfSync``；
 * AES-GCM / AES-CBC / MD5 由 OpenSSL 实现），不引入任何外部依赖，也不执行
 * 网络请求 —— 网络与回退链在 apps/mzt.js 里。
 */

import { Buffer } from "node:buffer";
import { createDecipheriv, createHash, hkdfSync } from "node:crypto";

/**
 * 接口数据解密失败。
 *
 * 对应 AstrBot 版 ``mzt_crypto.KkmztDecryptError``：decodeApiPayload 会把每种
 * 方案的错误收集起来，最后统一抛出，方便定位是编码猜错还是密钥/数据不匹配。
 */
export class KkmztDecryptError extends Error {
	/**
	 * @param {string} message 错误描述（中文，会带进机器人回复里）
	 */
	constructor(message) {
		super(message);
		this.name = "KkmztDecryptError";
	}
}

/** APP 端 AES-128-CBC 的固定 IV：16 个 ASCII 字节 ``0809060801020609``。 */
const APP_IV = Buffer.from("0809060801020609", "utf8");

/** 写真馆高清签名前缀（APP 里 ``b64_md5("auavax" + path)`` 的固定盐）。 */
const APP_AXKEY = Buffer.from("auavax", "utf8");

/** 高清域名标记：URL 的域名或路径里出现 ``/ap`` 才需要换成 ``/ax``。 */
const APP_HIGH_RES_MARK = "/ap";

/** 网页端加密数据的最小长度：16 salt + 12 iv + 至少 1 字节密文 + 16 tag。 */
const WEB_MIN_RAW_LENGTH = 45;

/**
 * 把 Buffer / TypedArray / ArrayBuffer / string 统一转成 Buffer。
 *
 * @param {Buffer|Uint8Array|ArrayBuffer|string} value 待转换的值
 * @returns {Buffer}
 */
function toBuffer(value) {
	if (Buffer.isBuffer(value)) return value;
	if (ArrayBuffer.isView(value)) {
		return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	}
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	if (typeof value === "string") return Buffer.from(value, "utf8");
	throw new TypeError("mzt-crypto: 期望 Buffer/TypedArray/ArrayBuffer/string");
}

/**
 * APP 端 AES-128-CBC 密钥：``md5(str(文章ID))`` 的十六进制串取 ``[8:24]``，
 * 得到 16 个 ASCII 字符（16 字节），与 APP 的 ``res/key.xml`` 算法一致。
 *
 * @param {string|number} articleId 文章 ID
 * @returns {Buffer} 16 字节密钥
 */
export function appCbcKey(articleId) {
	const digest = createHash("md5").update(String(articleId), "utf8").digest("hex");
	return Buffer.from(digest.slice(8, 24), "ascii");
}

/**
 * HKDF-SHA256 派生密钥（RFC 5869）。
 *
 * 站点只用到一次 Expand（长度 32），直接调用 Node 内置实现；返回 Buffer 方便
 * 后续传给 createDecipheriv / setAuthTag。
 *
 * @param {Buffer|Uint8Array|ArrayBuffer|string} ikm 输入密钥材料（网页端是文章ID的字符串）
 * @param {Buffer|Uint8Array|ArrayBuffer|string} salt 盐（网页端是响应前 16 字节）
 * @param {Buffer|Uint8Array|ArrayBuffer|string} [info=Buffer.alloc(0)] 上下文信息（本站为空）
 * @param {number} [length=32] 期望输出长度
 * @returns {Buffer}
 */
export function hkdfSha256(ikm, salt, info = Buffer.alloc(0), length = 32) {
	const derived = hkdfSync(
		"sha256",
		toBuffer(ikm),
		toBuffer(salt),
		toBuffer(info),
		length,
	);
	return Buffer.from(derived);
}

/**
 * 按 Python ``bool(value)`` 的语义判断真值。
 *
 * 与 JS 的 ``Boolean()`` 有一处关键差异：JS 里空数组/空对象是 **true**，
 * 而 Python 的 ``bool([])`` / ``bool({})`` 是 **false**。APP 接口的潮拍馆
 * 响应里 ``thumbs`` 可能是空数组，如果按 JS 语义判断就会误以为"带 thumbs"
 * 而错误地把高清处理从 ax 签名换成 mw2000，所以这里显式对齐 Python。
 *
 * @param {*} value JSON 反序列化得到的值
 * @returns {boolean}
 */
function pythonTruthy(value) {
	if (value === null || value === undefined) return false;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") return value.length > 0;
	if (Array.isArray(value) || ArrayBuffer.isView(value)) return value.length > 0;
	if (value instanceof Map || value instanceof Set) return value.size > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	return Boolean(value);
}

/**
 * 按 Python ``int(value)`` 的语义取整（失败返回 0）。
 *
 * 用 ``Number()`` 而不是 ``parseInt()``：``Number("12abc")`` 是 NaN（对应 Python
 * ``int("12abc")`` 抛 ValueError），``Number(true)`` 是 1（对应 ``int(True)``），
 * 都和 ``int()`` 更接近；浮点数按 ``int()`` 的规则向零截断。
 *
 * @param {*} value 待转换的值
 * @returns {number}
 */
function toInteger(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return 0;
	return Math.trunc(number);
}

/**
 * 网页端 base64 解码。
 *
 * Node 的 base64 解码器比 Python 宽松（会自动忽略非法字符、兼容 URL-safe 字母表），
 * 这里仍按 Python 版补齐 ``=`` 填充，并把"解出来是空"视为非法，避免空 payload
 * 被当成合法密文继续走解密流程。
 *
 * @param {string} data 接口返回的 data 字段（base64）
 * @returns {Buffer}
 * @throws {KkmztDecryptError} data 为空或解码结果为空
 */
function decodeBase64(data) {
	const text = String(data ?? "").trim();
	if (!text) throw new KkmztDecryptError("接口返回的 data 为空");
	// base64 长度必须是 4 的倍数，Python 版同样补 '='
	const padded = text + "=".repeat((4 - (text.length % 4)) % 4);
	let raw = Buffer.from(padded, "base64");
	if (raw.length === 0) {
		// 兼容 URL-safe 字母表（Node 的 'base64' 解码器一般已兼容，这里兜底）
		raw = Buffer.from(padded, "base64url");
		if (raw.length === 0) {
			throw new KkmztDecryptError("data 不是合法 base64");
		}
	}
	return raw;
}

/**
 * 网页端解密：salt16 + iv12 + (密文 + 16 字节 GCM tag)，AES-256-GCM，
 * 明文是图片文件名（字符串）数组。
 *
 * Node 的 GCM 解密接口要求 tag 单独传给 setAuthTag，因此需要按 16 字节切开；
 * 认证失败（密钥/数据不匹配）会在 decipher.final() 抛出，统一包装成中文错误。
 *
 * @param {Buffer} raw base64 解码后的原始字节
 * @param {string} articleId 文章 ID（作为 HKDF 的 ikm）
 * @returns {string[]} 图片文件名列表
 * @throws {KkmztDecryptError}
 */
function decryptWebNames(raw, articleId) {
	if (raw.length < WEB_MIN_RAW_LENGTH) {
		throw new KkmztDecryptError(`网页端加密数据长度异常：${raw.length}`);
	}
	const salt = raw.subarray(0, 16);
	const iv = raw.subarray(16, 28);
	const encrypted = raw.subarray(28);
	const tag = encrypted.subarray(encrypted.length - 16);
	const ciphertext = encrypted.subarray(0, encrypted.length - 16);
	const key = hkdfSha256(String(articleId), salt);

	let plaintext;
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	} catch (error) {
		throw new KkmztDecryptError(`AES-GCM 解密失败：${error.message}`);
	}

	let names;
	try {
		names = JSON.parse(plaintext.toString("utf8"));
	} catch (error) {
		throw new KkmztDecryptError(`网页端解密结果不是合法 JSON：${error.message}`);
	}
	if (!Array.isArray(names) || !names.every((item) => typeof item === "string")) {
		throw new KkmztDecryptError("网页端解密结果不是字符串数组");
	}
	return names;
}

/**
 * APP 端解密：AES-128-CBC/PKCS7，明文是图片信息对象。
 *
 * @param {Buffer} raw hex 解码后的密文（长度必须是 16 的倍数）
 * @param {string} articleId 文章 ID（决定 appCbcKey）
 * @returns {{images: string[], count: number, title: string, date: string,
 *            hd: boolean, thumbs: boolean}}
 * @throws {KkmztDecryptError}
 */
function decryptAppObject(raw, articleId) {
	if (raw.length < 16 || raw.length % 16 !== 0) {
		throw new KkmztDecryptError(`APP 端加密数据长度异常：${raw.length}`);
	}
	const key = appCbcKey(articleId);

	let plaintext;
	try {
		// autoPadding 默认开启：PKCS7 填充非法时最终会在 final() 抛错
		const decipher = createDecipheriv("aes-128-cbc", key, APP_IV);
		plaintext = Buffer.concat([decipher.update(raw), decipher.final()]);
	} catch (error) {
		throw new KkmztDecryptError(`AES-CBC 解密失败：${error.message}`);
	}

	let data;
	try {
		data = JSON.parse(plaintext.toString("utf8"));
	} catch (error) {
		throw new KkmztDecryptError(`APP 端解密结果不是合法 JSON：${error.message}`);
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new KkmztDecryptError("APP 端解密结果不是 JSON 对象");
	}

	// 与 AstrBot 一致：images 按 Python 真值语义处理（空 dict/空串视为没有图片），
	// 丢掉空串，count 为 0/非法时回退 images.length
	const rawImages = pythonTruthy(data.images) ? data.images : [];
	if (
		!Array.isArray(rawImages) ||
		!rawImages.every((item) => typeof item === "string")
	) {
		throw new KkmztDecryptError("APP 端解密结果缺少合法的 images 数组");
	}
	// 与 AstrBot 一致：返回前丢掉空串，但 count 回退用的是**过滤前**的数组长度
	// （mzt_crypto.py 的 ``count or len(images)`` 里 images 仍是原始数组）。
	const images = rawImages.filter(Boolean);
	const count = toInteger(pythonTruthy(data.count) ? data.count : 0);
	return {
		images,
		count: count || rawImages.length,
		title: pythonTruthy(data.title) ? String(data.title) : "",
		date: pythonTruthy(data.date) ? String(data.date) : "",
		hd: pythonTruthy(data.hd),
		// 潮拍馆响应带 thumbs 列表：此时高清是 mw1024 -> mw2000，而不是 ax 签名
		thumbs: pythonTruthy(data.thumbs),
	};
}

/**
 * 把接口 ``data`` 字段还原成候选密文字节。
 *
 * * APP 端是 **hex** 字符串；
 * * 网页端是 **base64** 字符串。
 *
 * 顺序与 AstrBot 一致：先按"看起来像 hex"（偶数长度且全 hex）尝试 hex，再尝试
 * base64，避免把恰好由 hex 字符组成的 base64 误判成 hex（反之亦然）。
 *
 * @param {string} payload 接口返回的 data 字段
 * @returns {Array<{encoding: string, raw: Buffer}>}
 * @throws {KkmztDecryptError} 两种编码都解不出来
 */
function payloadCandidates(payload) {
	const text = String(payload ?? "").trim();
	const candidates = [];
	if (text && text.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(text)) {
		candidates.push({ encoding: "hex", raw: Buffer.from(text, "hex") });
	}
	try {
		candidates.push({ encoding: "base64", raw: decodeBase64(text) });
	} catch {
		// base64 解不出来就只保留 hex 候选；下面统一判断是否为空
	}
	if (candidates.length === 0) {
		throw new KkmztDecryptError("接口 data 既不是合法的 hex 也不是合法的 base64");
	}
	return candidates;
}

/**
 * 自动识别网页端（base64 + AES-256-GCM）与 APP 端（hex + AES-128-CBC）两种格式
 * 并解密 —— 等价 AstrBot 的 ``decode_api_payload``。
 *
 * 识别策略与 AstrBot 完全一致：
 * 1. 每种编码先解出字节；
 * 2. 若字节长度是 16 的倍数，先试 APP 端（CBC 密文必然满足），否则先试网页端；
 * 3. 一种方案失败就换另一种；所有组合都失败时抛出汇总了各方案错误的 Error。
 *
 * @param {string} payload 接口返回的 data 字段（hex 或 base64）
 * @param {string|number} articleId 文章 ID
 * @returns {{scheme: "app"|"web", images: string[], count: number,
 *            title: string, date: string, hd: boolean, thumbs: boolean}}
 *   - scheme 为 "app" 时 images 是完整 URL、count 是全量张数；
 *   - scheme 为 "web" 时 images 是文件名、count 未知（0）。
 * @throws {KkmztDecryptError}
 */
export function decodeApiPayload(payload, articleId) {
	const id = String(articleId);
	const errors = [];

	for (const { encoding, raw } of payloadCandidates(payload)) {
		// APP 端 CBC 密文长度必为 16 的倍数；网页端 GCM 偶尔也可能碰巧满足，
		// 所以先按长度猜顺序，失败再换另一种格式重试。
		const schemes = raw.length % 16 === 0 ? ["app", "web"] : ["web", "app"];
		for (const scheme of schemes) {
			try {
				if (scheme === "app") {
					const data = decryptAppObject(raw, id);
					return {
						scheme: "app",
						images: data.images,
						count: data.count,
						title: data.title,
						date: data.date,
						hd: data.hd,
						thumbs: data.thumbs,
					};
				}
				const names = decryptWebNames(raw, id);
				return {
					scheme: "web",
					images: names,
					count: 0,
					title: "",
					date: "",
					hd: false,
					thumbs: false,
				};
			} catch (error) {
				errors.push(`${encoding}/${scheme}: ${error.message}`);
			}
		}
	}

	throw new KkmztDecryptError(
		`无法识别/解密接口数据（${errors.slice(0, 6).join("；")}）`,
	);
}

/**
 * 与 APP 中 ``b64_md5().replace(...)`` 等价的 base64url（无填充）MD5。
 *
 * @param {Buffer} data 待摘要数据
 * @returns {string} base64url 字符串（去掉 '='，'+'→'-'、'/'→'_'）
 */
function base64UrlMd5(data) {
	return createHash("md5")
		.update(data)
		.digest("base64")
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}

/**
 * 拆出 URL 的 base（协议+域名）与 path（不含 query/fragment）。
 *
 * 仅在 ``hdImageUrl`` 的正则没命中时兜底使用（正则要求域名以 ``.com`` 结尾），
 * 等价 AstrBot 版里的 ``urlsplit`` 分支。
 *
 * @param {string} url
 * @returns {{base: string, path: string}|null}
 */
function splitHttpUrl(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (!parsed.protocol || !parsed.host) return null;
	return { base: `${parsed.protocol}//${parsed.host}`, path: parsed.pathname };
}

/**
 * APP 端写真馆高清图：``https://ap.iimzt.com/....jpg`` → ``https://ax.iimzt.com/....jpg``
 * 并按 ``base64url_nopad(md5("auavax" + path))`` 重新生成 ``?sign=``。
 *
 * 等价 APP 的 ``toggleHD``（正则 ``/https.*\.com(.*\.jpg)/i``）。域名或路径里不含
 * ``/ap`` 的图片（例如潮拍馆的新浪图床）原样返回。
 *
 * @param {string} normalUrl APP 接口返回的普通图 URL
 * @returns {string} 高清图 URL
 */
export function hdImageUrl(normalUrl) {
	const url = String(normalUrl ?? "");
	// 与 Python 的 re.match 一致：必须从字符串开头匹配（^ 锚定），
	// 避免把 "foo https://ap.iimzt.com/a.jpg" 这类夹带前缀的输入也改写。
	const match = /^(https.*\.com)(.*\.jpg)/i.exec(url);

	let base;
	let pathPart;
	if (match) {
		base = match[1];
		pathPart = match[2];
	} else {
		// 兜底：域名不是 .com（理论上不会出现）
		const split = splitHttpUrl(url);
		if (!split || !/\.jpg$/i.test(split.path)) return url;
		base = split.base;
		pathPart = split.path;
	}

	// 只有 ap 域名（或路径里带 /ap）才有对应的 ax 高清源
	if (
		!base.toLowerCase().includes(APP_HIGH_RES_MARK) &&
		!pathPart.toLowerCase().includes(APP_HIGH_RES_MARK)
	) {
		return url;
	}

	// 签名算法与 APP 一致：md5("auavax" + path)，再做 base64url 去填充
	const sign = base64UrlMd5(
		Buffer.concat([APP_AXKEY, Buffer.from(pathPart, "utf8")]),
	);
	return base.replace("/ap", "/ax") + pathPart + `?sign=${sign}`;
}

/**
 * APP 端潮拍馆高清图：``mw1024`` → ``mw2000``（新浪图床，无需签名）。
 *
 * 注意 Python 的 ``str.replace`` 是替换全部出现，这里用全局正则保持一致。
 *
 * @param {string} normalUrl APP 接口返回的普通图 URL
 * @returns {string} 高清图 URL
 */
export function hdBeautyImageUrl(normalUrl) {
	return String(normalUrl ?? "").replace(/mw1024/g, "mw2000");
}
