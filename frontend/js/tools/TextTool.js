/**
 * 文本标注工具 - 处理图像/区域文本标注
 * 对应需求文档 2.1.2 文本标注
 */
class TextTool {
    constructor() {
        this.isActive = false;
        this.currentText = '';
        this.editingAnnotation = null;
    }

    /**
     * 激活文本标注工具
     */
    activate() {
        this.isActive = true;
        AppState.currentTool = 'text';
        
        // 更新UI
        const canvas = document.getElementById('canvas');
        if (canvas) {
            canvas.style.cursor = 'text';
        }
        
        // 显示提示
        this.showHint();
    }

    /**
     * 停用文本标注工具
     */
    deactivate() {
        this.isActive = false;
    }

    /**
     * 显示操作提示
     */
    showHint() {
        // 可以显示一个浮动提示
        console.log('文本标注工具已激活: 点击图像添加文本标注');
    }

    /**
     * 创建文本标注
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {string} text - 文本内容
     * @param {Object} options - 选项
     * @returns {Object} - 文本标注对象
     */
    createTextAnnotation(x, y, text = '', options = {}) {
        const annotation = {
            type: 'text',
            x: x,
            y: y,
            text: text,
            fontSize: options.fontSize || 16,
            fontFamily: options.fontFamily || 'Arial',
            color: options.color || '#ffffff',
            backgroundColor: options.backgroundColor || 'rgba(0, 0, 0, 0.5)',
            width: options.width || 200,
            height: options.height || 40,
            editable: true
        };

        // 添加到标注数组
        AppState.annotations.push(annotation);
        
        // 选中新标注
        AppState.selectedAnnotation = AppState.annotations.length - 1;
        
        // 记录历史
        if (AppState.history && typeof AppState.history.push === 'function') {
            AppState.history.push([...AppState.annotations]);
        }
        
        // 重新绘制
        if (typeof redrawCanvas === 'function') {
            redrawCanvas();
        }

        // 显示文本编辑弹窗
        this.showTextEditor(annotation);
        
        return annotation;
    }

    /**
     * 显示文本编辑器
     * @param {Object} annotation - 文本标注对象
     */
    showTextEditor(annotation) {
        this.editingAnnotation = annotation;
        
        // 创建编辑弹窗
        const overlay = document.createElement('div');
        overlay.id = 'text-editor-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            min-width: 300px;
            max-width: 500px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        const title = document.createElement('h3');
        title.textContent = '文本标注';
        title.style.cssText = `
            margin: 0 0 15px 0;
            color: #fff;
            font-size: 16px;
        `;

        const textarea = document.createElement('textarea');
        textarea.value = annotation.text || '';
        textarea.placeholder = '输入文本内容...';
        textarea.style.cssText = `
            width: 100%;
            height: 100px;
            background: #1a1a1a;
            border: 1px solid #444;
            border-radius: 4px;
            color: #fff;
            padding: 10px;
            font-size: 14px;
            resize: vertical;
            box-sizing: border-box;
        `;

        const optionsDiv = document.createElement('div');
        optionsDiv.style.cssText = `
            margin: 15px 0;
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        `;

        // 字体大小选项
        const fontSizeLabel = document.createElement('label');
        fontSizeLabel.textContent = '字号: ';
        fontSizeLabel.style.color = '#aaa';
        
        const fontSizeSelect = document.createElement('select');
        fontSizeSelect.style.cssText = `
            background: #1a1a1a;
            border: 1px solid #444;
            color: #fff;
            padding: 4px 8px;
            border-radius: 4px;
        `;
        [12, 14, 16, 18, 20, 24, 28, 32].forEach(size => {
            const option = document.createElement('option');
            option.value = size;
            option.textContent = size + 'px';
            if (size === (annotation.fontSize || 16)) option.selected = true;
            fontSizeSelect.appendChild(option);
        });

        // 颜色选项
        const colorLabel = document.createElement('label');
        colorLabel.textContent = ' 颜色: ';
        colorLabel.style.color = '#aaa';
        
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = annotation.color || '#ffffff';

        fontSizeLabel.appendChild(fontSizeSelect);
        optionsDiv.appendChild(fontSizeLabel);
        optionsDiv.appendChild(colorLabel);
        optionsDiv.appendChild(colorInput);

        // 按钮组
        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 15px;
        `;

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.style.cssText = `
            background: #444;
            border: none;
            color: #fff;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        `;

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        saveBtn.style.cssText = `
            background: #00cc88;
            border: none;
            color: #fff;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        `;

        buttonGroup.appendChild(cancelBtn);
        buttonGroup.appendChild(saveBtn);

        // 事件处理
        cancelBtn.onclick = () => {
            document.body.removeChild(overlay);
            // 如果文本为空，删除标注
            if (!annotation.text && AppState.annotations.includes(annotation)) {
                const idx = AppState.annotations.indexOf(annotation);
                if (idx > -1) {
                    AppState.annotations.splice(idx, 1);
                }
            }
            if (typeof redrawCanvas === 'function') redrawCanvas();
        };

        saveBtn.onclick = () => {
            annotation.text = textarea.value;
            annotation.fontSize = parseInt(fontSizeSelect.value);
            annotation.color = colorInput.value;
            
            document.body.removeChild(overlay);
            
            // 记录历史
            if (AppState.history && typeof AppState.history.push === 'function') {
                AppState.history.push([...AppState.annotations]);
            }
            
            if (typeof redrawCanvas === 'function') redrawCanvas();
            if (typeof updateAnnotationPanel === 'function') updateAnnotationPanel();
        };

        // 按Enter保存（Ctrl+Enter换行）
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveBtn.click();
            }
            if (e.key === 'Escape') {
                cancelBtn.click();
            }
        });

        dialog.appendChild(title);
        dialog.appendChild(textarea);
        dialog.appendChild(optionsDiv);
        dialog.appendChild(buttonGroup);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // 自动聚焦
        setTimeout(() => textarea.focus(), 100);
    }

    /**
     * 编辑现有文本标注
     * @param {Object} annotation - 文本标注对象
     */
    editTextAnnotation(annotation) {
        if (!annotation || annotation.type !== 'text') return;
        this.showTextEditor(annotation);
    }

    /**
     * 绘制文本标注
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {Object} annotation - 文本标注对象
     * @param {boolean} isSelected - 是否选中
     */
    draw(ctx, annotation, isSelected) {
        if (!annotation || annotation.type !== 'text') return;

        const { x, y, text, fontSize, fontFamily, color, backgroundColor, width, height } = annotation;
        
        // 绘制背景
        ctx.fillStyle = backgroundColor || 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(x, y, width || 200, height || 40);
        
        // 绘制边框
        if (isSelected) {
            ctx.strokeStyle = '#00ffcc';
            ctx.lineWidth = 2;
        } else {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 1;
        }
        ctx.strokeRect(x, y, width || 200, height || 40);
        
        // 绘制文本
        ctx.fillStyle = color || '#ffffff';
        ctx.font = `${fontSize || 16}px ${fontFamily || 'Arial'}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(text || '', x + 10, y + (height || 40) / 2);
    }

    /**
     * 检查点是否在文本标注内
     * @param {number} px - X坐标
     * @param {number} py - Y坐标
     * @param {Object} annotation - 文本标注对象
     * @returns {boolean}
     */
    isPointInside(px, py, annotation) {
        if (!annotation || annotation.type !== 'text') return false;
        
        const { x, y, width, height } = annotation;
        return px >= x && px <= x + (width || 200) &&
               py >= y && py <= y + (height || 40);
    }
}

/**
 * 分类标注模块 - 处理全局标签分类
 * 对应需求文档 2.1.2 分类标注
 */
class ClassificationManager {
    constructor() {
        this.currentClassifications = []; // 当前图像的分类标注
    }

    /**
     * 添加分类标签
     * @param {string} labelId - 标签ID
     * @param {string} categoryId - 类别ID
     */
    addClassification(labelId, categoryId) {
        const existing = this.currentClassifications.find(
            c => c.label_id === labelId && c.category_id === categoryId
        );
        
        if (!existing) {
            this.currentClassifications.push({
                label_id: labelId,
                category_id: categoryId,
                timestamp: Date.now()
            });
        }
        
        this.updateUI();
    }

    /**
     * 移除分类标签
     * @param {string} labelId - 标签ID
     * @param {string} categoryId - 类别ID
     */
    removeClassification(labelId, categoryId) {
        const idx = this.currentClassifications.findIndex(
            c => c.label_id === labelId && c.category_id === categoryId
        );
        
        if (idx > -1) {
            this.currentClassifications.splice(idx, 1);
        }
        
        this.updateUI();
    }

    /**
     * 切换分类标签（单选模式）
     * @param {string} labelId - 标签ID
     * @param {string} categoryId - 类别ID
     * @param {boolean} multiSelect - 是否多选
     */
    toggleClassification(labelId, categoryId, multiSelect = true) {
        const existing = this.currentClassifications.find(
            c => c.label_id === labelId && c.category_id === categoryId
        );
        
        if (existing) {
            this.removeClassification(labelId, categoryId);
        } else {
            if (!multiSelect) {
                // 单选模式：先移除同category的其他标签
                this.currentClassifications = this.currentClassifications.filter(
                    c => c.category_id !== categoryId
                );
            }
            this.addClassification(labelId, categoryId);
        }
    }

    /**
     * 获取当前分类
     * @returns {Array}
     */
    getClassifications() {
        return [...this.currentClassifications];
    }

    /**
     * 清空所有分类
     */
    clearClassifications() {
        this.currentClassifications = [];
        this.updateUI();
    }

    /**
     * 加载分类数据
     * @param {Array} classifications - 分类数组
     */
    loadClassifications(classifications) {
        this.currentClassifications = classifications || [];
        this.updateUI();
    }

    /**
     * 显示分类选择面板
     */
    showClassificationPanel() {
        // 检查是否已存在面板
        let panel = document.getElementById('classification-panel');
        if (panel) {
            panel.style.display = 'block';
            return;
        }

        // 创建面板
        panel = document.createElement('div');
        panel.id = 'classification-panel';
        panel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #2a2a2a;
            border-radius: 8px;
            padding: 20px;
            min-width: 300px;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            z-index: 9999;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        const title = document.createElement('h3');
        title.textContent = '图像分类';
        title.style.cssText = `
            margin: 0 0 15px 0;
            color: #fff;
            font-size: 16px;
            border-bottom: 1px solid #444;
            padding-bottom: 10px;
        `;

        // 搜索框
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = '搜索标签...';
        searchInput.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            background: #1a1a1a;
            border: 1px solid #444;
            border-radius: 4px;
            color: #fff;
            margin-bottom: 15px;
            box-sizing: border-box;
        `;

        // 标签容器
        const tagsContainer = document.createElement('div');
        tagsContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        `;

        // 渲染标签
        this.renderTags(tagsContainer);

        // 底部按钮
        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = `
            display: flex;
            justify-content: space-between;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #444;
        `;

        const clearBtn = document.createElement('button');
        clearBtn.textContent = '清空';
        clearBtn.style.cssText = `
            background: #d44;
            border: none;
            color: #fff;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        `;

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = `
            background: #444;
            border: none;
            color: #fff;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        `;

        clearBtn.onclick = () => {
            this.clearClassifications();
            this.renderTags(tagsContainer);
        };

        closeBtn.onclick = () => {
            panel.style.display = 'none';
        };

        // 搜索功能
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const tags = tagsContainer.querySelectorAll('.classification-tag');
            tags.forEach(tag => {
                const text = tag.textContent.toLowerCase();
                tag.style.display = text.includes(query) ? 'inline-block' : 'none';
            });
        });

        buttonGroup.appendChild(clearBtn);
        buttonGroup.appendChild(closeBtn);

        panel.appendChild(title);
        panel.appendChild(searchInput);
        panel.appendChild(tagsContainer);
        panel.appendChild(buttonGroup);

        // 添加到页面
        document.body.appendChild(panel);

        // 点击外部关闭
        panel.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        document.addEventListener('click', () => {
            panel.style.display = 'none';
        });
    }

    /**
     * 渲染分类标签
     * @param {HTMLElement} container - 容器
     */
    renderTags(container) {
        container.innerHTML = '';
        
        if (!AppState.categories || AppState.categories.length === 0) {
            container.innerHTML = '<p style="color: #888;">无可用标签</p>';
            return;
        }

        AppState.categories.forEach(category => {
            const categoryDiv = document.createElement('div');
            categoryDiv.style.cssText = `
                width: 100%;
                margin-bottom: 10px;
            `;

            const categoryTitle = document.createElement('div');
            categoryTitle.textContent = category.name;
            categoryTitle.style.cssText = `
                color: #aaa;
                font-size: 12px;
                margin-bottom: 5px;
                text-transform: uppercase;
            `;

            categoryDiv.appendChild(categoryTitle);

            // 获取该分类的标签
            const labels = (AppState.labels || []).filter(
                l => l.category_id === category.id
            );

            labels.forEach(label => {
                const isSelected = this.currentClassifications.some(
                    c => c.label_id === label.id && c.category_id === category.id
                );

                const tag = document.createElement('span');
                tag.className = 'classification-tag';
                tag.textContent = label.name;
                tag.style.cssText = `
                    display: inline-block;
                    padding: 6px 12px;
                    background: ${isSelected ? label.color || '#00cc88' : '#444'};
                    color: #fff;
                    border-radius: 15px;
                    font-size: 13px;
                    cursor: pointer;
                    margin: 2px;
                    transition: all 0.2s;
                    border: 2px solid ${isSelected ? (label.color || '#00cc88') : 'transparent'};
                `;

                tag.onclick = () => {
                    this.toggleClassification(label.id, category.id, true);
                    this.renderTags(container);
                };

                categoryDiv.appendChild(tag);
            });

            container.appendChild(categoryDiv);
        });
    }

    /**
     * 更新UI显示
     */
    updateUI() {
        // 更新分类显示区域
        let displayArea = document.getElementById('classification-display');
        if (!displayArea) {
            displayArea = document.createElement('div');
            displayArea.id = 'classification-display';
            displayArea.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                padding: 8px;
                min-height: 30px;
            `;
            
            const toolbar = document.querySelector('.toolbar');
            if (toolbar) {
                toolbar.appendChild(displayArea);
            }
        }

        displayArea.innerHTML = '';
        this.currentClassifications.forEach(c => {
            const label = AppState.labels?.find(l => l.id === c.label_id);
            if (label) {
                const tag = document.createElement('span');
                tag.style.cssText = `
                    padding: 2px 8px;
                    background: ${label.color || '#00cc88'};
                    color: #fff;
                    border-radius: 10px;
                    font-size: 11px;
                `;
                tag.textContent = label.name;
                displayArea.appendChild(tag);
            }
        });

        // 记录历史
        if (AppState.history && typeof AppState.history.push === 'function') {
            AppState.history.push({ type: 'classification', data: [...this.currentClassifications] });
        }
    }

    /**
     * 获取分类数据（用于导出）
     * @returns {Object}
     */
    getExportData() {
        return {
            classifications: this.currentClassifications,
            timestamp: Date.now()
        };
    }
}

// 全局实例
window.TextTool = TextTool;
window.ClassificationManager = ClassificationManager;
