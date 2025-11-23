/**
 * 插件名称：吃瓜手动更新
 * 触发正则：^#?(更新吃瓜|刷新吃瓜)$
 * @author 寂寞沙洲冷 QV：1638276310
 */
import { refreshArticleIds } from "../lib/gossip-utils.js";

export class GossipRefresh extends plugin {
  constructor() {
    super({
      name: "吃瓜手动更新",
      dsc: "手动拉取最新规则与可用 ID",
      event: "message",
      rule: [{ reg: "^#?(更新吃瓜|刷新吃瓜)$", fnc: "doRefresh" }],
    });
  }

  async doRefresh() {
    await this.e.reply("🔄 开始手动更新吃瓜规则与 ID...", false, { at: true });
    const ok = await refreshArticleIds();
    await this.e.reply(
      ok ? "✅ 吃瓜数据已更新完成！" : "❌ 更新失败，请稍后再试",
      false,
      { at: true }
    );
  }
}
