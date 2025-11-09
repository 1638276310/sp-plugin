/**
 * 718吃瓜套件 - 通用工具包
 * 提供 ID 读写、浏览器启动、视频解析、搜索、往期、刷新等可复用逻辑
 * @author AI-Assistant
 */

import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

/** @type {string} 吃瓜文章 ID 持久化文件路径 */
export const idsFilePath = path.join(
  process.cwd(),
  "data",
  "sp-plugin",
  "gossip-collectorids.json"
);

/* -------------------- 基础读写 -------------------- */

/**
 * 读取本地 ID 文件
 * @returns {Promise<{articleIds:string[],excludedIds:string[]}>}
 */
export async function readIds() {
  try {
    if (!fs.existsSync(idsFilePath)) return { articleIds: [], excludedIds: [] };
    return JSON.parse(fs.readFileSync(idsFilePath, "utf8"));
  } catch (e) {
    logger.error("[gossip-utils] 读取 ID 文件失败:", e);
    return { articleIds: [], excludedIds: [] };
  }
}

/**
 * 写入本地 ID 文件（同步）
 * @param {Object} p
 * @param {string[]} p.articleIds
 * @param {string[]} p.excludedIds
 */
export async function writeIds({ articleIds, excludedIds }) {
  fs.mkdirSync(path.dirname(idsFilePath), { recursive: true });
  fs.writeFileSync(
    idsFilePath,
    JSON.stringify({ articleIds, excludedIds }, null, 2)
  );
}

/* -------------------- 浏览器 -------------------- */

/**
 * 启动一个统一配置的 Puppeteer 浏览器实例
 * @returns {Promise<Browser>}
 */
export async function launchBrowser() {
  return puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

/* -------------------- 视频解析 -------------------- */

/**
 * 根据数字 ID 抓取单篇文章（含视频、正文、图片）
 * @param {string} videoId
 * @returns {Promise<null|{id:string,title:string,publishTime:string,videoUrls:string[],images:string[],articleContent:string[]}>}
 */
export async function fetchVideoById(videoId) {
  const { articleIds, excludedIds } = await readIds();
  if (!articleIds.includes(videoId) || excludedIds.includes(videoId))
    return null;

  const videoUrls = [
    "https://shrew.zzqqaa.com",
    "https://swoop.zzqqaa.com",
    "https://plaza.zzqqaa.com",
    "https://climb.wulipolo.com",
    "https://chomp.wulipolo.com",
    "https://piano.ayfplus.com",
    "https://brood.ayfplus.com",
    "https://quirk.ayfplus.com",
    "https://swipe.ayfplus.com",
    "https://swath.ayfplus.com",
  ];

  const browser = await launchBrowser();
  let result = null;

  for (const base of videoUrls) {
    const url = `${base}/archives/${videoId}`;
    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

      /** 页面解析 */
      const data = await page.evaluate(() => {
        const r = {
          title:
            document.querySelector("h1.post-title")?.textContent?.trim() || "",
          publishTime:
            document.querySelector("time")?.textContent?.trim() || "",
          videoUrls: [],
          images: [],
          articleContent: [],
        };
        /* 视频 */
        document
          .querySelectorAll(".dplayer.dplayer-no-danmaku")
          .forEach((dp) => {
            try {
              const cfg = JSON.parse(dp.getAttribute("data-config") || "{}");
              const u = cfg.video?.url || cfg.video?.url2;
              if (u) r.videoUrls.push(u);
            } catch (e) {
              logger.error("[gossip-utils] 解析 DPlayer 配置失败:", e);
            }
          });
        /* 图片 */
        document.querySelectorAll('img[src^="blob:"]').forEach((img) => {
          if (!img.closest(".horizontal-banner, .article-bottom-apps"))
            r.images.push(img.src);
        });
        /* 正文 */
        const bq = document.querySelector("blockquote");
        if (bq) {
          let next = bq.nextElementSibling;
          let empty = 0;
          while (next && next.tagName !== "DIV") {
            if (next.tagName === "P") {
              const t = next.textContent.trim().replace(/.*?\.webp/g, "");
              if (t) {
                empty = 0;
                r.articleContent.push(t);
              } else {
                empty++;
                if (empty >= 2) break;
              }
            }
            next = next.nextElementSibling;
          }
        }
        return r;
      });

      if (
        data.videoUrls.length ||
        data.articleContent.length ||
        data.images.length
      ) {
        result = { ...data, id: videoId };
        break;
      }
    } catch (e) {
      logger.error(`[gossip-utils] 抓取 ${url} 失败:`, e);
      continue;
    }
  }
  await browser.close();

  /* 全部失败 -> 写排除 */
  if (!result) {
    excludedIds.push(videoId);
    await writeIds({ articleIds, excludedIds });
    logger.info(`[gossip-utils] 已将 ${videoId} 写入排除列表`);
  }
  return result;
}

/* -------------------- 关键词搜索 -------------------- */

/**
 * 按关键词搜索文章
 * @param {string} keyword
 * @returns {Promise<{id:string,title:string}[]>}
 */
export async function searchArticlesByKeyword(keyword) {
  const browser = await launchBrowser();
  const bases = [
    "https://shrew.zzqqaa.com",
    "https://swoop.zzqqaa.com",
    "https://plaza.zzqqaa.com",
  ];
  let list = [];
  for (const base of bases) {
    try {
      const page = await browser.newPage();
      await page.goto(`${base}/search/${encodeURIComponent(keyword)}`, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      const arr = await page.evaluate(() =>
        Array.from(document.querySelectorAll("article"))
          .map((a) => {
            const title = a
              .querySelector("h2.post-card-title")
              ?.textContent?.trim();
            const link = a.querySelector('a[href^="/archives/"]')?.href;
            const id = link?.match(/\/archives\/(\d+)/)?.[1];
            return id && title ? { id, title } : null;
          })
          .filter(Boolean)
      );
      if (arr.length) {
        list = arr.slice(0, 30);
        break;
      }
    } catch (e) {
      logger.error(`[gossip-utils] 搜索 ${base} 失败:`, e);
      continue;
    } finally {
      await browser.close();
    }
  }
  return list;
}

/* -------------------- 往期文章 -------------------- */

/**
 * 获取最新 N 条往期文章
 * @param {number} count
 * @returns {Promise<{id:string,title:string}[]>}
 */
export async function fetchPastArticles(count = 10) {
  const browser = await launchBrowser();
  const bases = [
    "https://shrew.zzqqaa.com",
    "https://swoop.zzqqaa.com",
    "https://plaza.zzqqaa.com",
  ];
  let list = [];
  for (const base of bases) {
    try {
      const page = await browser.newPage();
      await page.goto(`${base}/archives.html`, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      const arr = await page.evaluate(
        (max) =>
          Array.from(document.querySelectorAll(".brick a"))
            .slice(0, max)
            .map((a) => {
              const title = a.textContent?.trim();
              const id = a.href?.match(/\/archives\/(\d+)/)?.[1];
              return id && title ? { id, title } : null;
            })
            .filter(Boolean),
        count
      );
      if (arr.length) {
        list = arr;
        break;
      }
    } catch (e) {
      logger.error(`[gossip-utils] 获取往期 ${base} 失败:`, e);
      continue;
    } finally {
      await browser.close();
    }
  }
  return list;
}

/* -------------------- 刷新最大 ID -------------------- */

/**
 * 重新生成文章 ID 列表（1~最大 ID）
 * @returns {Promise<boolean>} 成功/失败
 */
export async function refreshArticleIds() {
  const browser = await launchBrowser();
  const bases = [
    "https://shrew.zzqqaa.com",
    "https://swoop.zzqqaa.com",
    "https://plaza.zzqqaa.com",
    "https://climb.wulipolo.com",
    "https://chomp.wulipolo.com",
    "https://piano.ayfplus.com",
    "https://brood.ayfplus.com",
    "https://quirk.ayfplus.com",
    "https://swipe.ayfplus.com",
    "https://swath.ayfplus.com",
  ];
  let maxId = 0;
  for (const base of bases) {
    try {
      const page = await browser.newPage();
      await page.goto(`${base}/archives.html`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForSelector('.brick a[href^="/archives/"]', {
        timeout: 30000,
      });
      const first = await page.evaluate(() => {
        const m = document
          .querySelector('.brick a[href^="/archives/"]')
          ?.href?.match(/\/archives\/(\d+)/);
        return m ? parseInt(m[1]) : 0;
      });
      if (first > maxId) maxId = first;
    } catch (e) {
      logger.error(`[gossip-utils] 刷新最大 ID 时 ${base} 失败:`, e);
      continue;
    } finally {
      await browser.close();
    }
  }
  if (maxId > 0) {
    const articleIds = Array.from({ length: maxId }, (_, i) =>
      String(maxId - i)
    );
    const { excludedIds } = await readIds();
    await writeIds({ articleIds, excludedIds });
    logger.info(
      `[gossip-utils] 已生成 1~${maxId} 共 ${articleIds.length} 个 ID`
    );
    return true;
  }
  return false;
}
