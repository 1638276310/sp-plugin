import axios from "axios";
import fs from "fs";
import YAML from "yaml";
import path from "path";
import { user, keyValue } from "../config/api.js";

export class ArtistSubscription extends plugin {
  constructor() {
    super({
      name: "画师订阅与推送",
      dsc: "订阅画师并控制P站推送",
      event: "message",
      priority: -Infinity,
      rule: [
        { reg: "^#订阅画师(\\d+)$", fnc: "subscribeArtist" },
        { reg: "^#取消订阅(\\d+)$", fnc: "unsubscribeArtist" },
        { reg: "^#订阅列表$", fnc: "listSubscribedArtists" },
        { reg: "^#sp推送$", fnc: "enablePush" },
        { reg: "^#关闭sp推送$", fnc: "disablePush" },
      ],
    });
  }

  ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if (!fs.existsSync(dirname)) {
      this.ensureDirectoryExistence(dirname);
      fs.mkdirSync(dirname);
    }
  }

  loadData() {
    const filePath = "./plugins/sp-plugin/config/dingyue.yaml";
    if (!fs.existsSync(filePath)) return {};
    const fileContents = fs.readFileSync(filePath, "utf8");
    return YAML.parse(fileContents) || {};
  }

  saveData(data) {
    const filePath = "./plugins/sp-plugin/config/dingyue.yaml";
    this.ensureDirectoryExistence(filePath);
    const yamlContent = YAML.stringify(data);
    fs.writeFileSync(filePath, yamlContent, "utf8");
  }

  // 通用回复函数 - 处理NapCat.Onebot的特殊格式
  async customReply(e, message) {
    // 检查是否为NapCat.Onebot环境
    if (e.bot?.version?.app_name === "NapCat.Onebot") {
      const nodes = [
        {
          message: message,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
      ];

      const nodeList = nodes.map((msg) => {
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
              console.error("图片URL解析失败:", item);
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
        message: nodeList,
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
        console.error("NapCat转发消息失败:", error);
        await e.reply("消息发送失败，请稍后再试", true);
      }
    } else {
      // 标准消息回复
      await e.reply(message, true);
    }
  }

  async subscribeArtist(e) {
    if (!e.isGroup) return;
    
    const groupId = e.group_id;
    const data = this.loadData();

    if (!data[groupId]) data[groupId] = { pushEnabled: false, artists: {} };

    if (Object.keys(data).length > 5) {
      await this.customReply(e, "已达到群订阅上限！");
      return;
    }

    if (Object.keys(data[groupId].artists).length >= 20) {
      await this.customReply(e, "该群已达到画师订阅上限！");
      return;
    }

    const msg = e.msg.trim();
    const matches = msg.match(/^#订阅画师(\d+)$/);
    const artistId = matches ? matches[1] : null;

    if (!artistId) return;

    let artistName;
    try {
      const response = await axios.get(user(artistId));
      if (response.data.error) {
        await this.customReply(e, "该画师id不存在");
        return;
      }
      artistName = response.data.body.pickup[0]?.userName || artistId;
    } catch (err) {
      await this.customReply(e, "检查画师ID时发生错误，请稍后重试");
      return;
    }

    if (data[groupId].artists[artistId]) {
      await this.customReply(e, `已经订阅了${artistId}`);
      return;
    }

    data[groupId].artists[artistId] = artistName;
    this.saveData(data);

    await this.customReply(e, `成功订阅画师${artistId}（${artistName}）`);
  }

  async unsubscribeArtist(e) {
    if (!e.isGroup) return;

    const groupId = e.group_id;
    const data = this.loadData();

    if (!data[groupId]) return;

    const msg = e.msg.trim();
    const matches = msg.match(/^#取消订阅(\d+)$/);
    const artistId = matches ? matches[1] : null;

    if (!artistId) return;

    if (!data[groupId].artists[artistId]) {
      await this.customReply(e, `还未订阅${artistId}哦`);
      return;
    }

    delete data[groupId].artists[artistId];
    this.saveData(data);

    await this.customReply(e, `成功取消订阅${artistId}`);
  }

  async listSubscribedArtists(e) {
    if (!e.isGroup) return;

    const groupId = e.group_id;
    const data = this.loadData();

    if (!data[groupId] || Object.keys(data[groupId].artists).length === 0) {
      await this.customReply(e, "当前没有订阅任何画师");
      return;
    }

    let response = "订阅列表：\n";
    for (const [artistId, artistName] of Object.entries(
      data[groupId].artists
    )) {
      response += `${artistName}  ${artistId}\n`;
    }

    await this.customReply(e, response);
  }

  async enablePush(e) {
    const groupId = e.group_id;

    let data = this.loadData();
    if (!data[groupId]) data[groupId] = { pushEnabled: false, artists: {} };

    if (!data[groupId].pushEnabled) {
      data[groupId].pushEnabled = true;
      this.saveData(data);
      await this.customReply(e, "已开启sp推送。");
    } else {
      await this.customReply(e, "已经开启了sp推送。");
    }
  }

  async disablePush(e) {
    const groupId = e.group_id;

    let data = this.loadData();
    if (!data[groupId]) return;

    if (data[groupId].pushEnabled) {
      data[groupId].pushEnabled = false;
      this.saveData(data);
      await this.customReply(e, "已关闭sp推送。");
    } else {
      await this.customReply(e, "尚未开启sp推送，无需关闭。");
    }
  }
}