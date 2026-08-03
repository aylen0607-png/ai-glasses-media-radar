# Lens Radar — AI 眼镜宣传素材雷达

收集已配置品牌的公开官方视频、产品主视觉（KV）与发布页。首页按品牌筛选，每天北京时间 08:30 自动刷新一次；点击“立即扫描”可触发即时更新。

## 启动

```bash
node server.js
```

浏览器打开 `http://localhost:4173`。

首次运行会立即生成素材库；之后在服务进程持续运行时，每日自动刷新。

## 可靠的每日同步（推荐部署方式）

若部署在云服务器或 NAS，请用 cron 在每天 08:30 执行一次：

```cron
30 8 * * * cd /path/to/ai眼镜 && /usr/bin/node server.js --refresh
```

将时区设为 `Asia/Shanghai`。生产环境可以另用 PM2、systemd 或 Docker 保持 `node server.js` 常驻，以提供网页访问。

## GitHub Pages

仓库已包含两条 GitHub Actions：`Deploy GitHub Pages` 在每次推送后生成并发布静态站点；`Refresh AI glasses media` 每天 08:30（北京时间）刷新 `data/videos.json`、自动提交，并触发重新发布。GitHub Pages 上不能使用“立即扫描”，但会显示已同步的数据。

## 管理追踪来源

编辑 [data/sources.json](data/sources.json)：

- `kind: "page"`：扫描官方产品页中的 MP4/WebM 或 YouTube 嵌入视频。
- `kind: "youtube-rss"`：填写官方频道 RSS，例如 `https://www.youtube.com/feeds/videos.xml?channel_id=频道ID`，可自动收集新上传视频。
- `featured`：用于收录不含可抓取视频的官方 KV、发布页或指定宣传片。

素材仅保留公开原始链接，不下载、不转载视频文件。不同地区的产品页面、服务与视频可见性可能不同。
