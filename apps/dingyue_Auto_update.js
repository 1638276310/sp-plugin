import schedule from "node-schedule";
import yaml from "yaml";
import fs from "fs";
import { dingyue, keyValue, pid } from "../config/api.js";

// Dingyue定时更新任务
export class SPPluginDingyueUpdate extends plugin {
  constructor() {
    super({
      name: "sp-plugin订阅推送定时任务",
      dsc: "定时检查画师更新并推送",
      event: "message",
      priority: -Infinity,
      rule: [], // 无触发规则，纯定时任务
    });

    // 启动定时任务
    this.initScheduledTasks();

    // 初始化时加载一次数据
    this.loadDingyueData();
  }

  // 加载订阅数据
  loadDingyueData() {
    try {
      const filePath = "./plugins/sp-plugin/config/dingyue.yaml";
      if (fs.existsSync(filePath)) {
        const fileContents = fs.readFileSync(filePath, "utf8");
        this.dingyueData = yaml.parse(fileContents) || {};
        logger.mark(
          `[sp-plugin] 订阅数据加载成功，共 ${
            Object.keys(this.dingyueData).length
          } 个群组`
        );
      } else {
        this.dingyueData = {};
        logger.warn(`[sp-plugin] 订阅数据文件不存在: ${filePath}`);
      }
    } catch (error) {
      logger.error(`[sp-plugin] 加载订阅数据失败: ${error.message}`);
      this.dingyueData = {};
    }
  }

  // 初始化定时任务
  initScheduledTasks() {
    // 任务1：每10分钟重载一次订阅数据
    schedule.scheduleJob("*/10 * * * *", () => {
      logger.mark("[sp-plugin] 定时重载订阅数据");
      this.loadDingyueData();
    });

    // 任务2：每4小时检查一次更新（带随机延迟）
    schedule.scheduleJob("0 */4 * * *", async () => {
      // 随机延迟0-60分钟
      const randomDelay = Math.floor(Math.random() * 60 * 60 * 1000);
      logger.mark(
        `[sp-plugin] 推送任务将在 ${Math.floor(randomDelay / 60000)} 分钟后开始`
      );

      setTimeout(async () => {
        await this.checkAndPushUpdates();
      }, randomDelay);
    });

    logger.mark(
      "[sp-plugin] 定时任务已启动（每4小时检查一次，10分钟重载数据）"
    );
  }

  // 检查并推送更新
  async checkAndPushUpdates() {
    try {
      const data = this.dingyueData;

      // 准备推送数据
      const allArtistIds = Object.keys(data).flatMap((groupId) =>
        Object.keys(data[groupId].artists || {})
      );
      const uniqueArtistIds = [...new Set(allArtistIds)]; // 去重
      if (uniqueArtistIds.length === 0) {
        logger.mark("[sp-plugin] 没有订阅任何画师");
        return;
      }

      // 调用订阅API获取更新
      const apiUrl = dingyue();
      logger.mark(
        `[sp-plugin] 开始检查 ${uniqueArtistIds.length} 个画师的更新`
      );

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key: keyValue,
          user: uniqueArtistIds,
        }),
      });

      if (!response.ok) {
        logger.error(`[sp-plugin] API请求失败: ${response.status}`);
        return;
      }

      const responseData = await response.json();

      if (!responseData || !responseData.response) {
        logger.warn("[sp-plugin] API返回数据格式异常");
        return;
      }

      // 处理每个群组的更新
      let totalPushes = 0;
      for (const [groupId, groupData] of Object.entries(data)) {
        if (!groupData.pushEnabled) continue;

        try {
          const group = Bot.pickGroup(groupId);

          for (const [artistId, artistName] of Object.entries(
            groupData.artists
          )) {
            const newWorks = responseData.response[artistId];
            if (!newWorks || newWorks.length === 0) continue;

            logger.mark(
              `[sp-plugin] 群组${groupId} 画师${artistName}(${artistId}) 有新作品 ${newWorks.length} 个`
            );

            // 只推送前3个新作品
            for (const workId of newWorks.slice(0, 3)) {
              try {
                // 获取作品详情
                const pidAPI = pid(workId);
                const imgResponse = await fetch(pidAPI);
                const imgData = await imgResponse.json();

                if (!imgData || !imgData.body || !imgData.body.urls) {
                  logger.warn(`[sp-plugin] 作品 ${workId} 数据异常`);
                  continue;
                }

                const tagList = imgData.body.tags.tags.map((tag) => tag.tag);

                // 构建消息
                const infoMsg = [
                  `爷爷，您关注的画师：${imgData.body.userName}（${imgData.body.userId}）更新了`,
                  `作品：${imgData.body.illustTitle}`,
                  `PID：${imgData.body.illustId}`,
                  `是否AI：${imgData.body.aiType === 2 ? "是" : "否"}`,
                  `上传时间：${imgData.body.createDate}`,
                  `♥：${imgData.body.likeCount} 😊：${imgData.body.bookmarkCount} 👁：${imgData.body.viewCount}`,
                  `标签：${tagList.join(", ")}`,
                ].join("\n");

                let message = [infoMsg];

                // 添加图片
                for (const urlKey in imgData.body.urls) {
                  const imageUrl = `${imgData.body.urls[urlKey]}`;
                  message.push(segment.image(imageUrl));
                }

                // 发送消息
                await group.sendMsg(message);
                totalPushes++;

                // 延迟10秒避免频繁发送
                await this.sleep(10000);
              } catch (error) {
                logger.error(
                  `[sp-plugin] 推送作品 ${workId} 失败: ${error.message}`
                );
              }
            }
          }
        } catch (error) {
          logger.error(
            `[sp-plugin] 群组 ${groupId} 推送失败: ${error.message}`
          );
        }
      }

      logger.mark(`[sp-plugin] 推送任务完成，共推送 ${totalPushes} 条消息`);
    } catch (error) {
      logger.error(`[sp-plugin] 推送任务异常: ${error.message}`);
    }
  }

  // 延迟工具函数
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// 导出实例，确保定时任务注册
const dingyueUpdate = new SPPluginDingyueUpdate();

export { dingyueUpdate };
