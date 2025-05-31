// 插件名称：718吃瓜网视频搜索
// 插件功能：从718吃瓜视频站提取视频m3u8地址和文章内容
// 插件作者：@QQ1638276310
// 插件主页：https://github.com/1638276310/sp-plugin

import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

const idsFilePath = path.join(
  process.cwd(),
  "data",
  "sp-plugin",
  "config",
  "ids.json"
);

export class VideoSearch extends plugin {
  constructor() {
    super({
      name: "718吃瓜网视频搜索",
      dsc: "从718吃瓜视频站提取视频m3u8地址和文章内容",
      event: "message",
      priority: "-718",
      rule: [
        {
          reg: "^#?吃瓜\\s*(\\d+)$",
          fnc: "processVideoSearch",
        },
        {
          reg: "^#?随机吃瓜$",
          fnc: "randomVideoSearch",
        },
        {
          reg: "^#?吃瓜搜索\\s*(\\S+)$",
          fnc: "processSearchQuery",
        },
        {
          reg: "^#?吃瓜(\\d+)个往期$",
          fnc: "getPastArticles",
        },
        {
          reg: "^(#)?更新吃瓜ID$",
          fnc: "updateArticleIds",
        },
      ],
    });

    this.videoUrls = [
      "https://risky.zuiniude.xyz",
      "https://cloud.zuiniude.xyz",
      "https://fence.zuiniude.xyz",
      "https://plane.zuiniude.xyz",
      "https://blend.zuiniude.xyz",
    ];

    this.excludedArticleIds = [
      19949, 18914, 18405, 18185, 16910, 16790, 14666, 13619, 12535, 12489,
      12395, 9999, 9278, 8819, 7859, 7293, 6998, 6692, 2307, 813, 548, 521, 26,
      14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ].map(String);

    this.addArticleIds = [];

    this.allArticleIds = [];
    this.finalArticleIds = [];

    this.loadingPromise = this.loadArticleIdsFromFile();
  }

  async loadArticleIdsFromFile() {
    try {
      if (!fs.existsSync(idsFilePath)) {
        const dir = path.dirname(idsFilePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(idsFilePath, "[]", "utf8");
        logger.info(`创建空的文章ID文件: ${idsFilePath}`);
      }
      const data = fs.readFileSync(idsFilePath, "utf8");
      this.finalArticleIds = JSON.parse(data);
      logger.info(`成功从文件加载 ${this.finalArticleIds.length} 个文章ID`);
      return true;
    } catch (error) {
      logger.error("从文件加载文章ID失败，尝试重新加载:", error);
      return this.loadArticleIds();
    }
  }

  async loadArticleIds() {
    try {
      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });

      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (
          ["stylesheet", "font", "image", "media", "script"].includes(
            req.resourceType()
          )
        ) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(`${this.videoUrls[0]}/archives.html`, {
        timeout: 120000,
        waitUntil: "domcontentloaded",
      });

      await this.autoScrollToBottom(page);

      await page.waitForFunction(
        () => {
          const brickCount = document.querySelectorAll(".brick").length;
          return new Promise((resolve) => {
            let lastCount = brickCount;
            setTimeout(() => {
              const newCount = document.querySelectorAll(".brick").length;
              resolve(newCount === lastCount);
            }, 2000);
          });
        },
        { timeout: 60000 }
      );

      const scrapedIds = await page.evaluate(() => {
        const bricks = Array.from(document.querySelectorAll(".brick"));
        return bricks
          .map((brick) => {
            const link = brick.querySelector('a[href^="/archives/"]');
            if (!link) return null;
            const href = link.href || link.getAttribute("data-original-url");
            const match = href.match(/\/archives\/(\d+)/);
            return match ? match[1] : null;
          })
          .filter(Boolean);
      });

      this.finalArticleIds = this.processArticleIds(scrapedIds);

      logger.info(`成功加载 ${this.finalArticleIds.length} 个文章ID`);
      logger.debug(
        `ID范围: ${Math.min(...this.finalArticleIds.map(Number))}-${Math.max(
          ...this.finalArticleIds.map(Number)
        )}`
      );

      await this.saveArticleIdsToFile();

      await browser.close();
      return true;
    } catch (error) {
      logger.error("加载文章ID失败:", error);
      this.finalArticleIds = this.getFallbackIds();
      await this.saveArticleIdsToFile();
      return false;
    }
  }

  async saveArticleIdsToFile() {
    try {
      const dir = path.dirname(idsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        idsFilePath,
        JSON.stringify(this.finalArticleIds),
        "utf8"
      );
      logger.info(`文章ID已保存到 ${idsFilePath}`);
    } catch (error) {
      logger.error("保存文章ID到文件失败:", error);
    }
  }

  async autoScrollToBottom(page) {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 500;
        const scrollDelay = 300;

        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (
            totalHeight >= scrollHeight - window.innerHeight ||
            totalHeight > 50000
          ) {
            clearInterval(timer);
            resolve();
          }
        }, scrollDelay);
      });
    });
  }

  getFallbackIds() {
    return this.addArticleIds.filter(
      (id) => !this.excludedArticleIds.includes(id)
    );
  }

  processArticleIds(scrapedIds) {
    const allIds = [...new Set([...scrapedIds, ...this.addArticleIds])];
    return allIds
      .filter((id) => !this.excludedArticleIds.includes(id))
      .sort((a, b) => parseInt(b) - parseInt(a));
  }

  async processVideoSearch(e) {
    await this.loadingPromise;

    const match = e.msg.match(/^#?吃瓜\s*(\d+)$/);
    if (!match) return;

    const videoId = match[1];
    if (this.excludedArticleIds.includes(videoId)) {
      await e.reply("该文章 ID 已被排除，无法搜索。", false, { at: true });
      return;
    }

    if (!this.finalArticleIds.includes(videoId)) {
      await e.reply("该ID不存在", false, { at: true });
      return;
    }

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new",
    });

    let lastError = null;

    for (const baseUrl of this.videoUrls) {
      const url = `${baseUrl}/archives/${videoId}`;
      try {
        const page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        await page.setRequestInterception(true);
        page.on("request", (req) => {
          if (["stylesheet", "font"].includes(req.resourceType())) {
            req.abort();
          } else {
            req.continue();
          }
        });

        let retries = 3;
        while (retries--) {
          try {
            await page.goto(url, {
              timeout: 60000,
              waitUntil: "networkidle2",
            });
            break;
          } catch (err) {
            if (retries === 0) throw err;
            await new Promise((r) => setTimeout(r, 60000));
          }
        }

        const pageInfo = await page.evaluate(() => {
          try {
            const result = {
              title: null,
              publishTime: null,
              videoUrls: [],
              images: [],
              articleContent: [],
              publishedTime: null,
              modifiedTime: null,
            };

            const titleElement = document.querySelector("h1.post-title");
            if (titleElement) result.title = titleElement.textContent.trim();

            const timeElement = document.querySelector("time");
            if (timeElement)
              result.publishTime = timeElement.textContent.trim();

            const publishedTimeMeta = document.querySelector(
              'meta[property="article:published_time"]'
            );
            if (publishedTimeMeta)
              result.publishedTime = publishedTimeMeta.content;

            const modifiedTimeMeta = document.querySelector(
              'meta[property="article:modified_time"]'
            );
            if (modifiedTimeMeta)
              result.modifiedTime = modifiedTimeMeta.content;

            // 修改后的视频提取逻辑 - 每个播放器只提取一个URL
            const dplayers = document.querySelectorAll(
              ".dplayer.dplayer-no-danmaku"
            );
            if (dplayers.length > 0) {
              dplayers.forEach((dplayer) => {
                try {
                  const configJson = dplayer.getAttribute("data-config");
                  if (configJson) {
                    const config = JSON.parse(configJson);

                    // 优先使用主URL，如果不可用则使用备用URL
                    const videoUrl = config.video?.url || config.video?.url2;
                    if (videoUrl) {
                      result.videoUrls.push(videoUrl);
                    }
                  }
                } catch (e) {
                  console.error("解析DPlayer配置失败:", e);
                }
              });
            }

            const imgElements = document.querySelectorAll('img[src^="blob:"]');
            imgElements.forEach((img) => {
              let isAd = false;
              let parent = img.parentElement;

              while (parent) {
                if (
                  parent.classList &&
                  (parent.classList.contains("horizontal-banner") ||
                    parent.classList.contains("article-bottom-apps"))
                ) {
                  isAd = true;
                  break;
                }
                parent = parent.parentElement;
              }

              const imgUrl = img.getAttribute("src");
              if (imgUrl && !isAd) result.images.push(imgUrl);
            });

            // 文章内容提取
            const blockquote = document.querySelector("blockquote");
            if (blockquote) {
              let nextElement = blockquote.nextElementSibling;
              while (nextElement) {
                if (nextElement.tagName === "DIV") break;

                if (nextElement.tagName === "P") {
                  let text = nextElement.textContent.trim();
                  text = text.replace(/\S+\.webp/g, "").trim();
                  result.articleContent.push(text || "\n");
                }

                nextElement = nextElement.nextElementSibling;
              }
            }

            return result;
          } catch (e) {
            console.error("解析页面信息失败:", e);
            return null;
          }
        });

        if (
          !pageInfo ||
          (pageInfo.videoUrls.length === 0 &&
            pageInfo.articleContent.length === 0 &&
            pageInfo.images.length === 0)
        ) {
          throw new Error("未找到视频地址、文章正文内容和图片");
        }

        const forwardNodes = [
          {
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: [
              `✅视频信息获取成功！\n` +
                `🆔文章ID: ${videoId}\n` +
                (pageInfo.title ? `📝标题: ${pageInfo.title}\n` : "") +
                (pageInfo.publishTime
                  ? `📅发布时间: ${pageInfo.publishTime}\n`
                  : "") +
                (pageInfo.publishedTime
                  ? `📅创建时间: ${pageInfo.publishedTime
                      .replace("T", " T ")
                      .replace(/\+.*$/, "")}\n`
                  : "") +
                (pageInfo.modifiedTime
                  ? `📅最后修改时间: ${pageInfo.modifiedTime
                      .replace("T", " T ")
                      .replace(/\+.*$/, "")}\n`
                  : "") +
                `📛请勿用于非法用途`,
            ],
          },
        ];

        if (pageInfo.videoUrls.length > 0) {
          forwardNodes.push({
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: ["🔗视频地址列表:"],
          });

          pageInfo.videoUrls.forEach((url, index) => {
            let cleanUrl = url;
            if (parseInt(videoId) >= 19949) {
              cleanUrl = url;
            } else if (url) {
              cleanUrl = url.replace(/\\\//g, "/").split("?")[0];
            }

            forwardNodes.push({
              user_id: e.user_id,
              nickname: e.sender.nickname,
              message: [`${index + 1}. ${cleanUrl}`],
            });
          });
        } else {
          forwardNodes.push({
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: ["ℹ️未获取到视频地址"],
          });
        }

        if (pageInfo.articleContent.length > 0) {
          forwardNodes.push({
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: ["📖文章内容:"],
          });

          pageInfo.articleContent.forEach((content) => {
            forwardNodes.push({
              user_id: e.user_id,
              nickname: e.sender.nickname,
              message: content,
            });
          });
        }

        if (pageInfo.images.length > 0) {
          forwardNodes.push({
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: ["🖼️文章图片:"],
          });

          for (const blobUrl of pageInfo.images) {
            try {
              const base64 = await page.evaluate(async (url) => {
                const response = await fetch(url);
                const blob = await response.blob();
                return new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result.split(",")[1]);
                  reader.readAsDataURL(blob);
                });
              }, blobUrl);

              forwardNodes.push({
                user_id: e.user_id,
                nickname: e.sender.nickname,
                message: [segment.image(`base64://${base64}`)],
              });
            } catch (imageError) {
              logger.error("获取图片失败:", imageError);
            }
          }
        }

        const forwardMessage = await Bot.makeForwardMsg(forwardNodes);
        await e.reply(forwardMessage);

        await browser.close();
        return;
      } catch (error) {
        lastError = error;
        logger.error(`尝试URL ${url} 失败:`, error);
      }
    }

    await browser.close();
    await e.reply(
      `未找到视频地址，请稍后重试。错误信息: ${
        lastError?.message || "未知错误"
      }`,
      false,
      { at: true }
    );
  }

  async randomVideoSearch(e) {
    await this.loadingPromise;

    if (this.finalArticleIds.length === 0) {
      await e.reply("没有可用的随机视频ID，请检查文章id", false, { at: true });
      return;
    }

    const randomIndex = Math.floor(Math.random() * this.finalArticleIds.length);
    const randomVideoId = this.finalArticleIds[randomIndex];

    await e.reply(`随机选择视频ID: ${randomVideoId}，正在搜索...`, false, {
      at: true,
    });

    await this.processVideoSearch({
      ...e,
      msg: `#吃瓜 ${randomVideoId}`,
    });
  }

  async processSearchQuery(e) {
    const keyword = e.msg.match(/^#?吃瓜搜索\s*(\S+)$/)?.[1]?.trim();
    if (!keyword) return;

    await e.reply(`正在搜索包含关键词 "${keyword}" 的文章，请稍等...`, false, {
      at: true,
    });

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new",
    });

    let lastError = null;

    for (const baseUrl of this.videoUrls) {
      const searchUrl = `${baseUrl}/search/${encodeURIComponent(keyword)}`;
      try {
        const page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        await page.setRequestInterception(true);
        page.on("request", (req) => {
          if (["stylesheet", "font"].includes(req.resourceType())) {
            req.abort();
          } else {
            req.continue();
          }
        });

        let retries = 3;
        while (retries--) {
          try {
            await page.goto(searchUrl, {
              timeout: 60000,
              waitUntil: "networkidle2",
            });
            break;
          } catch (err) {
            if (retries === 0) throw err;
            await new Promise((r) => setTimeout(r, 60000));
          }
        }

        const searchResults = await page.evaluate(() => {
          const articles = Array.from(document.querySelectorAll("article"));
          return articles
            .map((article) => {
              const titleElement = article.querySelector("h2.post-card-title");
              const linkElement = article.querySelector(
                'a[href^="/archives/"]'
              );

              if (!titleElement || !linkElement) return null;

              const link = linkElement.href;
              const title = titleElement.textContent.trim();
              const idMatch = link.match(/\/archives\/(\d+)/);
              const id = idMatch ? idMatch[1] : null;

              return id && title ? { id, title, link } : null;
            })
            .filter(Boolean);
        });

        if (searchResults.length === 0) {
          throw new Error("未找到相关文章");
        }

        const forwardNodes = [
          {
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: [`🔍包含关键词 "${keyword}" 的文章搜索结果：`],
          },
        ];

        searchResults.slice(0, 30).forEach((result, index) => {
          forwardNodes.push({
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: [`${index + 1}. ${result.title}\n`, `📌 ID: ${result.id}`],
          });
        });

        const forwardMessage = await Bot.makeForwardMsg(forwardNodes);
        await e.reply(forwardMessage);

        await page.close();
        await browser.close();
        return;
      } catch (error) {
        lastError = error;
        logger.error(`尝试 URL ${searchUrl} 失败:`, error);
      }
    }

    await browser.close();
    await e.reply(
      `❌ 未找到相关文章，请稍后重试。错误信息: ${
        lastError?.message || "未知错误"
      }`,
      false,
      { at: true }
    );
  }

  async getPastArticles(e) {
    const count = parseInt(e.msg.match(/^#?吃瓜(\d+)个往期$/)?.[1], 10);
    if (!count) return;

    await e.reply(`正在获取 ${count} 个往期文章，请稍等...`, false, {
      at: true,
    });

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new",
    });

    let lastError = null;

    for (const baseUrl of this.videoUrls) {
      const archiveUrl = `${baseUrl}/archives.html`;
      try {
        const page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        await page.setRequestInterception(true);
        page.on("request", (req) => {
          if (["stylesheet", "font"].includes(req.resourceType())) {
            req.abort();
          } else {
            req.continue();
          }
        });

        let retries = 3;
        while (retries--) {
          try {
            await page.goto(archiveUrl, {
              timeout: 60000,
              waitUntil: "networkidle2",
            });
            break;
          } catch (err) {
            if (retries === 0) throw err;
            await new Promise((r) => setTimeout(r, 60000));
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 5000));

        const archiveInfo = await page.evaluate((count) => {
          const result = [];
          const brickElements = document.querySelectorAll(".brick a");
          const actualCount = Math.min(count, brickElements.length);

          for (let i = 0; i < actualCount; i++) {
            const brick = brickElements[i];
            const href = brick.getAttribute("href");
            const titleElement = brick.cloneNode(true);
            const spanElement = titleElement.querySelector("span");
            if (spanElement) spanElement.remove();

            const title = titleElement.textContent.trim();
            const idMatch = href.match(/\/archives\/(\d+)/);
            const id = idMatch ? idMatch[1] : null;

            if (id) result.push({ title, id, link: href });
          }

          return result;
        }, count);

        if (archiveInfo.length === 0) {
          throw new Error("未找到往期文章");
        }

        const forwardNodes = [
          {
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: [`以下是 ${archiveInfo.length} 个往期文章的信息：`],
          },
        ];

        archiveInfo.forEach((article, index) => {
          forwardNodes.push({
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: [
              `${index + 1}. 📝标题: ${article.title}\n`,
              `🆔ID: ${article.id}\n`,
            ],
          });
        });

        const forwardMessage = await Bot.makeForwardMsg(forwardNodes);
        await e.reply(forwardMessage);

        await page.close();
        await browser.close();
        return;
      } catch (error) {
        lastError = error;
        logger.error(`尝试URL ${archiveUrl} 失败:`, error);
      }
    }

    await browser.close();
    await e.reply(
      `未找到往期文章，请稍后重试。错误信息: ${lastError.message}`,
      false,
      { at: true }
    );
  }

  async updateArticleIds(e) {
    await e.reply("正在更新文章ID，请稍等...", false, { at: true });
    const success = await this.loadArticleIds();
    if (success) {
      await e.reply("文章ID更新成功！", false, { at: true });
    } else {
      await e.reply("文章ID更新失败，请稍后重试。", false, { at: true });
    }
  }
}
