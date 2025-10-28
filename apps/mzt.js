import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

/**
 * 妹子图图片提取插件
 * @class mztPlugin
 * @classdesc 从妹子图网站提取写真、潮拍和模特图片的插件
 *
 * 功能包括：
 * 1. 根据ID获取写真馆图片
 * 2. 手动/自动更新写真ID列表
 * 3. 随机获取写真图片
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

    // this.task = [
    //   {
    //     cron: "0 30 7 * * *", // 每天07:30执行
    //     name: "自动增量更新写真ID",
    //     fnc: this.fetchAllmztArticleIds.bind(this, null),
    //     log: true,
    //   },
    // ];

    /**
     * 写真ID列表
     * @type {Array<number>}
     */
    this.mztIds = [];

    // 初始化时加载写真ID
    this.loadmztIds();
  }

  // ✅ 放在这里，类内部但不在任何方法里
  getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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
    // await e.reply(`写真ID：${randomId} 正在搜索，请稍等...`, false, { at: true, recallMsg: 60 });
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
      await page.setUserAgent(this.getRandomUserAgent());

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

        // 构建请求体 - 添加固定信息
        const requestBody = {
          group_id: e.group_id,
          user_id: e.user_id,
          message: nodes,
          news: [{ text: "QQ/VX：1638276310" }],
          prompt: "QQ/VX：1638276310",
          summary: `QQ/VX：1638276310`,
          source: "QQ/VX：1638276310",
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
   * 增量更新写真ID列表
   * @param {Object|null} e - 消息事件对象（定时任务时为null）
   * @async
   * @description 增量爬取妹子图网站的写真ID并保存
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
