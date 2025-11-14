/**
 * 插件名称：吃瓜可用ID
 * 触发正则：^#?可用吃瓜ID$
 * @author AI-Assistant
 */

import { readIds } from "../lib/gossip-utils.js";

export class GossipIds extends plugin {
  constructor() {
    super({
      name: "吃瓜可用ID",
      dsc: "分批返回当前可用吃瓜文章 ID（NapCat 多层转发）",
      event: "message",
      rule: [
        {
          reg: "^#?可用吃瓜ID$",
          fnc: "idsFound",
        },
      ],
    });
  }

  async idsFound() {
    const { articleIds, excludedIds } = await readIds();
    const okIds = articleIds.filter(id => !excludedIds.includes(id));

    if (!okIds.length) {
      return this.e.reply("当前没有可用的吃瓜 ID", false, { at: true });
    }

    const batch = 50;               // 每批 ID 数量
    const bigNodes = [];            // 最外层转发节点

    for (let i = 0; i < okIds.length; i += batch) {
      const chunk = okIds.slice(i, i + batch);

      /* 先把这批 ID 做成「小转发」 */
      const smallNodes = chunk.map(id => ({
        type: "node",
        data: {
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          content: [{ type: "text", data: { text: `吃瓜可用 ID：${id}` } }]
        }
      }));

      /* 再把小转发当成一条消息塞进大转发 */
      bigNodes.push({
        type: "node",
        data: {
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          content: [
            { type: "text", data: { text: `第 ${Math.floor(i / batch) + 1} 批（共 ${chunk.length} 个）` } },
            ...smallNodes
          ]
        }
      });
    }

    /* NapCat 大转发请求体 */
    const body = {
      [this.e.isGroup ? "group_id" : "user_id"]: this.e.isGroup ? this.e.group_id : this.e.user_id,
      message: bigNodes,
      news: [{ text: "吃瓜可用 ID 列表" }],
      prompt: "吃瓜可用 ID 列表",
      summary: `共 ${okIds.length} 个可用 ID`,
      source: "吃瓜插件"
    };

    try {
      const api = this.e.isGroup ? "send_group_forward_msg" : "send_private_forward_msg";
      await this.e.bot.sendApi(api, body);
    } catch (err) {
      logger.error("[gossip-ids] 发送转发消息失败：", err);
      await this.e.reply("转发消息发送失败，请查看日志", false, { at: true });
    }
  }
}