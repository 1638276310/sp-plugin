import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

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

/** 增量更新时最多采集的页数（最新发布页）—— 只采集前2页 */
const MAX_INCREMENTAL_PAGES = 2;
/** 页面采集重试次数 */
const RETRY_TIMES = 3;
/** 重试延迟基数（毫秒） */
const RETRY_DELAY = 2000;
/** 图片下载并发数 */
const DOWNLOAD_CONCURRENCY = 5;
/** 图片下载超时（毫秒） */
const DOWNLOAD_TIMEOUT = 15000;
/** 每批发送的图片数量 */
const BATCH_SIZE = 20;

/**
 * 图片吧 (ku1373) 套图提取插件（单线程版，采集逻辑与 Python 脚本一致）
 * @class ku1373Plugin
 */
export class ku1373Plugin extends plugin {
  constructor() {
    super({
      name: "图片吧套图提取插件",
      dsc: "从图片吧网站提取套图图片，支持单线程采集与增量更新",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: "^#?更新套图列表$", // 增量更新（列表为空时自动转为全量）
          fnc: "incrementalUpdate",
        },
        {
          reg: "^#?全量更新套图列表$", // 全量更新（手动）
          fnc: "fullUpdate",
        },
        {
          reg: "^#?随机美图$",
          fnc: "randomArticleRequest",
        },
        {
          reg: "^#?套图详情\\s+(https?://[^\\s]+)$",
          fnc: "processArticleRequest",
        },
      ],
    });

    // 定时任务：每天09:30执行增量更新（列表为空时自动转为全量）
    this.task = [
      {
        cron: "0 30 9 * * *",
        name: "自动增量更新套图URL",
        fnc: this.incrementalUpdate.bind(this, null),
        log: true,
      },
    ];

    /** 套图URL列表 */
    this.jgUrls = [];

    // 初始化时加载已保存的URL
    this.loadUrls();
  }

  /**
   * 从预定义的用户代理列表中随机获取一个
   * @returns {string}
   */
  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  /**
   * 加载套图URL列表
   * @async
   */
  async loadUrls() {
    try {
      const filePath = path.join(process.cwd(), "data", "sp-plugin", "jg.json");
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8");
        this.jgUrls = JSON.parse(data);
        logger.info(`成功加载 ${this.jgUrls.length} 个套图URL`);
      } else {
        logger.info("套图URL文件不存在，将在下次更新时创建");
      }
    } catch (error) {
      logger.error("加载套图URL失败:", error);
    }
  }

  /**
   * 保存套图URL列表
   * @async
   */
  async saveUrls() {
    try {
      const filePath = path.join(process.cwd(), "data", "sp-plugin", "jg.json");
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(this.jgUrls, null, 2), "utf8");
      logger.info(`套图URL已保存到 ${filePath}`);
    } catch (error) {
      logger.error("保存套图URL失败:", error);
    }
  }

  /* ---------- 随机 & 详情处理 ---------- */
  async randomArticleRequest(e) {
    if (this.jgUrls.length === 0) {
      await e.reply("套图URL列表为空，请先使用 #更新套图列表", true);
      return;
    }

    const randomUrl =
      this.jgUrls[Math.floor(Math.random() * this.jgUrls.length)];
    // await e.reply(`正在随机抽取一套美图，URL: ${randomUrl}，请稍等...`, false, {
    await e.reply(`正在随机抽取一套美图，请稍等...`, false, {
      at: true,
    });
    await this.processArticleRequest(e, randomUrl, true);
  }

  /**
   * 下载单张图片并转换为 Base64
   * @param {string} imageUrl 图片URL
   * @param {string} referer  Referer 地址
   * @returns {Promise<string|null>} Base64 字符串（带前缀 base64://）或 null
   */
  downloadImageToBase64(imageUrl, referer) {
    return new Promise((resolve) => {
      const protocol = imageUrl.startsWith("https") ? https : http;
      const options = {
        headers: {
          Referer: referer,
          "User-Agent": this.getRandomUserAgent(),
        },
        timeout: DOWNLOAD_TIMEOUT,
      };

      const req = protocol.get(imageUrl, options, (res) => {
        if (res.statusCode !== 200) {
          logger.warn(`下载图片失败，状态码 ${res.statusCode}: ${imageUrl}`);
          res.resume(); // 消耗响应数据以释放内存
          return resolve(null);
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString("base64");
          const mime = res.headers["content-type"] || "image/jpeg";
          resolve(`base64://${base64}`);
        });
      });

      req.on("error", (err) => {
        logger.warn(`下载图片出错: ${err.message} - ${imageUrl}`);
        resolve(null);
      });

      req.on("timeout", () => {
        req.destroy();
        logger.warn(`下载图片超时: ${imageUrl}`);
        resolve(null);
      });
    });
  }

  /**
   * 并发下载多张图片，转换为 Base64
   * @param {string[]} imageUrls 图片URL数组
   * @param {string} referer Referer
   * @returns {Promise<Array<{url: string, base64: string|null}>>}
   */
  async downloadImagesBatch(imageUrls, referer) {
    const results = [];
    const queue = [...imageUrls];
    const workers = [];

    for (let i = 0; i < DOWNLOAD_CONCURRENCY; i++) {
      workers.push(this.worker(queue, referer, results));
    }
    await Promise.all(workers);
    return results;
  }

  /**
   * 单个工作线程：从队列中取任务下载
   */
  async worker(queue, referer, results) {
    while (queue.length > 0) {
      const url = queue.shift();
      const base64 = await this.downloadImageToBase64(url, referer);
      results.push({ url, base64 });
    }
  }

  /**
   * 发送合并转发消息（兼容 NapCat 与普通 Bot）
   * @param {Array} messages 消息节点数组
   * @param {Object} e 事件对象
   */
  async sendForward(messages, e) {
    if (e.bot?.version?.app_name === "NapCat.Onebot") {
      const nodes = messages.map((msg) => {
        const content = [];
        let msgArray = Array.isArray(msg.message) ? msg.message : [msg.message];
        for (const item of msgArray) {
          if (typeof item === "string")
            content.push({ type: "text", data: { text: item } });
          else if (item?.type === "image") {
            const fileUrl =
              item.data?.file || item.data?.url || item.file || "";
            if (fileUrl)
              content.push({ type: "image", data: { file: fileUrl } });
            else
              content.push({ type: "text", data: { text: "[图片解析失败]" } });
          } else
            content.push({ type: "text", data: { text: "不支持的消息类型" } });
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
        if (e.isGroup)
          await e.bot.sendApi("send_group_forward_msg", requestBody);
        else await e.bot.sendApi("send_private_forward_msg", requestBody);
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
   * 处理套图请求（根据URL解析图片）
   * @param {Object} e - 消息事件对象
   * @param {string} [targetUrl] - 指定要解析的套图URL
   * @param {boolean} [skipTip=false] - 是否跳过初始提示
   * @async
   */
  async processArticleRequest(e, targetUrl, skipTip = false) {
    let url = targetUrl;
    if (!url) {
      const match = e.msg.match(/^#?套图详情\s+(https?:\/\/[^\s]+)$/);
      if (!match) return;
      url = match[1];
    }

    if (!skipTip) {
      await e.reply("正在解析套图，请稍等...", false, {
        at: true,
        recallMsg: 60,
      });
    }

    try {
      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });
      const page = await browser.newPage();
      await page.setUserAgent(this.getRandomUserAgent());
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

      // ----- 提取机构、发布时间、标题 -----
      let organization = "未知机构",
        publishDate = "未知时间",
        articleTitle = "未知标题";
      try {
        organization = await page.$eval(
          "div.position div.w1200 a:nth-child(3)",
          (el) => el.getAttribute("title") || el.textContent.trim(),
        );
      } catch (error) {
        try {
          organization = await page.$eval(
            "div.position div.w1200 a:last-child",
            (el) => el.getAttribute("title") || el.textContent.trim(),
          );
        } catch (e) {}
      }
      try {
        const breadcrumbText = await page.$eval(
          "div.position div.w1200",
          (el) => el.innerText,
        );
        const dateMatch = breadcrumbText.match(/\b(\d{4}\.\d{2}\.\d{2})\b/);
        if (dateMatch) publishDate = dateMatch[1];
      } catch (error) {
        logger.error("获取发布时间失败:", error);
      }
      try {
        articleTitle = await page.$eval("div.position div.w1200", (el) => {
          const text = el.innerText;
          const parts = text.split(">");
          return parts.length ? parts[parts.length - 1].trim() : text.trim();
        });
      } catch (error) {
        articleTitle = await page.title();
      }

      // ----- 获取总页数 -----
      let totalPages = 1;
      try {
        const pageNumbers = await page.$$eval("div.page a", (links) =>
          links
            .map((a) => a.textContent.trim())
            .filter((t) => /^\d+$/.test(t))
            .map(Number),
        );
        if (pageNumbers.length > 0) totalPages = Math.max(...pageNumbers);
        else {
          const pageText = await page.$eval("div.page", (el) => el.innerText);
          const match = pageText.match(/共\s*(\d+)\s*页/);
          if (match) totalPages = parseInt(match[1]);
        }
      } catch (error) {
        logger.warn("未找到分页信息，仅获取当前页图片");
      }

      const MAX_PAGES = 20;
      if (totalPages > MAX_PAGES) totalPages = MAX_PAGES;

      // ----- 收集所有图片URL -----
      const imageUrls = new Set();
      const baseUrl = url.replace(/\.html$/, "");
      for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
        let pageUrl = url;
        if (pageNo > 1) pageUrl = `${baseUrl}_${pageNo}.html`;
        if (pageNo !== 1) {
          try {
            await page.goto(pageUrl, {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
          } catch (err) {
            logger.warn(
              `跳转到分页 ${pageUrl} 失败，可能不存在: ${err.message}`,
            );
            continue;
          }
        }
        const pageImages = await page.$$eval(
          "div.content img.tupian_img",
          (imgs) =>
            imgs
              .map((img) => img.src)
              .filter((src) => src && src.startsWith("http")),
        );
        for (const imgUrl of pageImages) imageUrls.add(imgUrl);
        // if (imageUrls.size >= 100) break; // 仍保留100张上限（可自行调整）
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await browser.close();

      const uniqueImageUrls = Array.from(imageUrls);
      if (uniqueImageUrls.length === 0) {
        await e.reply("没有找到任何图片，请稍后再试。", true);
        return;
      }

      // ----- 下载所有图片并转换为 Base64（携带 Referer）-----
      await e.reply(
        `共找到 ${uniqueImageUrls.length} 张图片，正在下载...`,
        false,
        { at: true, recallMsg: 30 },
      );
      const downloadResults = await this.downloadImagesBatch(
        uniqueImageUrls,
        url,
      );

      // 构建图片消息项：优先使用 Base64，失败则保留原 URL
      const imageMessages = downloadResults.map((result) => {
        if (result.base64) {
          return {
            message: segment.image(result.base64),
            nickname: e.user_id.toString(),
            user_id: e.user_id,
          };
        } else {
          return {
            message: segment.image(result.url),
            nickname: e.user_id.toString(),
            user_id: e.user_id,
          };
        }
      });

      // 构建文本消息（固定信息）
      const textMessages = [
        {
          message: `📌 标题: ${articleTitle}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        {
          message: `🏷️ 机构: ${organization}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        {
          message: `⏰ 发布时间: ${publishDate}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        {
          message: `🔗 原链接: ${url}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
      ];

      // 将图片消息分批
      const batches = [];
      for (let i = 0; i < imageMessages.length; i += BATCH_SIZE) {
        batches.push(imageMessages.slice(i, i + BATCH_SIZE));
      }

      // 分批发送
      for (let i = 0; i < batches.length; i++) {
        let batchMessages;
        if (i === 0) {
          // 第一批：包含文本信息 + 该批图片
          batchMessages = [...textMessages, ...batches[i]];
        } else {
          // 后续批次：添加提示文字 + 该批图片
          const tip = {
            message: `--- 第 ${i + 1} 批图片 (共 ${batches.length} 批) ---`,
            nickname: e.user_id.toString(),
            user_id: e.user_id,
          };
          batchMessages = [tip, ...batches[i]];
        }
        await this.sendForward(batchMessages, e);
        // 批次间延迟，避免请求过快
        if (i < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      }
    } catch (error) {
      logger.error(`操作失败：${error.message}`);
      await e.reply("连接网页失败，请稍后再试", true);
    }
  }

  /* ---------- 核心采集方法（与 Python 脚本逻辑一致） ---------- */

  /**
   * 获取列表总页数（支持重试）
   * @param {import('puppeteer').Browser} browser - Puppeteer浏览器实例
   * @returns {Promise<number|null>} 总页数，获取失败返回 null
   */
  async getTotalPages(browser) {
    const page = await browser.newPage();
    try {
      await page.setUserAgent(this.getRandomUserAgent());
      await page.goto("https://www.ku1373.cc/b/1/", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      // 尝试从 span.pageinfo 获取
      try {
        const pageInfoText = await page.$eval(
          "div.list div.w1200 div.page span.pageinfo",
          (el) => el.innerText,
        );
        const match = pageInfoText.match(/共\s*(\d+)\s*页/);
        if (match) {
          const pages = parseInt(match[1]);
          logger.info(`从 pageinfo 解析到总页数: ${pages}`);
          return pages;
        }
      } catch (e) {
        logger.warn("span.pageinfo 解析失败，尝试从分页链接获取");
      }

      // 备用：从分页链接中找最大页码
      try {
        const pageNumbers = await page.$$eval("div.page a", (links) =>
          links
            .map((a) => parseInt(a.textContent.trim()))
            .filter((n) => !isNaN(n)),
        );
        if (pageNumbers.length > 0) {
          const maxPage = Math.max(...pageNumbers);
          logger.info(`从分页链接获取到最大页码: ${maxPage}`);
          return maxPage;
        }
      } catch (e) {
        logger.warn("从分页链接获取页码失败");
      }

      logger.error("无法获取总页数");
      return null;
    } catch (error) {
      logger.error(`获取总页数失败: ${error.message}`);
      return null;
    } finally {
      await page.close();
    }
  }

  /**
   * 通用采集单页套图URL（支持重试，直到成功）
   * @param {import('puppeteer').Browser} browser - Puppeteer浏览器实例
   * @param {number} pageNum - 页码（从1开始）
   * @returns {Promise<string[]>} 该页所有套图详情页URL（去重后）
   */
  async fetchPageUrls(browser, pageNum) {
    const url =
      pageNum === 1
        ? "https://www.ku1373.cc/b/1/"
        : `https://www.ku1373.cc/b/1/list_1_${pageNum}.html`;

    for (let attempt = 1; attempt <= RETRY_TIMES; attempt++) {
      const page = await browser.newPage();
      try {
        await page.setUserAgent(this.getRandomUserAgent());
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

        // 主选择器
        let urls = await page.$$eval(
          "div.list div.w1200 div.l-pub div.m-list.ml1 ul.cl li a",
          (links) =>
            links
              .map((a) => a.href)
              .filter((href) => href && href.startsWith("http")),
        );

        // 如果主选择器没找到，尝试备用选择器
        if (!urls || urls.length === 0) {
          urls = await page.$$eval("div.m-list ul.cl li a", (links) =>
            links
              .map((a) => a.href)
              .filter((href) => href && href.startsWith("http")),
          );
        }

        // 处理相对路径
        urls = urls.map((href) => {
          if (href.startsWith("/")) {
            return "https://www.ku1373.cc" + href;
          }
          return href;
        });

        const uniqueUrls = [...new Set(urls)];
        logger.info(
          `第 ${pageNum} 页采集到 ${uniqueUrls.length} 个套图链接 (尝试 ${attempt})`,
        );
        return uniqueUrls;
      } catch (error) {
        logger.warn(
          `第 ${pageNum} 页采集失败 (尝试 ${attempt}/${RETRY_TIMES}): ${error.message}`,
        );
        if (attempt === RETRY_TIMES) {
          logger.error(`第 ${pageNum} 页已达到最大重试次数，返回空列表`);
          return [];
        }
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY * attempt),
        );
      } finally {
        await page.close();
      }
    }
    return [];
  }

  /**
   * 增量更新（如果列表为空则自动转为全量更新）
   * @param {Object|null} e - 消息事件对象
   */
  async incrementalUpdate(e) {
    if (e && !e.isMaster) {
      e.reply("仅主人可用", true);
      return true;
    }

    if (this.jgUrls.length === 0) {
      logger.info("套图URL列表为空，自动转为全量更新");
      await this.fullUpdate(e);
      return;
    }

    if (e) await e.reply("开始增量更新套图URL列表（只采集最新页面）...", true);
    else logger.info("[定时任务] 开始自动增量更新套图URL");

    let browser;
    try {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });

      const maxPages = await this.getTotalPages(browser);
      if (maxPages === null) throw new Error("无法获取总页数，增量更新终止");

      const pagesToFetch = Math.min(MAX_INCREMENTAL_PAGES, maxPages);
      const allNewUrls = new Set();

      for (let pageNum = 1; pageNum <= pagesToFetch; pageNum++) {
        const urls = await this.fetchPageUrls(browser, pageNum);
        for (const url of urls) allNewUrls.add(url);
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      const combinedSet = new Set([...this.jgUrls, ...allNewUrls]);
      const newUrls = Array.from(combinedSet);
      const previousCount = this.jgUrls.length;
      this.jgUrls = newUrls;
      await this.saveUrls();

      const msg = `增量更新完成！本次采集前 ${pagesToFetch} 页，共获取 ${allNewUrls.size} 个新套图（现有总计 ${this.jgUrls.length} 个，原为 ${previousCount} 个）`;
      if (e) await e.reply(msg, true);
      else logger.info(`[定时任务] ${msg}`);
    } catch (error) {
      logger.error("增量更新失败:", error);
      if (e) await e.reply(`增量更新失败: ${error.message}`, true);
      else logger.error(`[定时任务] 增量更新失败: ${error.message}`);
    } finally {
      if (browser) await browser.close();
    }
  }

  /**
   * 全量更新（从第1页顺序采集到最后一页）
   * @param {Object|null} e - 消息事件对象
   */
  async fullUpdate(e) {
    if (e && !e.isMaster) {
      e.reply("仅主人可用", true);
      return true;
    }
    if (e)
      await e.reply(
        "开始全量更新套图URL列表（从第一页向最后一页顺序采集），这可能需要几分钟时间...",
        true,
      );
    else logger.info("[手动] 开始全量更新套图URL");

    let browser;
    try {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });

      const maxPages = await this.getTotalPages(browser);
      if (maxPages === null) throw new Error("无法获取总页数，全量更新终止");
      logger.info(`列表总页数: ${maxPages}`);

      const allUrlsSet = new Set();

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const urls = await this.fetchPageUrls(browser, pageNum);
        logger.info(
          `第 ${pageNum} 页采集到 ${urls.length} 个链接，当前累计 ${allUrlsSet.size}`,
        );
        for (const url of urls) allUrlsSet.add(url);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const newUrls = Array.from(allUrlsSet);
      const previousCount = this.jgUrls.length;
      this.jgUrls = newUrls;
      await this.saveUrls();

      const msg = `全量更新完成！共获取 ${this.jgUrls.length} 个套图URL (原有 ${previousCount} 个)`;
      if (e) await e.reply(msg, true);
      else logger.info(`[手动] ${msg}`);
    } catch (error) {
      logger.error("全量更新失败:", error);
      if (e) await e.reply(`全量更新失败: ${error.message}`, true);
      else logger.error(`[手动] 全量更新失败: ${error.message}`);
    } finally {
      if (browser) await browser.close();
    }
  }
}
