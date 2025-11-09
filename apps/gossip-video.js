/**
 * 插件名称：吃瓜视频（按 ID 获取）
 * 触发正则：^#?吃瓜\s*(\d+)$
 * @author AI-Assistant
 */

import plugin from "../../lib/plugins/plugin.js";
import { fetchVideoById } from "../lib/gossip-utils.js";

export class GossipVideo extends plugin {
  constructor() {
    super({
      name: "吃瓜视频",
      dsc: "根据数字 ID 获取吃瓜文章/视频",
      event: "message",
      rule: [
        {
          reg: "^#?吃瓜\\s*(\\d+)$",
          fnc: "video",
        },
      ],
    });
  }

  /**
   * 主入口：解析并转发单篇文章
   */
  async video() {
    const id = this.e.msg.match(/^#?吃瓜\s*(\d+)$/)[1];
    await this.e.reply("正在解析视频...", false, { at: true });

    const data = await fetchVideoById(id);
    if (!data) return this.e.reply("该 ID 不存在或已失效", false, { at: true });

    /* 拼装转发节点 */
    const nodes = [
      {
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: [
          `✅视频信息获取成功！\n🆔文章ID: ${data.id}\n📝标题: ${data.title}\n📅发布时间: ${data.publishTime}\n📛请勿用于非法用途`,
        ],
      },
    ];
    if (data.videoUrls.length) {
      nodes.push({
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: ["🔗视频地址列表:"],
      });
      data.videoUrls.forEach((u) =>
        nodes.push({
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          message: [u],
        })
      );
    }
    if (data.articleContent.length) {
      nodes.push({
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        message: ["📖文章内容:"],
      });
      data.articleContent.forEach((t) =>
        nodes.push({
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          message: [t],
        })
      );
    }

    /* ===== NapCat 原样开始（变量名已修正） ===== */
    if (this.e.bot?.version?.app_name === "NapCat.Onebot") {
      const ncNodes = [];
      for (const node of nodes) {
        const messages = Array.isArray(node.message)
          ? node.message
          : [node.message];
        const content = [];
        for (const item of messages) {
          if (typeof item === "string") {
            content.push({ type: "text", data: { text: item } });
          } else if (item?.type === "image") {
            content.push({ type: "image", data: { file: item.data.file } });
          } else if (item?.type === "video") {
            content.push({ type: "video", data: { file: item.data.file } });
          } else {
            content.push({ type: "text", data: { text: "不支持的消息类型" } });
          }
        }
        ncNodes.push({
          type: "node",
          data: {
            nickname: this.e.sender.nickname,
            user_id: this.e.user_id,
            content: content,
          },
        });
      }
      const requestBody = {
        group_id: this.e.group_id,
        user_id: this.e.user_id,
        message: ncNodes,
        news: [{ text: "QQ/VX：1638276310" }],
        prompt: "QQ/VX：1638276310",
        summary: `QQ/VX：1638276310`,
        source: "QQ/VX：1638276310",
      };
      if (this.e.isGroup) {
        await this.e.bot.sendApi("send_group_forward_msg", requestBody);
      } else {
        await this.e.bot.sendApi("send_private_forward_msg", requestBody);
      }
      return;
    }
    /* ===== NapCat 原样结束 ===== */

    await this.e.reply(await Bot.makeForwardMsg(nodes));
  }
}
