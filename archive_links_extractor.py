import requests
from bs4 import BeautifulSoup
import json


def extract_archive_ids(url):
    try:
        response = requests.get(url)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        archives_content = soup.find('div', id='archives-content')
        if archives_content:
            links = archives_content.find_all('a', href=True)
            archive_ids = []
            base_url = 'https://trick.liuliangqifei.xyz/archives/'
            for link in links:
                href = link['href']
                if href.startswith(base_url):
                    archive_id = href.replace(base_url, '')
                    archive_ids.append(archive_id)
            return archive_ids
        return []
    except requests.RequestException as e:
        print(f"请求出错: {e}")
        return []
    except Exception as e:
        print(f"发生未知错误: {e}")
        return []


def save_to_json(data, filename):
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"数据已保存到 {filename}")
    except Exception as e:
        print(f"保存文件时出错: {e}")


if __name__ == "__main__":
    url = 'https://trick.liuliangqifei.xyz/archives.html'
    archive_ids = extract_archive_ids(url)
    save_to_json(archive_ids, 'archive_ids.json')
    