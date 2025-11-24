import axios from "axios";
import fs from "fs";
import YAML from "yaml";
import { pid as pidAPI } from "../config/api.js";
import { modifyImageSharp } from "../lib/sharp-pixel.js";

export class PixivImageFetcher extends plugin {
  constructor() {
    super({
      name: "获取p站图",
      dsc: "获取p站图",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: "^#?pid(\\d+)$",
          fnc: "processPixivImages",
        },
      ],
    });
  }

  getRecallConfig() {
    const path = "./plugins/sp-plugin/config/recall.yaml";
    const fileContents = fs.readFileSync(path, "utf8");
    return YAML.parse(fileContents);
  }

  async fetchImageDetails(url) {
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async modifyImageWithPython(imageBuffer, imageName) {
    const tempImagePath = `./plugins/sp-plugin/temp/temp_${imageName}.jpg`;
    fs.writeFileSync(tempImagePath, imageBuffer);
    try {
      const modifiedImagePath = await modifyImageSharp(tempImagePath);
      const modifiedImageBuffer = fs.readFileSync(modifiedImagePath);
      fs.unlinkSync(tempImagePath);
      fs.unlinkSync(modifiedImagePath);
      return modifiedImageBuffer;
    } catch (error) {
      fs.unlinkSync(tempImagePath);
      throw error;
    }
  }

  async processPixivImages(e) {
    await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
    try {
      const matchedPid = e.msg.match(/^#?pid(\d+)$/)[1];
      const url = `${pidAPI(matchedPid)}`;
      await this.sendPixivDetails(e, url);
    } catch (error) {
      await e.reply(`发生错误：${error.toString()}`);
    }
  }

  async sendPixivDetails(e, url) {
    const details = await this.fetchImageDetails(url);
    if (!details || !details.body) {
      throw new Error("请输入正确的pid");
    }
    const body = details.body;
    const imageUrls = Object.values(body.urls).map((url) => `${url}`);
    const tagList = body.tags.tags.map((tagObj) => tagObj.tag);

    const imageDataPromises = imageUrls.map(async (imageUrl, index) => {
      const imageDataResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
      });
      return this.modifyImageWithPython(
        imageDataResponse.data,
        `image_${index}`
      );
    });

    const modifiedImageBuffers = await Promise.all(imageDataPromises);

    const msgData = [
      `id：${body.illustId}\n`,
      `画师：${body.userName}（${body.userId}）\n`,
      `是否ai：${body.aiType === 2 ? "是" : "否"}\n`,
      `标题：${body.illustTitle}\n`,
      `上传时间：${body.createDate}\n`,
      `♥：${body.likeCount}\n`,
      `😊：${body.bookmarkCount}\n`,
      `👁：${body.viewCount}\n`,
      `tag：${tagList.join(", ")}\n`,
    ].concat(modifiedImageBuffers.map((buffer) => segment.image(buffer)));

    const msgList = [
      {
        message: msgData,
        nickname: e.user_id.toString(),
        user_id: e.user_id,
      },
    ];

    const forwardMsg = e.isGroup
      ? await e.group.makeForwardMsg(msgList)
      : await e.friend.makeForwardMsg(msgList);

    const recallConfig = this.getRecallConfig();
    const sentMessage = await e.reply(forwardMsg);

    if (recallConfig.recall) {
      setTimeout(() => {
        e.isGroup
          ? e.group.recallMsg(sentMessage.message_id)
          : e.friend.recallMsg(sentMessage.message_id);
      }, recallConfig.time);
    }
  }
}
