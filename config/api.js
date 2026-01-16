import fs from "fs";
import yaml from "yaml";

/**
 * 配置数据对象，从YAML文件解析而来
 * @type {Object}
 */
let configData;
try {
    let fileContents = fs.readFileSync("./config/config/other.yaml", "utf8");
    configData = yaml.parse(fileContents);
} catch (e) { }

/**
 * 获取框架名称（从package.json中读取）
 * @function
 * @returns {string|null} 返回package.json中的项目名称，如果读取失败则返回null
 */
const getFrameworkName = () => {
    try {
        const packageData = fs.readFileSync("./package.json", "utf8");
        const parsedData = JSON.parse(packageData);
        return parsedData.name;
    } catch (e) {
        logger.error("Error reading package.json:", e);
        return null;
    }
};

/**
 * 主QQ配置键值
 * @type {any}
 */
const keyValue = configData.masterQQ[0];

/**
 * 生成磁力链接的URL
 * @function
 * @param {string} matchedMagnet - 磁力链接字符串
 * @returns {string} 格式化后的磁力链接URL
 */
const magnetURL = (matchedMagnet) =>
    `https:${String.fromCharCode(47)}${String.fromCharCode(
        47
    )}whatslink${String.fromCharCode(46)}info${String.fromCharCode(
        47
    )}api${String.fromCharCode(47)}v1${String.fromCharCode(
        47
    )}link?url=${encodeURIComponent(matchedMagnet)}`;

/**
 * 生成Pixiv作品页面链接
 * @function
 * @param {string|number} pid - Pixiv作品ID
 * @returns {string} 作品页面URL
 */
const pid = (pid) => `https://pid.kkndp.cn/pixiv?pid=${pid}`;

/**
 * 返回订阅页面链接
 * @function
 * @returns {string} 订阅页面URL
 */
const dingyue = () => `https://user.kkndp.cn`;

/**
 * 生成Pixiv画师页面链接
 * @function
 * @param {string|number} artistId - Pixiv画师ID
 * @returns {string} 画师页面URL
 */
const user = (artistId) => `https://pid.kkndp.cn/user?user=${artistId}`;

/**
 * 生成Pixiv标签搜索页面链接
 * @function
 * @param {string} tagValue - 标签名称
 * @returns {string} 标签搜索页面URL
 */
const tag = (tagValue) =>
    `https://pid.kkndp.cn/tag?tag=${encodeURIComponent(tagValue)}`;

/**
 * 获取Pixiv每日排行榜数据API链接
 * @function
 * @returns {string} 每日排行榜API URL
 */
const dailyRanking = () => `https://pixiv.mokeyjay.com/?r=api/pixiv-json`;

/**
 * 生成Lolicon API的色图请求链接
 * @function
 * @param {string} tag - 搜索标签
 * @param {number} num - 返回数量
 * @param {number} [r18=0] - R18标记（0=非R18，1=R18，2=混合）
 * @returns {string} Lolicon API请求URL
 */
const setu = (tag, num, r18 = 0) =>
    `https://api.lolicon.app/setu/v2/?r18=${r18}&tag=${encodeURIComponent(
        tag
    )}&num=${num}`;

export {
    pid,
    user,
    setu,
    dailyRanking,
    keyValue,
    magnetURL,
    tag,
    getFrameworkName,
    dingyue,
};