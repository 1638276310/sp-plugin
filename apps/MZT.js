import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

/**
 * 妹子图图片提取插件
 * @class mztPlugin
 * @classdesc 从妹子图网站提取写真、潮拍和模特图片的插件
 *
 * 功能包括：
 * 1. 根据ID获取写真馆图片
 * 2. 手动/自动更新写真ID列表
 * 3. 手动/自动更新潮拍ID列表
 * 4. 手动/自动更新模特ID列表
 * 5. 随机获取写真图片
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
 * // #写真馆12345
 * // #更新写真ID
 * // #随机写真
 */
export class mztPlugin extends plugin {
  /**
   * 插件构造函数
   * @constructs mztPlugin
   */
  constructor() {
    super({
      name: "mzt图片提取插件",
      dsc: "从妹子图网站提取妹子的图片",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: "^#?写真馆(\\d+)$",
          fnc: "processmztRequest",
        },
        {
          reg: "^#?更新写真(ID|id)$",
          fnc: "fetchAllmztArticleIds",
        },
        {
          reg: "^#?更新潮拍(ID|id)$",
          fnc: "fetchAllBeautyArticleIds",
        },
        {
          reg: "^#?更新模特(ID|id)$",
          fnc: "fetchAllModelArticleIds",
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
        cron: "0 45 2 * * ? ", // 每天02:45执行
        name: "自动更新写真ID",
        fnc: this.fetchAllmztArticleIds.bind(this, null),
        log: true,
      },
      {
        cron: "0 0 3 * * ? ", // 每天03:00执行
        name: "自动更新潮拍ID",
        fnc: this.fetchAllBeautyArticleIds.bind(this, null),
        log: true,
      },
      {
        cron: "0 15 3 * * ? ", // 每天03:15执行
        name: "自动更新模特ID",
        fnc: this.fetchAllModelArticleIds.bind(this, null),
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
   */
  async randommztRequest(e) {
    if (this.mztIds.length === 0) {
      await e.reply("写真ID列表为空，请先使用 #更新写真ID", true);
      return;
    }

    const randomId =
      this.mztIds[Math.floor(Math.random() * this.mztIds.length)];
    await this.processmztRequest({
      ...e,
      msg: `#写真馆${randomId}`,
    });
  }

  /**
   * 处理写真请求
   * @param {Object} e - 消息事件对象
   * @async
   * @description 根据提供的ID获取妹子图网站的图片并发送
   * @throws {Error} 如果无法获取图片或发送消息失败
   */
  async processmztRequest(e) {
    await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
    const match = e.msg.match(/^#?写真馆(\d+)$/);
    if (!match) return;

    const articleId = match[1];
    const baseUrl = `https://kkmzt.com/photo/${articleId}`;

    try {
      // 启动浏览器实例
      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });
      const page = await browser.newPage();

      // 设置用户代理防止被识别为爬虫
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // 导航到目标页面
      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      // 获取文章标题和发布时间
      let articleTitle = "未知标题";
      let publishTime = "未知时间";
      try {
        articleTitle = await page.$eval(
          "h1.uk-article-title.uk-text-truncate",
          (el) => el.textContent.trim()
        );
      } catch (error) {
        logger.error("获取文章标题失败:", error);
      }
      try {
        publishTime = await page.$eval("time", (el) => el.textContent.trim());
      } catch (error) {
        logger.error("获取发布时间失败:", error);
      }

      // 收集图片URL
      const imageUrls = new Set();
      let imageCount = 0;

      // 初始页面图片收集
      let pageImages = await page.$$eval(
        'img[referrerpolicy="origin"]',
        (imgs) => imgs.map((img) => img.src)
      );
      if (pageImages.length > 0) {
        for (const imgUrl of pageImages) {
          if (imageCount >= 20) break;
          imageUrls.add(imgUrl);
          imageCount++;
          logger.info(`找到图片 (${imageCount}): ${imgUrl}`);
        }
      } else {
        logger.info("在初始页面上未找到符合条件的图片");
      }

      // 翻页收集更多图片
      while (imageCount < 20) {
        const nextButton = await page.$(
          'div.uk-position-center-right.uk-overlay.uk-overlay-default.f-swich[action="next"]'
        );
        if (!nextButton) {
          logger.info("未找到下一页按钮，结束爬取");
          break;
        }

        logger.info("点击了下一页按钮，等待1秒...");
        await nextButton.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));

        pageImages = await page.$$eval('img[referrerpolicy="origin"]', (imgs) =>
          imgs.map((img) => img.src)
        );

        if (pageImages.length > 0) {
          for (const imgUrl of pageImages) {
            if (imageCount >= 20) break;
            if (!imageUrls.has(imgUrl)) {
              imageUrls.add(imgUrl);
              imageCount++;
              logger.info(`找到图片 (${imageCount}): ${imgUrl}`);
            }
          }
        } else {
          logger.info("在新页面上未找到符合条件的图片元素");
        }
      }

      await browser.close();
      const uniqueImageUrls = Array.from(imageUrls);
      logger.info(`总共获取到 ${uniqueImageUrls.length} 张不重复的图片`);

      // 检查是否获取到图片
      if (uniqueImageUrls.length === 0) {
        await e.reply("没有找到任何图片，请稍后再试。", true);
        return;
      }

      // 构建转发消息
      const messages = [
        {
          message: `📌 文章标题: ${articleTitle}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        {
          message: `⏰ 发布时间: ${publishTime}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        {
          message: `🆔 文章ID: ${articleId}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        ...uniqueImageUrls.map((url) => ({
          message: segment.image(url),
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        })),
      ];

      // 处理NapCat.Onebot的特殊转发格式
      if (e.bot?.version?.app_name === "NapCat.Onebot") {
        const nodes = messages.map((msg) => {
          const content = [];
          let msgArray = [];

          // 处理不同类型的消息内容
          if (Array.isArray(msg.message)) {
            msgArray = msg.message;
          } else if (typeof msg.message === "string") {
            msgArray = [msg.message];
          } else {
            msgArray = [msg.message];
          }

          // 构建消息节点
          for (const item of msgArray) {
            if (typeof item === "string") {
              content.push({
                type: "text",
                data: { text: item },
              });
            } else if (item?.type === "image") {
              // 安全获取图片URL
              const fileUrl =
                item.data?.file || item.data?.url || item.file || "";
              if (fileUrl) {
                content.push({
                  type: "image",
                  data: { file: fileUrl },
                });
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
            data: {
              nickname: msg.nickname,
              user_id: msg.user_id,
              content: content,
            },
          };
        });

        // 构建请求体
        const requestBody = {
          group_id: e.group_id,
          user_id: e.user_id,
          message: nodes,
        };

        try {
          // 根据消息类型发送
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
        // 标准转发消息处理
        try {
          const forwardMsg = await Bot.makeForwardMsg(messages);
          await e.reply(forwardMsg);
        } catch (error) {
          logger.error("创建转发消息失败:", error);
          await e.reply("消息发送失败，请稍后再试", true);
        }
      }
    } catch (error) {
      logger.error(`操作失败：${error.message}`);
      await e.reply("连接网页失败，请稍后再试", true);
    }
  }

  /**
   * 更新写真ID列表
   * @param {Object|null} e - 消息事件对象（定时任务时为null）
   * @async
   * @description 爬取妹子图网站的所有写真ID并保存
   */
  async fetchAllmztArticleIds(e) {
    // 权限检查
    if (e && !e.isMaster) {
      e.reply("仅主人可用", true);
      return true;
    }

    // 通知用户
    if (e) {
      await e.reply("开始更新写真ID列表，这可能需要几分钟时间...", true);
    } else {
      logger.info("[定时任务] 开始自动更新写真ID");
    }

    const baseUrl = "https://kkmzt.com/photo/";
    const allIds = [];
    let browser;

    try {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // 导航到目标页面
      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      // 获取总页数
      let totalPages = 1;
      const pagination = await page.$("ul.uk-pagination");
      if (pagination) {
        const lastPageElement = await pagination.$("li:nth-last-child(2)");
        if (lastPageElement) {
          const lastPageText = await lastPageElement.evaluate((el) =>
            el.textContent?.trim()
          );
          if (lastPageText && !isNaN(lastPageText)) {
            totalPages = parseInt(lastPageText);
          }
        }
      }
      logger.info(`检测到总页数: ${totalPages}`);

      // 遍历所有页面收集ID
      for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
        const pageUrl =
          currentPage === 1 ? baseUrl : `${baseUrl}page/${currentPage}/`;
        if (currentPage > 1) {
          await page.goto(pageUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
        }

        // 提取当前页面ID
        const pageIds = await page.$$eval("a.uk-inline.u-thumb-v", (links) =>
          links
            .map((link) => {
              const match = link.href.match(/\/photo\/(\d+)\/?$/);
              return match ? match[1] : null;
            })
            .filter(Boolean)
        );

        allIds.push(...pageIds);
        logger.info(
          `第 ${currentPage}/${totalPages} 页完成，收集到 ${pageIds.length} 个ID`
        );

        // 延迟防止请求过快
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // 去重并保存ID
      const uniqueIds = [...new Set(allIds)];
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
      fs.writeFileSync(filePath, JSON.stringify(uniqueIds), "utf8");
      logger.info(`文章ID已保存到 ${filePath}`);

      // 更新内存中的ID列表
      this.mztIds = uniqueIds;

      // 完成通知
      if (e) {
        await e.reply(`ID收集完成！共获取 ${uniqueIds.length} 个唯一ID`, true);
      } else {
        logger.info(`[定时任务] 写真ID更新完成，共 ${uniqueIds.length} 个ID`);
      }
    } catch (error) {
      logger.error("ID收集失败:", error);
      if (e) {
        await e.reply(`ID收集失败: ${error.message}`, true);
      } else {
        logger.error(`[定时任务] 写真ID更新失败: ${error.message}`);
      }
    } finally {
      if (browser) await browser.close();
    }
  }

  /**
   * 更新潮拍ID列表
   * @param {Object|null} e - 消息事件对象（定时任务时为null）
   * @async
   * @description 爬取妹子图网站的所有潮拍ID并保存
   */
  async fetchAllBeautyArticleIds(e) {
    // 权限检查
    if (e && !e.isMaster) {
      e.reply("仅主人可用", true);
      return true;
    }

    // 通知用户
    if (e) {
      await e.reply("开始更新潮拍ID列表，这可能需要几分钟时间...", true);
    } else {
      logger.info("[定时任务] 开始自动更新潮拍ID");
    }

    const baseUrl = "https://kkmzt.com/beauty/";
    const allIds = [];
    let browser;

    try {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // 导航到目标页面
      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      // 获取总页数
      let totalPages = 1;
      const pagination = await page.$("ul.uk-pagination");
      if (pagination) {
        const lastPageElement = await pagination.$("li:nth-last-child(2)");
        if (lastPageElement) {
          const lastPageText = await lastPageElement.evaluate((el) =>
            el.textContent?.trim()
          );
          if (lastPageText && !isNaN(lastPageText)) {
            totalPages = parseInt(lastPageText);
          }
        }
      }
      logger.info(`检测到总页数: ${totalPages}`);

      // 遍历所有页面收集ID
      for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
        const pageUrl =
          currentPage === 1 ? baseUrl : `${baseUrl}page/${currentPage}/`;
        if (currentPage > 1) {
          await page.goto(pageUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
        }

        // 提取当前页面ID
        const pageIds = await page.$$eval(
          "div.uk-article h2.uk-margin-remove a",
          (links) =>
            links
              .map((link) => {
                const match = link.href.match(/\/beauty\/(\d+)\/?$/);
                return match ? match[1] : null;
              })
              .filter(Boolean)
        );

        allIds.push(...pageIds);
        logger.info(
          `第 ${currentPage}/${totalPages} 页完成，收集到 ${pageIds.length} 个潮拍ID`
        );

        // 延迟防止请求过快
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // 去重并保存ID
      const uniqueIds = [...new Set(allIds)];
      const filePath = path.join(
        process.cwd(),
        "data",
        "sp-plugin",
        "beautyids.json"
      );

      // 确保目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件
      fs.writeFileSync(filePath, JSON.stringify(uniqueIds), "utf8");
      logger.info(`潮拍ID已保存到 ${filePath}`);

      // 完成通知
      if (e) {
        await e.reply(
          `潮拍ID收集完成！共获取 ${uniqueIds.length} 个唯一ID`,
          true
        );
      } else {
        logger.info(`[定时任务] 潮拍ID更新完成，共 ${uniqueIds.length} 个ID`);
      }
    } catch (error) {
      logger.error("潮拍ID收集失败:", error);
      if (e) {
        await e.reply(`潮拍ID收集失败: ${error.message}`, true);
      } else {
        logger.error(`[定时任务] 潮拍ID更新失败: ${error.message}`);
      }
    } finally {
      if (browser) await browser.close();
    }
  }

  /**
   * 更新模特ID列表
   * @param {Object|null} e - 消息事件对象（定时任务时为null）
   * @async
   * @description 爬取妹子图网站的所有模特ID并保存
   */
  async fetchAllModelArticleIds(e) {
    // 权限检查
    if (e && !e.isMaster) {
      e.reply("仅主人可用", true);
      return true;
    }

    // 记录开始时间
    const startTime = Date.now();

    // 通知用户
    if (e) {
      await e.reply("开始更新模特ID列表，这可能需要较长时间...", true);
    } else {
      logger.info("[定时任务] 开始自动更新模特ID");
    }

    const baseUrl = "https://kkmzt.com/photo/model/";
    const modelData = {};
    let browser;

    // 进度跟踪
    let processedCount = 0;
    let totalModels = 0;
    let totalArticles = 0;

    try {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: "new",
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // 第一步：获取所有模特信息
      await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      // 提取模特信息
      const models = await page.$$eval("ul.g-list.g-list-model li", (items) =>
        items
          .map((item) => {
            const nameElement = item.querySelector("h2.uk-card-title a");
            const urlElement = item.querySelector("div.uk-card-media-top a");
            return {
              name: nameElement ? nameElement.textContent.trim() : null,
              url: urlElement ? urlElement.href : null,
            };
          })
          .filter((model) => model.name && model.url)
      );

      totalModels = models.length;
      logger.info(`找到 ${totalModels} 个模特`);

      // 第二步：为每个模特收集写真ID
      for (const [index, model] of models.entries()) {
        processedCount = index + 1;
        logger.info(`处理模特 ${processedCount}/${totalModels}: ${model.name}`);

        const modelIds = [];
        // 导航到模特页面
        await page.goto(model.url, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });

        // 获取总页数
        let totalPages = 1;
        const pagination = await page.$("ul.uk-pagination");
        if (pagination) {
          const lastPageElement = await pagination.$("li:nth-last-child(2)");
          if (lastPageElement) {
            const lastPageText = await lastPageElement.evaluate((el) =>
              el.textContent?.trim()
            );
            if (lastPageText && !isNaN(lastPageText)) {
              totalPages = parseInt(lastPageText);
            }
          }
        }

        // 遍历模特的所有页面
        for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
          const pageUrl =
            currentPage === 1 ? model.url : `${model.url}page/${currentPage}/`;
          if (currentPage > 1) {
            await page.goto(pageUrl, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            });
          }

          // 提取当前页面的写真ID
          const pageIds = await page.$$eval("a.uk-inline.u-thumb-v", (links) =>
            links
              .map((link) => {
                const match = link.href.match(/\/photo\/(\d+)\/?$/);
                return match ? match[1] : null;
              })
              .filter(Boolean)
          );

          modelIds.push(...pageIds);
          logger.info(
            `  模特 ${model.name} 第 ${currentPage}/${totalPages} 页完成，收集到 ${pageIds.length} 个ID`
          );

          // 延迟防止请求过快
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        // 保存模特数据
        modelData[model.name] = [...new Set(modelIds)];
        totalArticles += modelData[model.name].length;
        logger.info(
          `模特 ${model.name} 完成，共收集 ${
            modelData[model.name].length
          } 个唯一ID`
        );
      }

      // 保存数据到文件
      const filePath = path.join(
        process.cwd(),
        "data",
        "sp-plugin",
        "mzt.json"
      );

      // 确保目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件
      fs.writeFileSync(filePath, JSON.stringify(modelData, null, 2), "utf8");
      logger.info(`模特ID已保存到 ${filePath}`);

      // 计算耗时
      const duration = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;

      // 构建结果消息
      const resultMsg =
        `模特ID收集完成！\n` +
        `共获取 ${Object.keys(modelData).length} 位模特信息\n` +
        `收录写真集总数: ${totalArticles}\n` +
        `耗时: ${minutes}分${seconds}秒`;

      // 发送结果
      if (e) {
        await e.reply(resultMsg, true);
      } else {
        logger.info(`[定时任务] ${resultMsg}`);
      }
    } catch (error) {
      logger.error("模特ID收集失败:", error);
      // 构建错误消息
      const errorMsg =
        `模特ID收集失败: ${error.message}\n` +
        `已处理 ${processedCount}/${totalModels} 位模特`;

      // 发送错误消息
      if (e) {
        await e.reply(errorMsg, true);
      } else {
        logger.error(`[定时任务] ${errorMsg}`);
      }
    } finally {
      if (browser) await browser.close();
    }
  }
}
