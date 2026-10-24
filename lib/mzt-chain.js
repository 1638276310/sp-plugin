import path from "node:path";

/**
 * 妹子图抓取链路里的纯函数工具（不发起网络请求，便于离线自检）。
 *
 * 对应 AstrBot 版 app_core/mzt.py 中与网络无关的部分：
 * * 指令文本 → 文章 ID（支持一次多个 ID）；
 * * ID → APP 接口 URL 模板；
 * * 图片数量截断与"下载只使用解密返回的 URL"的契约；
 * * mTLS 证书候选路径（只接受插件目录内的相对路径）。
 */

/** 默认栏目：不写栏目时按写真馆处理 */
export const DEFAULT_KIND = "photo";

/** 单条指令最多处理的图集数量（防止一次下载过多） */
export const MAX_IDS_PER_COMMAND = 10;

// 链接优先，其次“写真馆/潮拍馆 + 一串数字”；与 AstrBot 版 _REF_PATTERN 一致。
const REF_PATTERN =
	/https?:\/\/\S*?\/(photo|beauty)\/(\d{1,12})|(写真馆|潮拍馆)((?:[ \t,，、;；/]*\d{1,12})+)/gi;
const DIGIT_PATTERN = /\d{1,12}/g;
// 兼容旧用法：整条消息只有裸 ID 时的兜底（与旧版裸 ID 正则一致）
const BARE_ID_PATTERN = /(?<![\d/])(\d{2,12})(?![\d/])/g;

/**
 * 从指令文本提取全部 {articleId, kind}，按出现顺序去重。
 *
 * 支持：
 * * 链接：`https://kkmzt.com/photo/171317`、`.../beauty/191566`（只解析路径里的 ID）；
 * * 指令关键字：`#写真馆 171317 171318`、`#潮拍馆 191566`，
 *   数字之间可用空格/逗号/顿号/分号/斜杠分隔；
 * * 裸 ID：整条消息没有链接和关键字时，按 defaultKind 兼容旧用法。
 *
 * @param {string} text 用户消息文本
 * @param {"photo"|"beauty"} [defaultKind="photo"] 无法判断栏目时的默认值
 * @returns {Array<{articleId: string, kind: "photo"|"beauty"}>}
 */
export function parseArticleRefs(text, defaultKind = DEFAULT_KIND) {
	const raw = String(text ?? "").trim();
	if (!raw) return [];
	const fallbackKind = String(defaultKind).toLowerCase() === "beauty" ? "beauty" : "photo";
	const refs = [];
	const seen = new Set();
	const add = (articleId, kind) => {
		const id = String(articleId ?? "").trim();
		if (!id || seen.has(id)) return;
		seen.add(id);
		refs.push({ articleId: id, kind: String(kind).toLowerCase() === "beauty" ? "beauty" : "photo" });
	};

	for (const match of raw.matchAll(REF_PATTERN)) {
		if (match[2]) {
			add(match[2], match[1]);
			continue;
		}
		const kind = match[3] === "潮拍馆" ? "beauty" : "photo";
		for (const articleId of match[4].match(DIGIT_PATTERN) || []) add(articleId, kind);
	}
	if (refs.length > 0) return refs;

	for (const match of raw.matchAll(BARE_ID_PATTERN)) add(match[1], fallbackKind);
	return refs;
}

/**
 * 兼容旧接口：只返回第一个引用。
 * @param {string} text 用户消息文本
 * @param {"photo"|"beauty"} [defaultKind="photo"] 默认栏目
 * @returns {{articleId: string, kind: "photo"|"beauty"}|null}
 */
export function parseArticleRef(text, defaultKind = DEFAULT_KIND) {
	return parseArticleRefs(text, defaultKind)[0] || null;
}

/**
 * 用 ID 拼出官方 APP 接口地址：`{mzt_app_api}/post/p?id={id}`。
 *
 * @param {string} appApi 配置里的 APP 接口基址（允许末尾带斜杠）
 * @param {string|number} articleId 文章 ID
 * @returns {string} 合法 http(s) 基址返回完整 URL；否则返回空串
 */
export function buildAppApiUrl(appApi, articleId) {
	const base = String(appApi ?? "").trim();
	if (!/^https?:\/\//i.test(base)) return "";
	return `${base.replace(/\/+$/, "")}/post/p?id=${encodeURIComponent(String(articleId))}`;
}

/**
 * 按 mzt_max_images 截断图片列表（0/非法值表示不限制）。
 * @param {string[]} imageUrls 完整图片 URL 列表
 * @param {number} limit 上限
 * @returns {string[]}
 */
export function applyImageLimit(imageUrls, limit) {
	const urls = Array.isArray(imageUrls) ? imageUrls : [];
	const max = Number(limit) || 0;
	return max > 0 ? urls.slice(0, max) : urls;
}

/**
 * 下载只以解密返回的图片 URL 为准（供发送流程与离线自检共用）。
 * @param {{imageUrls?: string[]}|null|undefined} album 图集对象
 * @returns {string[]} 图片 URL 副本
 */
export function albumDownloadUrls(album) {
	return Array.isArray(album?.imageUrls) ? [...album.imageUrls] : [];
}

/**
 * mTLS 证书候选路径：配置值优先，其次默认 `config/mzt_client.pem`。
 *
 * 只接受插件目录内的相对路径：绝对路径、`~` 展开和 `..` 越界一律拒绝，
 * 避免加载到插件包外的文件（与 AstrBot 版 `_cert_candidates` 一致）。
 *
 * @param {{configured?: string, pluginRoot: string, defaultCertPath: string}} options
 * @returns {{candidates: string[], rejected: string}} rejected 为拒绝原因，空串表示未拒绝配置值
 */
export function resolveCertCandidates({ configured = "", pluginRoot, defaultCertPath }) {
	const result = { candidates: [], rejected: "" };
	const raw = String(configured ?? "").trim();
	if (raw) {
		if (path.isAbsolute(raw) || raw.startsWith("~")) {
			result.rejected = "absolute-path";
		} else {
			const resolved = path.resolve(pluginRoot, raw);
			const relative = path.relative(pluginRoot, resolved);
			if (relative.startsWith("..") || path.isAbsolute(relative)) {
				result.rejected = "path-escape";
			} else {
				result.candidates.push(resolved);
			}
		}
	}
	result.candidates.push(defaultCertPath);
	result.candidates = [...new Set(result.candidates)];
	return result;
}
