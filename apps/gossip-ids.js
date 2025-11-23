// /**
//  * 插件名称：吃瓜可用ID
//  * 触发正则：^#?可用吃瓜ID$
//  * @author 寂寞沙洲冷 QV：1638276310
//  */
// import { readIds } from "../lib/gossip-utils.js";

// export class GossipIds extends plugin {
//   constructor() {
//     super({
//       name: "吃瓜可用ID",
//       dsc: "返回当前全部可用吃瓜文章 ID（NapCat 兼容）",
//       event: "message",
//       rule: [{ reg: "^#?可用吃瓜ID$", fnc: "idsFound" }],
//     });
//   }

//   async idsFound() {
//     const ids = await readIds();
//     if (!ids.length)
//       return this.e.reply("当前没有可用的吃瓜 ID", false, { at: true });

//     /* ---------- 构造第一层转发节点 ---------- */
//     const nodes = [
//       {
//         type: "node",
//         data: {
//           user_id: this.e.user_id,
//           nickname: this.e.sender.nickname,
//           content: [
//             {
//               type: "text",
//               data: {
//                 text: `共 ${ids.length} 个可用吃瓜 ID：\n${ids.join("\n")}`,
//               },
//             },
//           ],
//         },
//       },
//     ];

//     /* ---------- 构造官方要求的完整 body ---------- */
//     const body = {
//       [this.e.isGroup ? "group_id" : "user_id"]: this.e.isGroup
//         ? this.e.group_id
//         : this.e.user_id,
//       messages: nodes, // 关键字段，必须是 messages
//       news: [{ text: "吃瓜可用 ID 列表" }],
//       prompt: "吃瓜可用 ID 列表",
//       summary: `共 ${ids.length} 个可用 ID`,
//       source: "吃瓜插件",
//     };

//     /* ---------- 发送 ---------- */
//     try {
//       await this.e.bot.sendApi(
//         this.e.isGroup ? "send_group_forward_msg" : "send_private_forward_msg",
//         body
//       );
//     } catch (err) {
//       logger.error("[gossip-ids] 发送转发消息失败：", err);
//       /* 降级：直接发文字 */
//       await this.e.reply(
//         `当前共有 ${ids.length} 个可用吃瓜 ID：\n${ids.join("\n")}`,
//         false,
//         { at: true }
//       );
//     }
//   }
// }

// 上面的是一层 每行一个ID🆔

/**
 * 插件名称：吃瓜可用ID
 * 触发正则：^#?可用吃瓜ID$
 * @author 寂寞沙洲冷 QV：1638276310
 */
import { readIds } from "../lib/gossip-utils.js";

export class GossipIds extends plugin {
  constructor() {
    super({
      name: "吃瓜可用ID",
      dsc: "横向分批返回全部可用吃瓜文章 ID（NapCat 完全体）",
      event: "message",
      rule: [{ reg: "^#?可用吃瓜ID$", fnc: "idsFound" }],
    });
  }

  async idsFound() {
    const ids = await readIds();
    if (!ids.length)
      return this.e.reply("当前没有可用的吃瓜 ID", false, { at: true });

    const PAGE = 200;
    const pages = Math.ceil(ids.length / PAGE);

    /* ---------- 第二层节点：每 200 个 ID 横向一排 ---------- */
    const secondLayerNodes = [];
    for (let i = 0; i < pages; i++) {
      const chunk = ids.slice(i * PAGE, (i + 1) * PAGE);
      secondLayerNodes.push({
        type: "node",
        data: {
          user_id: this.e.user_id,
          nickname: this.e.sender.nickname,
          content: [
            {
              type: "text",
              data: {
                text: `第 ${i + 1} 组（${chunk.length} 个）\n${chunk.join(
                  " "
                )}`,
              },
            },
          ],
        },
      });
    }

    /* ---------- 第一层节点：当封面 ---------- */
    const firstLayerNode = {
      type: "node",
      data: {
        user_id: this.e.user_id,
        nickname: this.e.sender.nickname,
        content: [
          {
            type: "text",
            data: {
              text: `吃瓜可用 ID 列表\n共 ${ids.length} 个，分 ${pages} 组展示`,
            },
          },
        ],
      },
    };

    /* ---------- 合并成官方要求的 messages 数组 ---------- */
    const messages = [firstLayerNode, ...secondLayerNodes];

    /* ---------- 最外层 body：字段一个不少 ---------- */
    const body = {
      [this.e.isGroup ? "group_id" : "user_id"]: this.e.isGroup
        ? this.e.group_id
        : this.e.user_id,
      messages, // 官方字段：messages
      news: [{ text: "吃瓜可用 ID 列表" }],
      prompt: "吃瓜可用 ID 列表",
      summary: `共 ${ids.length} 个可用 ID，分 ${pages} 组`,
      source: "吃瓜插件",
    };

    try {
      await this.e.bot.sendApi(
        this.e.isGroup ? "send_group_forward_msg" : "send_private_forward_msg",
        body
      );
    } catch (err) {
      logger.error("[gossip-ids] 发送转发消息失败：", err);
      await this.e.reply(
        `当前共有 ${ids.length} 个可用吃瓜 ID，因消息过长，仅展示前 ${Math.min(
          2000,
          ids.length
        )} 个：\n${ids.slice(0, 2000).join(" ")}`,
        false,
        { at: true }
      );
    }
  }
}
