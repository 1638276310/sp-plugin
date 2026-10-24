#!/usr/bin/env node
/**
 * 妹子图新链路自检（不启动 Bot、不联网）。
 *
 * 覆盖 7 组：
 * 1. 指令文本 → 文章 ID（单个/多个/链接/未命中）
 * 2. ID → APP 接口 URL 模板
 * 3. 包内 mTLS 证书与内置解密模块按相对路径可解析
 * 4. 解密入口可用，图片 URL 数量正确（离线 fixture 真实解密）
 * 5. 下载只使用解密返回的图片 URL
 * 6. 失败语义：200 挑战页 / 403 Cloudflare + Ray ID 文案
 * 7. 源码无直连残留（puppeteer/page.goto/网页接口函数/列表页 URL）
 *
 * 运行：node tools/selftest_mzt_chain.js
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	MAX_IDS_PER_COMMAND,
	albumDownloadUrls,
	applyImageLimit,
	buildAppApiUrl,
	parseArticleRef,
	parseArticleRefs,
	resolveCertCandidates,
} from "../lib/mzt-chain.js";
import { decodeApiPayload } from "../lib/mzt-crypto.js";
import {
	cloudflareStageText,
	detectCloudflare,
	loadClientPemFile,
} from "../lib/mzt-net.js";

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FAILURES = [];
let checks = 0;

/**
 * 记录一条断言结果。
 * @param {string} name 断言名
 * @param {boolean} ok 是否通过
 * @param {string} [detail] 附加信息
 */
function check(name, ok, detail = "") {
	checks += 1;
	console.log(`[selftest] ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`);
	if (!ok) FAILURES.push(name);
}

function testParseIds() {
	const cases = [
		["写真馆 171317", [{ articleId: "171317", kind: "photo" }]],
		[
			"写真馆 171317 171318 共 2 张",
			[
				{ articleId: "171317", kind: "photo" },
				{ articleId: "171318", kind: "photo" },
			],
		],
		["潮拍馆 191566", [{ articleId: "191566", kind: "beauty" }]],
		[
			"写真馆 171317,171318、171319",
			[
				{ articleId: "171317", kind: "photo" },
				{ articleId: "171318", kind: "photo" },
				{ articleId: "171319", kind: "photo" },
			],
		],
		[
			"写真馆 https://example.com/photo/1 https://example.com/beauty/2",
			[
				{ articleId: "1", kind: "photo" },
				{ articleId: "2", kind: "beauty" },
			],
		],
		["没有数字的指令", []],
	];
	for (const [text, expected] of cases) {
		try {
			assert.deepEqual(parseArticleRefs(text), expected);
			check(`提取ID ${text}`, true);
		} catch (error) {
			check(`提取ID ${text}`, false, error.message);
		}
	}
	check(
		"裸 ID 兼容 parseArticleRef",
		parseArticleRef("171317")?.articleId === "171317" &&
			parseArticleRef("171317")?.kind === "photo",
	);
	check("空文本返回空数组", parseArticleRefs("").length === 0);
	check("单指令最多 ID 数", MAX_IDS_PER_COMMAND === 10, String(MAX_IDS_PER_COMMAND));
}

function testUrlTemplate() {
	const url = buildAppApiUrl("https://api.iimzt.com/app/", "171317");
	check(
		"ID → APP 接口 URL 模板",
		url === "https://api.iimzt.com/app/post/p?id=171317",
		url,
	);
	check("非法 app_api 返回空串", buildAppApiUrl("ftp://example.com", "1") === "");
}

function testResources() {
	const defaultCert = path.join(PLUGIN_ROOT, "config", "mzt_client.pem");
	const { candidates } = resolveCertCandidates({
		configured: "",
		pluginRoot: PLUGIN_ROOT,
		defaultCertPath: defaultCert,
	});
	check("默认证书存在", fs.existsSync(candidates[0]), candidates[0]);
	const loaded = loadClientPemFile(candidates[0]);
	check("mTLS 证书可加载", loaded.status === "loaded", loaded.status);
	check("内置解密模块存在", fs.existsSync(path.join(PLUGIN_ROOT, "lib", "mzt-crypto.js")));

	const absolute = resolveCertCandidates({
		configured: path.join(PLUGIN_ROOT, "config", "mzt_client.pem"),
		pluginRoot: PLUGIN_ROOT,
		defaultCertPath: defaultCert,
	});
	check("证书候选拒绝绝对路径", absolute.rejected === "absolute-path", absolute.rejected);
	const escape = resolveCertCandidates({
		configured: "../outside.pem",
		pluginRoot: PLUGIN_ROOT,
		defaultCertPath: defaultCert,
	});
	check("证书候选拒绝目录越界", escape.rejected === "path-escape", escape.rejected);
}

function testDecryptAndDownload() {
	const fixturePath = path.join(PLUGIN_ROOT, "tools", "fixtures", "app_post_172250.json");
	const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
	const decoded = decodeApiPayload(fixture.data, fixture.article_id);
	const images = (decoded.images || []).filter(Boolean);
	check("离线 fixture 解密成功", decoded.scheme === "app", decoded.scheme);
	check(
		"解密图片 URL 数量与 count 一致",
		images.length > 0 && images.length === Number(decoded.count),
		`images=${images.length} count=${decoded.count}`,
	);
	check("解密结果是完整图片 URL", /^https?:\/\//.test(images[0] || ""), images[0]?.split("/")[2]);

	const album = { imageUrls: images };
	check(
		"下载 URL = 解密返回的图片 URL",
		JSON.stringify(albumDownloadUrls(album)) === JSON.stringify(images),
	);
	check(
		"mzt_max_images 截断",
		applyImageLimit(["a", "b", "c"], 2).length === 2 &&
			applyImageLimit(["a", "b"], 0).length === 2,
	);
}

function testSourceContract() {
	const source = fs.readFileSync(path.join(PLUGIN_ROOT, "apps", "mzt.js"), "utf8");
	check("解密入口被调用", /decodeApiPayload\(payload\.data/.test(source));
	check(
		"下载使用 albumDownloadUrls(album)",
		/albumDownloadUrls\(album\)/.test(source) && /downloadImages\(urls,/.test(source),
	);
	check("请求地址使用 buildAppApiUrl", /buildAppApiUrl\(MZT_CONFIG\.mzt_app_api/.test(source));
}

function testFailureSemantics() {
	const challenge = detectCloudflare({
		status: 200,
		body: "<html><head><title>Just a moment...</title></head></html>",
	});
	check("200 挑战页识别为 blocked", challenge.blocked === true, JSON.stringify(challenge));

	const blocked = detectCloudflare({
		status: 403,
		headers: { "cf-ray": "a4f7cd28bf6de196" },
		body: "<html><body>Sorry, you have been blocked</body></html>",
	});
	check("403 Cloudflare 与 Ray ID 识别", blocked.blocked === true && Boolean(blocked.rayId), JSON.stringify(blocked));
	check(
		"失败文案含 Cloudflare 与 Ray ID",
		cloudflareStageText(blocked, 403).includes("Cloudflare") &&
			cloudflareStageText(blocked, 403).includes("a4f7cd28bf6de196"),
		cloudflareStageText(blocked, 403),
	);
}

function testNoDirectResidue() {
	const targets = ["apps/mzt.js", "tools/mzt_diag.js"];
	const patterns = [
		["puppeteer", /puppeteer/],
		["page.goto", /page\.goto|\.goto\(/],
		["列表页 URL", /kkmzt\.com\/photo/],
		["网页/浏览器兜底函数", /fetchArticleMeta|fetchWebAlbum|fetchAlbumBrowser|parseArticleHtml/],
		["已废弃配置项", /mzt_browser_fallback|mzt_cf_wait|mzt_ua/],
	];
	const hits = [];
	for (const relative of targets) {
		const lines = fs
			.readFileSync(path.join(PLUGIN_ROOT, relative), "utf8")
			.split("\n");
		lines.forEach((line, index) => {
			for (const [label, pattern] of patterns) {
				if (pattern.test(line)) hits.push(`${relative}:${index + 1}: [${label}] ${line.trim()}`);
			}
		});
	}
	check("源码无直连残留", hits.length === 0, hits.join("\n") || "no hits");
}

function main() {
	testParseIds();
	testUrlTemplate();
	testResources();
	testDecryptAndDownload();
	testSourceContract();
	testFailureSemantics();
	testNoDirectResidue();

	if (FAILURES.length > 0) {
		console.log(`\n[selftest] FAILED ${FAILURES.length}/${checks}: ${FAILURES.join(", ")}`);
		return 1;
	}
	console.log(`\n[selftest] ALL 7 GROUPS PASSED（${checks} 项断言）`);
	return 0;
}

process.exitCode = main();
