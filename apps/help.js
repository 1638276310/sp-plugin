/**
 * 插件名称：涩批帮助
 * 插件功能：提供涩批插件的使用帮助
 * 触发正则：#?(sp|涩批|色批|色胚|涩胚)(文字帮助|图片帮助)
 * @author 寂寞沙洲冷 QV：1638276310
 */
export class sphelp extends plugin {
  constructor() {
    super({
      name: "涩批帮助",
      dsc: "获取涩批插件帮助",
      event: "message",
      priority: 50,
      rule: [
        {
          reg: "^#?(sp|涩批|色批|色胚|涩胚)文字帮助$",
          fnc: "sp_help_text",
        },
        {
          reg: "^#?(sp|涩批|色批|色胚|涩胚)图片帮助$",
          fnc: "sp_help_img",
        },
      ],
    });
  }

  async sp_help_text(e) {
    let helpText = "【涩批(sp)插件文字帮助】\n\n";

    helpText += "【暴走黑料】\n";
    helpText += "· #黑料+ID - 获取暴走黑料文章\n";
    helpText += "· #随机黑料 - 随机获取暴走黑料文章\n\n";

    helpText += "【P站图片获取】\n";
    helpText += "· #pid+数字 - 获取P站单张作品\n";
    helpText += "· #随机X张Y作品 - 随机获取画师作品(X≤20)\n";
    helpText += "· #来X张XX图 - 按标签搜索图片(X≤15)\n\n";

    helpText += "【磁力链接】\n";
    helpText += "· #磁力猫+关键词 - 磁力猫搜索\n";
    helpText += "· #验车+磁力链接 - 查询磁力链接详情\n\n";

    helpText += "【Cosplay图】\n";
    helpText += "· #2图 - 获取二次元图包\n";
    helpText += "· #3图 - 获取三次元图包\n\n";

    helpText += "【订阅与推送】\n";
    helpText += "· #订阅画师+ID - 订阅画师更新\n";
    helpText += "· #取消订阅+ID - 取消订阅\n";
    helpText += "· #订阅列表 - 查看已订阅画师\n";
    helpText += "· #开启sp推送 / #关闭sp推送 - 控制推送\n\n";

    helpText += "【设置选项】\n";
    helpText += "· #开启sp撤回 / #关闭sp撤回 - 控制消息撤回\n";
    helpText += "· #设置sp撤回X - 设置撤回时间(10-120秒)\n";
    helpText += "· #设置R18模式X - 0:全部 1:非R18 2:R18\n";
    helpText += "· #设置图片偏好X - 0:无偏好 1:男性 2:女性\n\n";

    // helpText += "【吃瓜套件】\n";
    // helpText += "· #吃瓜+ID - 获取吃瓜视频/文章\n";
    // helpText += "· #吃瓜搜索+关键词 - 搜索吃瓜内容\n";
    // helpText += "· #随机吃瓜 - 随机获取吃瓜\n";
    // helpText += "· #吃瓜X个往期 - 获取往期内容\n";
    // helpText += "· #更新吃瓜 - 手动刷新吃瓜数据\n\n";

    helpText += "【插件管理】\n";
    helpText += "· #sp更新 / #sp强制更新 - 更新插件\n\n";
    helpText += "作者：寂寞沙洲冷 QV：1638276310";

    await e.reply(helpText);
  }

  async sp_help_img() {
    const imagePath = "./plugins/sp-plugin/config/help.jpg";
    let msg = [segment.image(`file://${imagePath}`)];
    this.e.reply(msg);
    return true;
  }
}
