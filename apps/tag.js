import plugin from '../../../lib/plugins/plugin.js';
import axios from 'axios';
import fs from 'fs';
import YAML from 'yaml';
import { pid, tag as fetchTag } from '../config/api.js';
import { execFile } from 'child_process';
import path from 'path';

const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

export class SetuImageFetcher extends plugin {
    constructor() {
        super({
            name: 'Setu Image Fetch',
            dsc: '通过tag搜索图',
            event: 'message',
            priority: 500,
            rule: [
                {
                    reg: '^#?来(\\d+)张(.*?)图$',
                    fnc: '_processSetuImages'
                }
            ]
        });
    }

    getRecallConfig() {
        const path = './plugins/kkp-plugin/config/recall.yaml';
        const fileContents = fs.readFileSync(path, 'utf8');
        return YAML.parse(fileContents);
    }

    async fetchPixivImageDetails(pidValue) {
        const apiUrl = pid(pidValue);
        try {
            const response = await axios.get(apiUrl);
            return response.data;
        } catch (error) {
            return null;
        }
    }

    async fetchTagSearchResults(tagValue) {
        const config = this.getRecallConfig();
        const mode = config.mode || 'all';
        const order = config.order || 'popular_d';
        const apiUrl = `${fetchTag(tagValue)}&mode=${mode}&order=${order}`;
        
        const response = await axios.get(apiUrl);
        return response.data.body.data.map(item => item.id);

    }

    getRandomIds(ids, count) {
        const shuffled = ids.sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    async modifyImageWithPython(imagePath) {
        return new Promise((resolve, reject) => {
            execFile(pythonCommand, ['./plugins/kkp-plugin/modify_image.py', imagePath], (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    deleteTempFiles() {
        const tempDir = path.resolve('./plugins/kkp-plugin/temp');
        fs.readdir(tempDir, (err, files) => {
            if (err) {
                console.error('读取temp目录失败：', err);
                return;
            }

            files.forEach(file => {
                const filePath = path.join(tempDir, file);
                fs.unlink(filePath, err => {
                    if (err) {
                        console.error(`删除文件失败：${filePath}`, err);
                    }
                });
            });
        });
    }

    async _processSetuImages(e) {
        if (!e.isGroup) return;
        await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
        // this.deleteTempFiles();
        const [, numStr, tag] = e.msg.match(this.rule.find(rule => e.msg.match(rule.reg)).reg);
        const num = parseInt(numStr);

        if (num > 30) {
            await e.reply("你想冲死吗？");
            return;
        }

        const idsList = await this.fetchTagSearchResults(tag);
        if (!idsList || idsList.length === 0) {
            await e.reply("没有这种图啊，涩批！");
            return;
        }

        const selectedPids = this.getRandomIds(idsList, num);
        const detailsPromises = selectedPids.map(pid => this.fetchPixivImageDetails(pid));
        const detailsList = await Promise.all(detailsPromises);
        await e.reply("图片获取完毕，正在发送中...", false, { at: true, recallMsg: 60 });
        // await e.reply(`图片获取完毕，正在发送中...`);

        const imageMessages = await Promise.all(detailsList.map(async (details, index) => {
            if (details && details.body) {
                const imageUrls = Object.values(details.body.urls).map(url => `${url}`);
                const tagList = details.body.tags.tags.map(tagObj => tagObj.tag);
                
                const imageDatas = await Promise.all(imageUrls.map(async (imageUrl) => {
                    const imageDataResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', maxContentLength: Infinity, maxBodyLength: Infinity });
                    return imageDataResponse.data;
                }));

                const validImageDatas = imageDatas.filter(data => data !== null);

                const modifiedImagePaths = await Promise.all(validImageDatas.map(async (imageData, i) => {
                    const imagePath = `./plugins/kkp-plugin/temp/temp_image_${index}_${i}.jpg`;
                    fs.writeFileSync(imagePath, imageData);
                    const modifiedImagePath = await this.modifyImageWithPython(imagePath);
                    return modifiedImagePath;
                }));

                const msgData = [
                    `id：${details.body.illustId}\n`,
                    `画师：${details.body.userName}（${details.body.userId}）\n`,
                    `是否ai：${details.body.aiType === 2? '是' : '否'}\n`,
                    `标题：${details.body.illustTitle}\n`,
                    `上传时间：${details.body.createDate}\n`,
                    `♥：${details.body.likeCount}\n`,
                    `😊：${details.body.bookmarkCount}\n`,
                    `👁：${details.body.viewCount}\n`,
                    `tag：${tagList.join(", ")}\n`,
                    ...modifiedImagePaths.map(imagePath => segment.image(imagePath))
                ];

                return {
                    message: msgData,
                    nickname: e.user_id.toString(),
                    user_id: e.user_id,
                };
            }
            return null;
        }));

        const validImageMessages = imageMessages.filter(msg => msg !== null);

        if (validImageMessages.length > 0) {
            const forwardMsg = e.isGroup 
            ? await e.group.makeForwardMsg(validImageMessages) 
            : await e.friend.makeForwardMsg(validImageMessages);

            const recallConfig = this.getRecallConfig();

            const sentMessage = await e.reply(forwardMsg);

            if (recallConfig.recall) {
                setTimeout(() => {
                    e.isGroup 
                        ? e.group.recallMsg(sentMessage.message_id) 
                        : e.friend.recallMsg(sentMessage.message_id);
                }, recallConfig.time);
            }

            this.deleteTempFiles();
        }
    }
}
