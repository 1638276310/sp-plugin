/**
 * 最新合集自动更新（仅定时）
 * cron：0 0 18 * * ?   每天 18:00 执行
 * @author  寂寞沙洲冷  QV：1638276310
 */
import { refreshLatestSets } from "../lib/newset-utils.js";

export class NewSetAutoUpdate extends plugin {
  constructor() {
    super({
      name: "最新合集自动更新",
      dsc: "每天 18:00 自动生成最新合集 ID 列表",
      event: "message",
      rule: [],
    });
    this.task = {
      cron: "0 5 12 * * ?",
      name: "最新合集ID自动刷新",
      fnc: () => this.doRefresh(),
      log: true,
    };
  }

  async doRefresh() {
    logger.mark("[最新合集定时] 开始自动刷新合集ID");
    const ok = await refreshLatestSets();
    logger.mark(`[最新合集定时] 刷新完成，${ok ? "成功" : "失败"}`);
  }
}
