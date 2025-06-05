import axios from 'axios';
import fs from 'fs';
import YAML from 'yaml';
import { pid } from '../config/api.js';
import { execFile } from 'child_process';
import path from 'path';

const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

export class DailyRankImageFetcher extends plugin {
    constructor() {
        super({
            name: 'Daily Rank Image Fetch',
            dsc: '获取每日排行图片',
            event: 'message',
            priority: 500,
            rule: [
                {
                    reg: '^#?每日排行(\\d+)?$',
                    fnc: '_processDailyRank'
                }
            ]
        });
    }

    getRecallConfig() {
        const path = './plugins/sp-plugin/config/recall.yaml';
        const fileContents = fs.readFileSync(path, 'utf8');
        return YAML.parse(fileContents);
    }

    async fetchDailyRankings() {
        const apiUrl = 'https://pid.kkndp.cn/rank';
        try {
            const response = await axios.get(apiUrl);
            return response.data.rankings;
        } catch (error) {
            return [];
        }
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

    async modifyImageWithPython(imagePath) {
        return new Promise((resolve, reject) => {
            execFile(pythonCommand, ['./plugins/sp-plugin/modify_image.py', imagePath], (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    deleteTempFiles() {
        const tempDir = path.resolve('./plugins/sp-plugin/temp');
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

    async _processDailyRank(e) {
        // if (!e.isGroup) return;
        // await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
        const match = e.msg.match(this.rule.find(rule => e.msg.match(rule.reg)).reg);
        const numStr = match[1];
        const num = numStr ? Math.min(parseInt(numStr), 30) : 10;

        const rankings = await this.fetchDailyRankings();
        if (rankings.length === 0) {
            await e.reply("获取每日排行失败，请稍后再试！");
            return;
        }

        const selectedPids = rankings.slice(0, num);
        const detailsPromises = selectedPids.map(pid => this.fetchPixivImageDetails(pid));
        const detailsList = await Promise.all(detailsPromises);

        await e.reply(`图片获取完毕，正在发送中...`);

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
                    const imagePath = `./plugins/sp-plugin/temp/temp_image_${index}_${i}.jpg`;
                    fs.writeFileSync(imagePath, imageData);
                    const modifiedImagePath = await this.modifyImageWithPython(imagePath);
                    return modifiedImagePath;
                }));

                const msgData = [
                    `id：${details.body.illustId}\n`,
                    `画师：${details.body.userName}（${details.body.userId}）\n`,
                    `是否ai：${details.body.aiType === 2 ? '是' : '否'}\n`,
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
