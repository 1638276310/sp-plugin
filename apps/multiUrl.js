/**
 * 多类型网址转发插件
 * @class multiUrlPlugin
 * @classdesc 获取多种类型网址链接并转发
 *
 * 功能包括：
 * 1. 获取各种类型网站的最新链接
 * 2. 支持NapCat.Onebot的特殊转发格式
 *
 * @property {string} name - 插件名称
 * @property {string} dsc - 插件描述
 * @property {string} event - 监听事件
 * @property {number} priority - 优先级
 * @property {Array} rule - 命令规则
 *
 * @example
 * // 使用示例：
 * // #写真网址
 * // #福利网址
 * // #吃瓜网址
 * // #导航网址
 * // #福利App
 */

/**
 * 插件名称：多类型网址转发
 * 插件功能：提供多种类型网址的获取和转发
 * 触发正则：支持多种类型网址命令
 * @author 寂寞沙洲冷 QV：1638276310
 */
export class multiUrlPlugin extends plugin {
  /**
   * 插件构造函数
   * @constructs multiUrlPlugin
   */
  constructor() {
    super({
      name: "多类型网址转发插件",
      dsc: "获取多种类型网站的最新链接并转发",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: "^#?写真网址$",
          fnc: "processPhotoRequest",
        },
        {
          reg: "^#?福利网址$",
          fnc: "processWelfareRequest",
        },
        {
          reg: "^#?吃瓜网址$",
          fnc: "processChiguaRequest",
        },
        {
          reg: "^#?导航网址$",
          fnc: "processNavRequest",
        },
        {
          reg: "^#?福利(App|app|APP)$",
          fnc: "processAppRequest",
        },
        {
          reg: "^#?TG电报$",
          fnc: "processTGRequest",
        },
      ],
    });
  }

  /**
   * 通用回复方法
   * @param {Object} e - 消息事件对象
   * @param {Array} urls - 网址列表
   * @param {string} type - 网址类型名称
   * @async
   */
  async sendUrls(e, urls, type) {
    await e.reply(`正在获取${type}网址，请稍等...`, false, {
      at: true,
      recallMsg: 60,
    });

    try {
      // 构建转发消息
      const updateTimeMap = {
        写真: "2026-01-05 22:30",
        福利: "2026-01-04 18:00",
        吃瓜: "2026-01-06 10:15",
        导航: "2026-01-03 09:40",
        福利App: "2026-01-02 21:00",
        TG电报: "2026-01-05 20:20",
      };

      const currentTime = updateTimeMap[type] || "未设置";

      const messages = [
        {
          message: `📱 ${type}网址集合`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        {
          message: `⏰ 更新时间: ${currentTime}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        {
          message: `📊 共找到 ${urls.length} 个${type}网站`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
        ...urls.map((url, index) => ({
          message: `${index + 1}. ${url}`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        })),
        {
          message: `⚠️ 提示：网址仅供参考，请谨慎访问\n#${type}网址 可再次获取\n请复制链接到浏览器打开，切勿直接点击`,
          nickname: e.user_id.toString(),
          user_id: e.user_id,
        },
      ];

      // 处理NapCat.Onebot的特殊转发格式
      if (e.bot?.version?.app_name === "NapCat.Onebot") {
        const nodes = messages.map((msg) => {
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

          // 构建消息节点（只处理文本）
          for (const item of msgArray) {
            if (typeof item === "string") {
              content.push({
                type: "text",
                data: { text: item },
              });
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
          messages: nodes,
          news: [{ text: "QQ/VX：1638276310" }],
          prompt: "QQ/VX：1638276310",
          summary: "QQ/VX：1638276310",
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
          logger.error("NapCat转发消息失败:", error);
          await e.reply("消息发送失败，请稍后再试", true);
        }
      } else {
        // 标准转发消息处理
        try {
          const forwardMsg = await Bot.makeForwardMsg(messages);
          await e.reply(forwardMsg);
        } catch (error) {
          logger.error("创建转发消息失败:", error);
          // 如果转发失败，尝试发送普通消息
          let plainText = `📱 ${type}网址：\n\n`;
          urls.forEach((url, index) => {
            plainText += `${index + 1}. ${url}\n`;
          });
          plainText += `\n⏰ 更新时间: ${currentTime}\n`;
          plainText += `⚠️ 提示：网址仅供参考，请谨慎访问\n请复制链接到浏览器打开，切勿直接点击`;

          await e.reply(plainText);
        }
      }
    } catch (error) {
      logger.error(`获取${type}网址失败：${error.message}`);
      await e.reply(`获取${type}网址失败，请稍后再试`, true);
    }
  }

  async processPhotoRequest(e) {
    const photoUrls = [
      "https://kkmzt.com/",
      "https://dimtown.com/",
      "https://shaonvzhi.top/",
      "https://www.chnci.cc/",
      "https://coser01.com/",
      "https://rosi73.com/",
      "https://cosaas.top/",
      "https://jrants.com/",
    ];

    await this.sendUrls(e, photoUrls, "写真");
  }

  async processWelfareRequest(e) {
    const welfareUrls = [
      "https://cn.pornhub.com/",
      "https://www.pixiv.net/",
      "https://javdb.com/",
      "https://xiaoyakankan.com/cat/1307.html",
      "https://www.sex.com/en",
      "https://jappydolls.net/",
      "https://t66y.com/",
    ];

    await this.sendUrls(e, welfareUrls, "福利");
  }

  async processChiguaRequest(e) {
    const chiguaUrls = [
      "https://www.718yule.com/",
      "https://slush.cncsbb.com/",
      "https://drive.cncsbb.com/",
      "https://fizzy.cncsbb.com/",
      "https://pc001.bkih1ca5.work/",
      "https://hl007.okbktyd8.work/",
      "https://pchl.5r1ilblr.work/",
      "https://51cg1.com/",
      "https://ball.bwljkjmd.com/",
      "https://cake.bwljkjmd.com/",
      "https://account.bwljkjmd.com/",
    ];

    await this.sendUrls(e, chiguaUrls, "吃瓜");
  }

  async processNavRequest(e) {
    const navUrls = [
      "https://www.xbookcn.net/",
      "https://tlwblhlc.8800531.xyz/",
      "https://abhwmcxb.8800532.xyz/",
      "https://vuonsksu.8800533.xyz/",
      "https://opryfboh.8800534.xyz/",
      "https://iqzmsssaabt.007home.cc/",
      "https://a09.mpmhskx.cc/c/Csn",
    ];

    await this.sendUrls(e, navUrls, "导航");
  }

  async processAppRequest(e) {
    const appUrls = [
      "https://i.meizitu.net/dl/",
      "https://db1113.7v9h2x7x.work/android/007dh_2.5.0/007dh_2.5.0_04263238.apk",
      "https://da1113.0r6ecdax.work/android/007dh_1.9.1/007dh_1.9.1_04413849.apk",
      "https://df1113.qmpqcv83.work/android/007dh_2.0.7/007dh_2.0.7_04018311.apk",
      "https://dc1113.rp5uxdhz.work/android/007dh_7.1.9/007dh_7.1.9_02926944.apk",
      "https://dl1113.y9abfunz.work/android/007dh_2.0.7/007dh_2.0.7_03870277.apk",
      "https://de1113.hwnn8qwk.work/android/007dh_3.1.6/007dh_3.1.6_03588353.apk",
      "https://dg1113.81dbyv81.work/android/007dh_3.3.3/007dh_3.3.3_03353596.apk",
      "https://df1113.qmpqcv83.work/android/007dh_2.2.6/007dh_2.2.6_03218046.apk",
      "https://dl1113.y9abfunz.work/android/007dh_5.9.6/007dh_5.9.6_14824532.apk",
      "https://de1113.hwnn8qwk.work/android/007dh_2.4.5/007dh_2.4.5_03097481.apk",
    ];

    await this.sendUrls(e, appUrls, "福利App");
  }

  async processTGRequest(e) {
    const tgUrls = [
      "https://t.me/bkyss233",
      "https://t.me/shaoluo1112",
      "https://t.me/SoShaoNv",
      "https://t.me/fulj10",
      "https://t.me/fuli366",
      "https://t.me/whdq8",
      "https://t.me/sheshewu",
      "https://t.me/dyttmg",
      "https://t.me/honglouge888",
      "https://t.me/fcyqlm",
      "https://t.me/zjy823328_VIP",
      "https://t.me/hdcos",
      "https://t.me/fsyh3",
      "https://t.me/weme_LMZ",
      "https://t.me/cosplayyds",
      "https://t.me/CSMYJ",
      "https://t.me/dianzinvyou111",
      "https://t.me/oe521",
      "https://t.me/fenbifuli",
      "https://t.me/tangxinboss",
      "https://t.me/kuaimaoav",
      "https://t.me/loliruaaa",
      "https://t.me/WweiMmi",
      "https://t.me/flj651",
      "https://t.me/FLLAVWM",
      "https://t.me/MadouSAV",
      "https://t.me/jysqa",
      "https://t.me/xiangmuyuan44",
      "https://t.me/cos288",
      "https://t.me/chiguafuli3",
      "https://t.me/giffuli",
      "https://t.me/nako6666",
      "https://t.me/viptop91",
      "https://t.me/uczhi",
      "https://t.me/Crazy_lovefabu",
      "https://t.me/xjebxila",
      "https://t.me/MMJFLZY",
      "https://t.me/miaotuya",
      "https://t.me/douyinyouwu",
      "https://t.me/coconvn",
      "https://t.me/xiaofu856",
      "https://t.me/zbzwx",
      "https://t.me/fulikun",
      "https://t.me/Yypaov",
      "https://t.me/luoli006",
      "https://t.me/welfarestation",
      "https://t.me/xsmltzx",
      "https://t.me/svipav",
      "https://t.me/mayouwa",
      "https://t.me/SelfiePR",
      "https://t.me/nide_xiaogou",
      "https://t.me/soupian20w",
    ];

    await this.sendUrls(e, tgUrls, "TG电报");
  }
}
