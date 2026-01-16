import fs from "fs";
import YAML from "yaml";

/**
 * 撤回配置控制器插件
 * @class RecallConfigController
 * @classdesc 控制撤回功能的状态和时间
 * @property {string} name - 插件名称
 * @property {string} dsc - 插件描述
 * @property {string} event - 监听事件
 * @property {number} priority - 优先级
 * @property {Array} rule - 命令规则
 */
export class RecallConfigController extends plugin {
    /**
     * 插件构造函数
     * @constructs RecallConfigController
     */
    constructor() {
        super({
            name: "Recall Config Controller",
            dsc: "控制撤回功能的状态和时间",
            event: "message",
            priority: "-Infinity",
            rule: [
                {
                    reg: "^#?(开启|关闭)(sp|涩批|色胚|色批|色皮)撤回$",
                    fnc: "toggleRecall",
                },
                {
                    reg: "^#?设置(sp|涩批|色皮|色批)撤回(\\d+)$",
                    fnc: "setRecallTime",
                },
                {
                    reg: "^#?设置R18模式(0|1|2)$",
                    fnc: "setR18Mode",
                },
                {
                    reg: "^#?设置图片偏好(0|1|2)$",
                    fnc: "setImagePreference",
                },
            ],
        });
    }

    /**
     * 获取配置文件路径
     * @returns {string} 配置文件路径
     */
    getConfigPath() {
        return "./plugins/sp-plugin/config/recall.yaml";
    }

    /**
     * 获取撤回配置
     * @returns {Object} 撤回配置对象
     */
    getRecallConfig() {
        const path = this.getConfigPath();
        if (!fs.existsSync(path)) {
            return { recall: true, time: 40000, mode: "all", order: "popular_d" };
        }
        const fileContents = fs.readFileSync(path, "utf8");
        return (
            YAML.parse(fileContents) || {
                recall: true,
                time: 40000,
                mode: "all",
                order: "popular_d",
            }
        );
    }

    /**
     * 写入撤回配置
     * @param {Object} config - 配置对象
     */
    writeRecallConfig(config) {
        const path = this.getConfigPath();
        fs.writeFileSync(path, YAML.stringify(config));
    }

    /**
     * 切换撤回功能状态
     * @async
     * @param {Object} e - 消息事件对象
     * @returns {Promise<boolean|void>}
     */
    async toggleRecall(e) {
        // 以下为主人权限判断，不需要仅限主人可用的可以注释掉
        if (!e.isMaster) {
            e.reply("仅主人可用", true);
            return true;
        }

        const [, action] = e.msg.match(
            this.rule.find((rule) => e.msg.match(rule.reg)).reg
        );
        const config = this.getRecallConfig();

        if (action === "开启") {
            config.recall = true;
            await e.reply("已开启撤回功能");
        } else {
            config.recall = false;
            await e.reply("已关闭撤回功能");
        }

        this.writeRecallConfig(config);
    }

    /**
     * 设置撤回时间
     * @async
     * @param {Object} e - 消息事件对象
     * @returns {Promise<boolean|void>}
     */
    async setRecallTime(e) {
        // 以下为主人权限判断，不需要仅限主人可用的可以注释掉
        if (!e.isMaster) {
            e.reply("仅主人可用", true);
            return true;
        }

        const match = e.msg.match(
            this.rule.find((rule) => e.msg.match(rule.reg)).reg
        );

        // match[1] 是 "sp|涩批|色皮|色批"，match[2] 是数字
        const timeStr = match[2];
        const time = parseInt(timeStr) * 1000;

        if (time < 10000 || time > 120000) {
            await e.reply("建议设置为10-120秒哦");
            return;
        }

        const config = this.getRecallConfig();
        config.time = time;
        this.writeRecallConfig(config);

        await e.reply(`已设置撤回时间为${timeStr}秒`);
    }

    /**
     * 设置R18模式
     * @async
     * @param {Object} e - 消息事件对象
     * @returns {Promise<boolean|void>}
     */
    async setR18Mode(e) {
        // 以下为主人权限判断，不需要仅限主人可用的可以注释掉
        if (!e.isMaster) {
            e.reply("仅主人可用", true);
            return true;
        }

        const [, modeStr] = e.msg.match(
            this.rule.find((rule) => e.msg.match(rule.reg)).reg
        );
        const modeMap = { 0: "all", 1: "safe", 2: "r18" };
        const config = this.getRecallConfig();
        config.mode = modeMap[modeStr];
        this.writeRecallConfig(config);

        await e.reply(
            `已设置R18模式为${config.mode},\n 0:全部 \n 1:非R18 \n 2:R18`
        );
    }

    /**
     * 设置图片偏好
     * @async
     * @param {Object} e - 消息事件对象
     * @returns {Promise<boolean|void>}
     */
    async setImagePreference(e) {
        // 以下为主人权限判断，不需要仅限主人可用的可以注释掉
        if (!e.isMaster) {
            e.reply("仅主人可用", true);
            return true;
        }

        const [, preferenceStr] = e.msg.match(
            this.rule.find((rule) => e.msg.match(rule.reg)).reg
        );
        const orderMap = {
            0: "popular_d",
            1: "popular_male_d",
            2: "popular_female_d",
        };
        const config = this.getRecallConfig();
        config.order = orderMap[preferenceStr];
        this.writeRecallConfig(config);

        await e.reply(
            `已设置图片偏好为${config.order},\n 0:无偏好 \n 1:男性偏好 \n 2:女性偏好`
        );
    }
}