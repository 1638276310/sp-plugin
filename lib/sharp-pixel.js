/**
 * 纯 Sharp 实现「随机彩色噪点」
 * 与原 python3 modify_image.py 行为 100% 对齐：
 *   入参：文件绝对/相对路径
 *   返回：修改后的文件绝对路径（*_modified.*）
 *   失败：抛 Error
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";

export async function modifyImageSharp(inputPath) {
  const absIn = path.isAbsolute(inputPath)
    ? inputPath
    : path.join(process.cwd(), inputPath);
  if (!fs.existsSync(absIn)) throw new Error(`文件不存在：${absIn}`);

  const { dir, name, ext } = path.parse(absIn);
  const absOut = path.join(dir, `${name}_modified${ext}`);

  const { data, info } = await sharp(absIn)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const pixelCount = Math.floor(Math.random() * 51) + 10; // 10~60

  for (let i = 0; i < pixelCount; i++) {
    const x = Math.floor(Math.random() * width);
    const y = Math.floor(Math.random() * height);
    const idx = (y * width + x) * channels;
    data[idx] = Math.floor(Math.random() * 256); // R
    data[idx + 1] = Math.floor(Math.random() * 256); // G
    data[idx + 2] = Math.floor(Math.random() * 256); // B
    data[idx + 3] = 255; // A
  }

  await sharp(data, { raw: { width, height, channels } })
    .removeAlpha()
    .toFile(absOut);

  return absOut;
}
