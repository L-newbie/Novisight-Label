

# Novisight Label - 智能数据标注系统



<p align="center">
  <img src="https://img.shields.io/badge/版本-1.0.0-blue" alt="版本">
  <img src="https://img.shields.io/badge/Python-3.8+-green" alt="Python">
  <img src="https://img.shields.io/badge/Flask-2.3+-orange" alt="Flask">
  <img src="https://img.shields.io/badge/前端-HTML5%2FCSS3%2FJS-yellow" alt="前端">
  <img src="https://img.shields.io/badge/许可证-MIT-blue" alt="许可证">
</p>

<p align="center">
一款专业的 2D 图像数据标注系统。
</p>

## 主要功能

| 功能 | 描述 |
|------|------|
| 项目管理 | 多级分类标签体系，项目进度追踪 |
| 智能标注 | 框选实时显示尺寸，AI 预刷支持 |
| 多格式导出 | JSON、COCO、YOLO、Pascal VOC、CSV |
| 快捷操作 | 完整快捷键支持，高效标注流程 |


## 快速开始

### 环境要求

- Python 3.8+
- 现代浏览器（Chrome、Edge、Firefox）

### 安装与运行

```bash
# 1. 克隆项目
git clone https://github.com/your-repo/Novisight-Label.git
cd Novisight-Label

# 2. 安装 Python 依赖
pip install -r requirements.txt

# 3. 启动服务
python backend/app.py

# 4. 访问系统
# 浏览器打开 http://localhost:5000
```

> ⚠️ **注意**: AI 预刷功能需要手动下载 [ViT-B-32.pt](https://openaipublic.azureedge.net/clip/models/40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af/ViT-B-32.pt) 和 [yolov8x-worldv2.pt](https://github.com/ultralytics/assets/releases/download/v8.4.0/yolov8x-worldv2.pt) 模型文件，移至 `models/` 目录。

## 路线图

### 🔮 规划中功能

- **视频标注** - 支持视频流数据标注，时序标注框，关键帧标注

## 开源协议

MIT License - 详情请查看 [LICENSE](LICENSE) 文件。

---

<p align="center">Made with ❤️ by Novisight Team</p>
