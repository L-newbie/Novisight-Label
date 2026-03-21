# 🚀 Novisight Label - 智能数据标注系统

<p align="center">
  <img src="https://img.shields.io/badge/版本-1.0.0-blue" alt="版本">
  <img src="https://img.shields.io/badge/Python-3.8+-green" alt="Python">
  <img src="https://img.shields.io/badge/Flask-2.3+-orange" alt="Flask">
  <img src="https://img.shields.io/badge/前端-HTML5%2FCSS3%2FJS-yellow" alt="前端">
</p>

⚡ 一款2D图像和视频流数据标注系统

## 📋 项目概述

Novisight Label 是一款专业的智能数据标注平台，支持多种数据格式导入、丰富的标注工具、多级标签体系、以及多种导出格式。系统采用赛博朋克风格的霓虹配色，配合动态光效和流畅动画，为用户提供沉浸式的标注体验。

### 适用场景

- 机器学习训练数据准备
- 计算机视觉项目数据标注
- 目标检测、图像分割数据集构建

## ✨ 核心功能

| 功能 | 描述 |
|------|------|
| 📊 项目管理 | 创建、编辑、删除标注项目，多级分类标签体系，项目进度追踪 |
| 🖼️ 图像标注 | 支持多种图片格式，缩放平移，矩形框、多边形、画笔工具，属性标注 |
| 🎯 智能标注 | 框选实时显示尺寸，选中拖动缩放删除，AI预刷支持 |
| 📤 多格式导出 | JSON、COCO、YOLO、Pascal VOC、CSV 等常用格式 |
| ⌨️ 快捷操作 | 完整快捷键支持，高效标注流程 |

## 🛠️ 技术栈

### 后端

| 技术 | 说明 |
|------|------|
| Python 3.8+ | 核心编程语言 |
| Flask 2.3+ | Web 框架 |
| SQLite3 | 轻量级数据库 |
| OpenCV | 图像处理（AI预刷） |

### 前端

| 技术 | 说明 |
|------|------|
| HTML5 | 页面结构 |
| CSS3 | 样式与动画（Flexbox、Grid） |
| JavaScript ES6+ | 交互逻辑 |
| Canvas API | 画布渲染与标注 |

## 📁 项目结构

```
Novisight-Label/
├── backend/                     # 后端服务
│   ├── app.py                  # Flask 主应用
│   ├── infer_service.py        # AI 推理服务
│   └── migrate_categories.py   # 分类迁移脚本
├── frontend/                    # 前端界面
│   ├── index.html              # 主页面
│   ├── css/                    # 样式文件
│   │   ├── style.css           # 主样式
│   │   └── magic.css           # 魔幻特效
│   └── js/                     # JavaScript
│       ├── app.js              # 主应用逻辑
│       ├── canvas.js           # 画布标注
│       ├── inference.js        # AI 推理
│       ├── export.js           # 导出功能
│       ├── core/               # 核心模块
│       │   ├── EventBus.js     # 事件总线
│       │   └── HistoryManager.js # 历史管理
│       ├── tools/              # 标注工具
│       │   ├── KeypointTool.js # 关键点工具
│       │   ├── TextTool.js     # 文本工具
│       │   ├── ViewControl.js  # 视图控制
│       │   └── ComparisonMode.js # 对比模式
│       ├── rendering/          # 渲染模块
│       │   └── LayeredCanvas.js # 分层画布
│       └── ui/                 # UI 组件
│           ├── ShortcutManager.js # 快捷键管理
│           └── VisibilityManager.js # 可见性管理
├── data/                        # 数据目录
│   ├── uploads/                # 上传文件
│   ├── exports/               # 导出文件
│   └── database/              # 数据库文件
├── requirements.txt            # Python 依赖
└── README.md                   # 项目说明
```

## 🚀 快速开始

### 1. 环境要求

- Python 3.8+
- 现代浏览器（Chrome、Edge、Firefox）

### 2. 克隆项目

```bash
git clone https://github.com/your-repo/Novisight-Label.git
cd Novisight-Label
```

### 3. 安装依赖

```bash
# Windows
del package-lock.json

# Linux/Mac
rm -rf package-lock.json

# 清理缓存并安装
npm cache clean --force
npm install

# 安装 Python 依赖
pip install -r requirements.txt

#模型预刷: 手动下载ViT-B-32.pt和yolov8x-worldv2.pt移动到models目录下
```

### 4. 启动服务

```bash
# 运行后端服务
python backend/app.py
```

### 5. 访问系统

打开浏览器访问：`http://localhost:5000`

## 📖 使用指南

### 创建项目

1. 点击"创建新项目"按钮
2. 填写项目名称、描述、分类
3. 选择数据类型（图像/视频）
4. 点击"创建项目"

### 上传数据

1. 在工作区点击"上传"按钮
2. 选择要上传的图片或视频文件
3. 支持拖拽上传
4. 等待上传完成

### 创建标签

1. 在右侧面板点击"添加标签"
2. 输入标签名称
3. 选择标签颜色
4. 设置标签属性（可选）
5. 点击"添加标签"

### 进行标注

1. **选择工具**：使用工具栏选择标注类型（矩形框/多边形/画笔/关键点）
2. **绘制标注**：在画布上绘制标注区域
3. **选择标签**：在右侧面板选择对应的标签
4. **填写属性**：可选择填写备注、遮挡程度、截断程度、运动状态等属性
5. **自动保存**：属性修改后会自动保存，无需手动点击保存

> ⚠️ 注意：系统已实现属性自动保存功能，修改属性后无需手动保存

### 导出数据

1. 切换到"导出"视图
2. 选择需要的导出格式（JSON/COCO/YOLO/VOC/CSV）
3. 系统将自动生成并下载导出文件

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| V | 选择工具 |
| R | 矩形框标注 |
| P | 多边形标注 |
| B | 画笔工具 |
| K | 关键点工具 |
| T | 文本工具 |
| Delete | 删除选中标注 |
| Ctrl+C | 复制标注 |
| Ctrl+V | 粘贴标注 |
| Ctrl+Z | 撤销 |
| Ctrl+Y | 重做 |
| Ctrl+S | 保存标注 |
| +/= | 放大 |
| - | 缩小 |
| F | 适应窗口 |
| H | 切换可见性面板 |
| ? | 显示快捷键帮助 |
| Escape | 取消当前操作 |

## 🎨 界面预览

系统采用赛博朋克风格的霓虹配色，配合动态光效和流畅动画，带来沉浸式的标注体验：

- **科技感**：深色背景配合霓虹青、紫、橙色调
- **魔幻效果**：粒子背景、发光边框、扫描线动画
- **高互动**：实时坐标显示、拖拽编辑、快捷键支持

## 📝 注意事项

1. 上传文件大小限制：500MB
2. 支持的图片格式：PNG、JPG、JPEG、GIF、BMP、WebP
3. 支持的视频格式：MP4、AVI、MOV、MKV、WebM、FLV


### 提交代码

```bash
# 1. 查看当前状态
git status

# 2. 添加修改的文件
git add .

# 3. 提交更改
git commit -m "提交说明"

# 4. 推送到远程仓库
git push origin main
```

## 📜 开源协议

本项目采用 MIT 开源协议，遵循以下原则：

| 权限 | 说明 |
|------|------|
| ✅ 免费使用 | 任何人都可以免费使用本软件，包括个人和商业用途 |
| ✅ 自由修改 | 任何人都可以修改源代码以适应自己的需求 |
| ✅ 自由分发 | 任何人都可以分发原始或修改后的代码 |
| ✅ 保留版权 | 分发时必须包含原作者的版权声明和许可声明 |
| ❌ 禁止收费 | 严禁以任何形式对本软件进行收费 |

## 📄 许可证

MIT License

---

<p align="center">Made with ❤️ by Novisight Team</p>

<p align="center">🚀 Novisight Label - 让数据标注更简单、更智能</p>
