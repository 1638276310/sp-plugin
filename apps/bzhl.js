// 插件名称：暴走黑料搜索（增强版）
// 功能：直接访问文章ID + 解析文章文字内容 + 图片转base64 + 视频标记
// 特点：完全等待所有图片加载完成后再进行解析，确保获取到完整的blob图片数据
// 兼容puppeteer版本（24.34.0）
// 无处理视频解析，仅标记视频位置

import puppeteer from "puppeteer";

export class BzhlSearch extends plugin {
  constructor() {
    super({
      name: "暴走黑料搜索",
      dsc: "暴走黑料文章解析（图片base64转发）",
      event: "message",
      priority: -Infinity,
      rule: [
        { reg: "^#?黑料\\s*(\\d+)$", fnc: "processArticleSearch" },
        { reg: "^#?随机黑料$", fnc: "randomArticleSearch" },
      ],
    });

    this.baseUrls = [
      "https://pc001.bkih1ca5.work",
      "https://hl007.okbktyd8.work",
      "https://pchl.5r1ilblr.work",
    ];
  }

  /* ================= 文章解析（文字 + 图片base64 + 视频标记） ================= */

  async processArticleSearch(e) {
    const id = e.msg.match(/(\d+)/)?.[1];
    if (!id) return;

    e &&
      (await e.reply(`正在解析文章ID ${id}，请稍候...`, false, { at: true }));

    for (const baseUrl of this.baseUrls) {
      let browser = null;

      try {
        browser = await puppeteer.launch({
          headless: "new",
          args: ["--no-sandbox"],
        });
        const page = await browser.newPage();

        await page.goto(`${baseUrl}/hometype/${id}`, {
          waitUntil: "networkidle2",
        });

        // 检查页面是否存在"动态不存在"的提示
        const pageNotFound = await page.evaluate(() => {
          const notFoundElement = document.querySelector("div.van-toast__text");
          return (
            notFoundElement && notFoundElement.innerText.includes("动态不存在")
          );
        });

        if (pageNotFound) {
          if (browser) await browser.close();
          await e.reply(`文章ID ${id} 不存在`, false, { at: true });
          return;
        }

        // 等待页面初步稳定
        await page.evaluate(
          () => new Promise((resolve) => setTimeout(resolve, 2000))
        );

        // 滚动页面以触发所有图片懒加载
        await this.scrollToLoadAllImages(page);

        // 等待所有图片完全加载完成
        await this.waitForAllImagesCompleteLoaded(page);

        // 解析文章内容（文字、图片、视频）
        const data = await page.evaluate(async () => {
          const title =
            document.querySelector(".homeType .title")?.innerText.trim() || "";

          const time =
            document
              .querySelector(".homeType .tag span:nth-child(3)")
              ?.innerText.replace("·", "")
              .trim() || "";

          // 获取所有内容元素
          const contentElements = document.querySelectorAll(
            ".homeType .content .info"
          );

          let contentParts = []; // 用于存储所有内容块
          let imageCount = 0; // 图片计数器
          let videoCount = 0; // 视频计数器

          for (const element of contentElements) {
            // 处理文字内容
            const textElement = element.querySelector(".text");
            if (textElement && textElement.innerText.trim()) {
              contentParts.push({
                type: "text",
                content: textElement.innerText.trim(),
              });
            }

            // 处理图片 - 获取所有图片元素
            const imgElements = element.querySelectorAll(
              ".coverImg img.van-image__img"
            );

            if (imgElements.length > 0) {
              for (const imgEl of imgElements) {
                try {
                  // 检查图片是否已加载完成
                  const lazyAttr = imgEl.getAttribute("lazy");
                  const src = imgEl.src;
                  const dataSrc = imgEl.getAttribute("data-src");

                  // 验证图片已完全加载：lazy="loaded" 且 src 和 data-src 都是 blob 格式
                  if (
                    lazyAttr === "loaded" &&
                    src.startsWith("blob:") &&
                    dataSrc &&
                    dataSrc.startsWith("blob:")
                  ) {
                    imageCount++;

                    // 使用fetch获取blob数据并转换为base64
                    try {
                      const response = await fetch(src);
                      const blob = await response.blob();

                      // 将blob转换为base64
                      const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          // 移除data:image/...;base64,前缀
                          const base64Data = reader.result.split(",")[1];
                          resolve(base64Data);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                      });

                      // 压缩图片（如果base64太大）
                      let finalBase64 = base64;
                      const base64Size = (base64.length * 3) / 4; // 估算字节大小

                      if (base64Size > 2 * 1024 * 1024) {
                        // 如果大于2MB
                        // 使用canvas压缩图片
                        const compressedBase64 = await new Promise(
                          (resolve, reject) => {
                            const img = new Image();
                            img.onload = () => {
                              const canvas = document.createElement("canvas");
                              let width = img.width;
                              let height = img.height;

                              // 如果图片太大，按比例缩小
                              const maxDimension = 1200; // 最大尺寸
                              if (
                                width > maxDimension ||
                                height > maxDimension
                              ) {
                                if (width > height) {
                                  height = (height * maxDimension) / width;
                                  width = maxDimension;
                                } else {
                                  width = (width * maxDimension) / height;
                                  height = maxDimension;
                                }
                              }

                              canvas.width = width;
                              canvas.height = height;
                              const ctx = canvas.getContext("2d");
                              ctx.drawImage(img, 0, 0, width, height);

                              // 使用jpeg格式压缩，质量0.8
                              const compressedDataUrl = canvas.toDataURL(
                                "image/jpeg",
                                0.8
                              );
                              resolve(compressedDataUrl.split(",")[1]);
                            };
                            img.onerror = reject;
                            img.src = `data:image/jpeg;base64,${base64}`;
                          }
                        );

                        finalBase64 = compressedBase64;
                      }

                      contentParts.push({
                        type: "image",
                        content: finalBase64,
                        index: imageCount,
                      });
                    } catch (imgErr) {
                      console.error("图片转换失败:", imgErr);
                      contentParts.push({
                        type: "text",
                        content: `[图片${imageCount}转换失败]`,
                      });
                    }
                  } else {
                    // 图片未加载完成（这种情况不应该发生，因为我们已经等待了所有图片加载）
                    imageCount++;
                    contentParts.push({
                      type: "text",
                      content: `[图片${imageCount}加载异常]`,
                    });
                  }
                } catch (err) {
                  imageCount++;
                  contentParts.push({
                    type: "text",
                    content: `[图片${imageCount}解析错误]`,
                  });
                }
              }
            }

            // 处理视频 - 精确遍历每个视频元素
            const videoElements = element.querySelectorAll(".video");
            if (videoElements.length > 0) {
              for (const videoEl of videoElements) {
                videoCount++;
                contentParts.push({
                  type: "text",
                  content: `[视频${videoCount}]`,
                });
              }
            }
          }

          return { title, time, contentParts };
        });

        // 组装消息
        const msgSegments = [];

        // 添加标题和时间
        if (data.title) {
          msgSegments.push(`📝 标题：${data.title}\n`);
        }
        if (data.time) {
          msgSegments.push(`🕒 时间：${data.time}\n`);
        }
        msgSegments.push(`🔗 ID：${id}\n`);
        msgSegments.push(`📄 内容：\n`);

        // 添加内容部分
        let currentText = "";

        for (const part of data.contentParts) {
          if (part.type === "text") {
            currentText += part.content + "\n\n";
          } else if (part.type === "image") {
            // 如果之前有文本，先发送文本
            if (currentText.trim()) {
              msgSegments.push(currentText);
              currentText = "";
            }
            // 发送图片
            msgSegments.push(segment.image(`base64://${part.content}`));
          }
        }

        // 发送剩余的文本
        if (currentText.trim()) {
          msgSegments.push(currentText);
        }

        // 使用转发消息发送（避免消息过长被截断）
        const nodes = [
          {
            user_id: e.user_id,
            nickname: e.sender.nickname,
            message: msgSegments,
          },
        ];

        const msg = await Bot.makeForwardMsg(nodes);
        await e.reply(msg);

        if (browser) await browser.close();
        return;
      } catch (err) {
        logger.error("解析失败:", err);
        if (browser) {
          await browser.close().catch(() => {});
        }
      }
    }

    await e.reply("解析失败，请稍后再试", false, { at: true });
  }

  // 滚动页面以加载所有懒加载图片
  async scrollToLoadAllImages(page) {
    await page.evaluate(async () => {
      // 获取页面总高度
      const scrollHeight = document.body.scrollHeight;
      let currentPosition = 0;
      const distance = 300;

      // 滚动到底部
      while (currentPosition < scrollHeight) {
        window.scrollBy(0, distance);
        currentPosition += distance;

        // 短暂等待以触发懒加载
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 再滚动回顶部，确保所有图片都触发加载
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 再滚动到底部
      currentPosition = 0;
      while (currentPosition < scrollHeight) {
        window.scrollBy(0, distance);
        currentPosition += distance;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });
  }

  // 等待所有图片完全加载完成（无限等待，直到所有图片加载完成）
  async waitForAllImagesCompleteLoaded(page) {
    await page.evaluate(async () => {
      // 无限循环检测图片加载状态
      return new Promise((resolve) => {
        const checkAllImagesLoaded = () => {
          const images = document.querySelectorAll("img.van-image__img");
          let allLoaded = true;

          if (images.length === 0) {
            // 如果没有图片，直接完成
            resolve();
            return;
          }

          console.log(`检查 ${images.length} 张图片的加载状态...`);

          for (const img of images) {
            const lazyAttr = img.getAttribute("lazy");
            const src = img.src;
            const dataSrc = img.getAttribute("data-src");

            // 检查是否完全加载：lazy="loaded" 且 src 和 data-src 都是 blob 格式
            if (
              !(
                lazyAttr === "loaded" &&
                src.startsWith("blob:") &&
                dataSrc &&
                dataSrc.startsWith("blob:")
              )
            ) {
              allLoaded = false;
              console.log(
                `图片未完全加载: lazy="${lazyAttr}", src="${src}", data-src="${dataSrc}"`
              );
              break;
            }
          }

          if (allLoaded) {
            console.log("所有图片已完全加载完成！");
            resolve();
          } else {
            // 继续检查，直到所有图片加载完成
            setTimeout(checkAllImagesLoaded, 500);
          }
        };

        checkAllImagesLoaded();
      });
    });
  }

  // 随机文章搜索
  async randomArticleSearch(e) {
    // 获取最新文章ID作为最大值
    let maxId = 1;

    for (const baseUrl of this.baseUrls) {
      let browser = null;

      try {
        browser = await puppeteer.launch({
          headless: "new",
          args: ["--no-sandbox"],
        });
        const page = await browser.newPage();

        await page.goto(`${baseUrl}/historyarchive`, {
          waitUntil: "networkidle2",
        });

        // 获取第一个文章的ID
        const firstId = await page.evaluate(() => {
          const firstLink = document.querySelector("dl dd a");
          if (firstLink) {
            const href = firstLink.getAttribute("href");
            const match = href.match(/\/hometype\/(\d+)/);
            return match ? parseInt(match[1]) : 1;
          }
          return 1;
        });

        if (browser) await browser.close();

        if (firstId > maxId) {
          maxId = firstId;
        }

        // 成功获取到第一个ID后跳出循环
        break;
      } catch (err) {
        logger.error("获取最新文章ID失败:", err);
        if (browser) await browser.close().catch(() => {});
        continue;
      }
    }

    if (maxId <= 1) {
      await e.reply("无法获取最新文章ID", false, { at: true });
      return;
    }

    // 随机生成一个ID（1到maxId之间）
    const randomId = Math.floor(Math.random() * maxId) + 1;

    // 直接调用processArticleSearch处理随机ID
    await this.processArticleSearch({
      ...e,
      msg: `#黑料 ${randomId}`,
    });
  }
}
