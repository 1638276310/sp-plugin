// 插件名称：718吃瓜网视频搜索
// 插件功能：从718吃瓜视频站提取视频m3u8地址和文章内容
// 插件作者：@QQ1638276310
// 插件主页：https://github.com/1638276310/sp-plugin

import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

// 修改文件路径为 data/gossip-collector/ids.json
const idsFilePath = path.join(
  process.cwd(),
  "data",
  "sp-plugin",
  "gossip-collectorids.json"
);

export class VideoSearch extends plugin {
  constructor() {
    super({
      name: "718吃瓜网视频搜索",
      dsc: "从718吃瓜视频站提取视频m3u8地址和文章内容",
      event: "message",
      priority: -Infinity,
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
      "https://shrew.zzqqaa.com",
      "https://swoop.zzqqaa.com",
      "https://plaza.zzqqaa.com",
      "https://climb.wulipolo.com",
      "https://chomp.wulipolo.com",
    ];

    this.finalArticleIds = [];
    this.excludedIds = []; // 新增：存储排除的ID

    this.loadingPromise = this.loadArticleIdsFromFile();
  }

  async loadArticleIdsFromFile() {
    try {
      const dir = path.dirname(idsFilePath);
      // 确保目录存在
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`创建目录: ${dir}`);
      }

      // 确保文件存在
      if (!fs.existsSync(idsFilePath)) {
        fs.writeFileSync(idsFilePath, "[]", "utf8");
        logger.info(`创建空的文章ID文件: ${idsFilePath}`);
      }

      const data = fs.readFileSync(idsFilePath, "utf8");
      let parsedData;

      // 兼容旧格式和新格式
      if (data.startsWith("[")) {
        // 旧格式：纯数组
        this.finalArticleIds = JSON.parse(data);
        this.excludedIds = [];
        logger.info(
          `成功从文件加载 ${this.finalArticleIds.length} 个文章ID (旧格式)`
        );
      } else {
        // 新格式：包含两个数组的对象
        parsedData = JSON.parse(data);
        this.finalArticleIds = parsedData.articleIds || [];
        this.excludedIds = parsedData.excludedIds || [];
        logger.info(
          `成功从文件加载 ${this.finalArticleIds.length} 个文章ID 和 ${this.excludedIds.length} 个排除ID`
        );
      }

      return true;
    } catch (error) {
      logger.error("从文件加载文章ID失败，尝试重新加载:", error);
      return this.loadArticleIds();
    }
  }

  async saveArticleIdsToFile() {
    try {
      const dir = path.dirname(idsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 保存两个数组
      const dataToSave = {
        articleIds: this.finalArticleIds,
        excludedIds: this.excludedIds,
      };

      fs.writeFileSync(idsFilePath, JSON.stringify(dataToSave), "utf8");
      logger.info(`文章ID和排除ID已保存到 ${idsFilePath}`);
    } catch (error) {
      logger.error("保存文章ID到文件失败:", error);
    }
  }

  async loadArticleIds() {
    let maxId = 0;

    // 尝试所有备用URL
    for (const baseUrl of this.videoUrls) {
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

        await page.goto(`${baseUrl}/archives.html`, {
          timeout: 120000,
          waitUntil: "domcontentloaded",
        });

        // 等待第一个.brick元素加载
        await page.waitForSelector('.brick a[href^="/archives/"]', {
          timeout: 120000,
        });

        // 获取第一个文章的ID
        const firstId = await page.evaluate(() => {
          const firstBrickLink = document.querySelector(
            '.brick a[href^="/archives/"]'
          );
          if (firstBrickLink) {
            const match = firstBrickLink.href.match(/\/archives\/(\d+)/);
            return match ? parseInt(match[1]) : null;
          }
          return null;
        });

        if (firstId && firstId > maxId) {
          maxId = firstId;
          logger.info(`从 ${baseUrl} 获取到最大ID: ${maxId}`);
        }

        await browser.close();
      } catch (error) {
        logger.error(`尝试URL ${baseUrl}/archives.html 失败:`, error);
        // 继续尝试下一个URL
      }
    }

    if (maxId > 0) {
      // 生成从maxId到1的ID数组
      this.finalArticleIds = Array.from({ length: maxId }, (_, i) =>
        (maxId - i).toString()
      );
      logger.info(
        `生成 ${this.finalArticleIds.length} 个文章ID，从 ${maxId} 到 1`
      );

      // 保留现有的排除ID
      this.excludedIds = this.excludedIds || [];

      await this.saveArticleIdsToFile();
      return true;
    } else {
      // 如果所有URL都失败
      logger.error("所有备用URL都无法加载文章ID");
      this.finalArticleIds = [];
      this.excludedIds = [];
      await this.saveArticleIdsToFile();
      return false;
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

  async processVideoSearch(e) {
    await this.loadingPromise;

    const match = e.msg.match(/^#?吃瓜\s*(\d+)$/);
    if (!match) return;

    const videoId = match[1];

    // 新增：检查ID是否在排除列表中
    if (this.excludedIds.includes(videoId)) {
      await e.reply("嘿~哥们！", false, { at: true });
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
    let urlFound = false;
    let shouldExclude = false; // 新增：标记是否需要排除此ID

    for (const baseUrl of this.videoUrls) {
      const url = `${baseUrl}/archives/${videoId}`;

      // 校验URL是否返回404或发生跳转
      try {
        const page = await browser.newPage();
        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        // 设置请求拦截器，检查响应状态码
        let responseReceived = false;
        page.on("response", async (response) => {
          if (response.url() === url && !responseReceived) {
            responseReceived = true;
            const status = response.status();
            if (status === 404) {
              throw new Error("404 Not Found");
            }
          }
        });

        // 尝试访问页面
        await page.goto(url, {
          timeout: 120000,
          waitUntil: "networkidle2",
        });

        // 检查是否发生了跳转
        const finalUrl = page.url();
        if (finalUrl !== url) {
          throw new Error("URL Redirected");
        }

        // 如果页面加载成功且URL未变，标记URL有效
        urlFound = true;
        await page.close();
      } catch (error) {
        if (error.message === "404 Not Found") {
          logger.info(`ID ${videoId} 在 ${baseUrl} 上不存在`);
          shouldExclude = true; // 标记需要排除
          continue; // 尝试下一个备用URL
        } else if (error.message === "URL Redirected") {
          logger.info(`ID ${videoId} 在 ${baseUrl} 上已跳转`);
          shouldExclude = true; // 标记需要排除
          continue; // 尝试下一个备用URL
        }
        lastError = error;
        logger.error(`尝试URL ${url} 失败:`, error);
        continue;
      }

      // 如果URL有效，则继续处理
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
              timeout: 120000,
              waitUntil: "networkidle2",
            });
            break;
          } catch (err) {
            if (retries === 0) throw err;
            await new Promise((r) => setTimeout(r, 120000));
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

            // 文章内容提取 - 修改部分开始
            const blockquote = document.querySelector("blockquote");
            if (blockquote) {
              let nextElement = blockquote.nextElementSibling;
              let consecutiveEmpty = 0; // 连续空段落计数器

              while (nextElement) {
                if (nextElement.tagName === "DIV") break;

                if (nextElement.tagName === "P") {
                  let text = nextElement.textContent.trim();
                  text = text
                    .replace(/(?:^|\s)(.*?\.webp)(?:\s|$)/g, "")
                    .trim();

                  // 非空段落处理
                  if (text) {
                    consecutiveEmpty = 0; // 重置计数器
                    result.articleContent.push(text);
                  }
                  // 空段落处理
                  else {
                    consecutiveEmpty++;
                    // 检测到连续两个空段落，添加结束提示
                    if (consecutiveEmpty >= 2) {
                      result.articleContent.push("嘿，哥们，没了，是的，没了");
                      break;
                    }
                  }
                }

                nextElement = nextElement.nextElementSibling;
              }
            }
            // 文章内容提取 - 修改部分结束

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
                      .replace("T", "——")
                      .replace(/\+.*$/, "")}\n`
                  : "") +
                (pageInfo.modifiedTime
                  ? `📅最后修改时间: ${pageInfo.modifiedTime
                      .replace("T", "——")
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
            // cleanUrl = url.replace(/\\\//g, "/").split("?")[0];

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

    // 新增：如果检测到需要排除此ID
    if (shouldExclude && !this.excludedIds.includes(videoId)) {
      this.excludedIds.push(videoId);
      await this.saveArticleIdsToFile();
      logger.info(`已将ID ${videoId} 添加到排除列表`);
    }

    // 根据URL检查结果决定回复内容
    if (!urlFound) {
      await e.reply("该ID不存在", false, { at: true });
    } else {
      await e.reply(
        `未找到视频地址，请稍后重试。错误信息: ${
          lastError?.message || "未知错误"
        }`,
        false,
        { at: true }
      );
    }
  }

  async randomVideoSearch(e) {
    await this.loadingPromise;

    // 过滤掉排除的ID
    const availableIds = this.finalArticleIds.filter(
      (id) => !this.excludedIds.includes(id)
    );

    if (availableIds.length === 0) {
      await e.reply("没有可用的随机视频ID，请检查文章id", false, { at: true });
      return;
    }

    const randomIndex = Math.floor(Math.random() * availableIds.length);
    const randomVideoId = availableIds[randomIndex];

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
              timeout: 120000,
              waitUntil: "networkidle2",
            });
            break;
          } catch (err) {
            if (retries === 0) throw err;
            await new Promise((r) => setTimeout(r, 120000));
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
          // 检查ID是否被排除
          const isExcluded = this.excludedIds.includes(result.id);
          const statusMark = isExcluded ? " (已失效)" : "";

          forwardNodes.push({
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: [
              `${index + 1}. ${result.title}${statusMark}\n`,
              `📌 ID: ${result.id}`,
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
              timeout: 120000,
              waitUntil: "networkidle2",
            });
            break;
          } catch (err) {
            if (retries === 0) throw err;
            await new Promise((r) => setTimeout(r, 120000));
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 120000));

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
          // 检查ID是否被排除
          const isExcluded = this.excludedIds.includes(article.id);
          const statusMark = isExcluded ? " (已失效)" : "";

          forwardNodes.push({
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: [
              `${index + 1}. 📝标题: ${article.title}${statusMark}\n`,
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
