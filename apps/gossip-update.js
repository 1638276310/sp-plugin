/**
 * 吃瓜自动更新（仅定时）
 * cron：0 0 18 * * ?   每天 18:00 执行
 * @author 寂寞沙洲冷 QV：1638276310
 */
import { refreshArticleIds } from "../lib/gossip-utils.js";

export class GossipAutoUpdate extends plugin {
  constructor() {
    super({
      name: "吃瓜自动更新",
      dsc: "每天 18:00 自动生成最新文章 ID 列表",
      event: "message",
      rule: [], // ← 手动规则全删
    });
    this.task = {
      cron: "0 0 18 * * ?",
      name: "吃瓜ID自动刷新",
      fnc: () => this.doRefresh(),
      log: true,
    };
  }

  async doRefresh() {
    logger.mark("[吃瓜定时] 开始自动刷新文章ID");
    const ok = await refreshArticleIds();
    logger.mark(`[吃瓜定时] 刷新完成，${ok ? "成功" : "失败"}`);
  }
}
