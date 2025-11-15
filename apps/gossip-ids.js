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
      dsc: "分批返回当前可用吃瓜文章 ID（NapCat 兼容）",
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
    const okIds = articleIds.filter((id) => !excludedIds.includes(id));

    if (!okIds.length) {
      return this.e.reply("当前没有可用的吃瓜 ID", false, { at: true });
    }

    const batch = 200; // 每批 ID 数量
    const maxBatches = 200; // 最多 10 批
    const total = Math.min(okIds.length, batch * maxBatches);
    const nodes = [];

    for (let i = 0; i < total; i += batch) {
      const chunk = okIds.slice(i, i + batch);
      const text = [`第 ${Math.floor(i / batch) + 1} 批（${chunk.length} 个）`]
        .concat(chunk)
        .join("\n");

      nodes.push({
        type: "node",
        data: {
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          content: [{ type: "text", data: { text } }],
        },
      });
    }

    const body = {
      [this.e.isGroup ? "group_id" : "user_id"]: this.e.isGroup
        ? this.e.group_id
        : this.e.user_id,
      message: nodes,
      news: [{ text: "吃瓜可用 ID 列表" }],
      prompt: "吃瓜可用 ID 列表",
      summary: `共 ${okIds.length} 个可用 ID，展示前 ${total} 个`,
      source: "吃瓜插件",
    };

    try {
      const api = this.e.isGroup
        ? "send_group_forward_msg"
        : "send_private_forward_msg";
      await this.e.bot.sendApi(api, body);
    } catch (err) {
      logger.error("[gossip-ids] 发送转发消息失败：", err);

      // 降级为普通文本消息
      const shortText = `当前共有 ${
        okIds.length
      } 个可用吃瓜 ID，因消息过长，仅展示前 ${Math.min(
        2000,
        okIds.length
      )} 个：\n${okIds.slice(0, 2000).join("\n")}`;
      await this.e.reply(shortText, false, { at: true });
    }
  }
}
