/**
 * 插件名称：吃瓜自动更新（定时任务独立版）
 *  cron：0 0 18 * * ?   每天 18:00 执行
 *  命令：#强制更新吃瓜ID  （手动立即执行一次，仅主人）
 * @author 寂寞沙洲冷 QV：1638276310
 */

import { refreshArticleIds } from '../lib/gossip-utils.js'

export class GossipAutoUpdate extends plugin {
  constructor () {
    super({
      name: '吃瓜自动更新',
      dsc: '每天 18:00 自动生成最新文章 ID 列表',
      event: 'message',
      rule: [
        {
          reg: '^#强制更新吃瓜ID$',
          fnc: 'manualRefresh',
          permission: 'master'
        }
      ]
    })

    // 定时任务
    this.task = {
      cron: '0 0 18 * * ?',
      name: '吃瓜ID自动刷新',
      fnc: () => this.doRefresh(),
      log: true
    }
  }

  /** 定时入口 */
  async doRefresh () {
    logger.mark('[吃瓜定时] 开始自动刷新文章ID')
    const ok = await refreshArticleIds()
    logger.mark(`[吃瓜定时] 刷新完成，${ok ? '成功' : '失败'}`)
  }

  /** 手动入口 */
  async manualRefresh (e) {
    await e.reply('正在强制刷新吃瓜文章 ID...', true)
    const ok = await refreshArticleIds()
    await e.reply(ok ? '✅文章 ID 更新成功！' : '❌更新失败，请查看日志', true)
  }
}