/**
 * 对比模式模块 - 处理原图/标注图分屏对比、叠加对比
 * 对应需求文档 2.1.1 对比模式
 */
class ComparisonMode {
    constructor() {
        this.mode = 'single'; // single, overlay, split
        this.opacity = 100;   // 标注层透明度 0-100
        this.splitPosition = 50; // 分屏模式下的分割位置（百分比）
        this.isActive = false;
        
        // 画布引用
        this.overlayCanvas = null;
        this.splitLine = null;
    }

    /**
     * 激活对比模式
     * @param {string} mode - 对比模式: overlay/split
     */
    activate(mode = 'overlay') {
        this.mode = mode;
        this.isActive = true;
        
        if (mode === 'overlay') {
            this.setupOverlayMode();
        } else if (mode === 'split') {
            this.setupSplitMode();
        }
        
        // 发送事件
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('comparison:mode', { mode, active: true });
        }
    }

    /**
     * 停用对比模式
     */
    deactivate() {
        this.isActive = false;
        this.mode = 'single';
        
        // 清理叠加层
        if (this.overlayCanvas) {
            this.overlayCanvas.remove();
            this.overlayCanvas = null;
        }
        
        // 清理分割线
        if (this.splitLine) {
            this.splitLine.remove();
            this.splitLine = null;
        }
        
        // 恢复主画布
        const mainCanvas = document.getElementById('canvas');
        if (mainCanvas) {
            mainCanvas.style.opacity = '1';
            mainCanvas.style.width = '100%';
        }
        
        // 重新绘制
        if (typeof redrawCanvas === 'function') {
            redrawCanvas();
        }
        
        // 发送事件
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('comparison:mode', { mode: 'single', active: false });
        }
    }

    /**
     * 设置叠加模式
     */
    setupOverlayMode() {
        const container = document.getElementById('canvas-container');
        if (!container) return;

        // 创建标注层叠加画布
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.id = 'overlay-canvas';
        this.overlayCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 10;
        `;
        
        // 设置透明度
        this.overlayCanvas.style.opacity = (this.opacity / 100).toString();
        
        container.appendChild(this.overlayCanvas);
        
        // 绘制标注到叠加层
        this.renderAnnotationsToOverlay();
    }

    /**
     * 设置分屏模式
     */
    setupSplitMode() {
        const container = document.getElementById('canvas-container');
        const mainCanvas = document.getElementById('canvas');
        if (!container || !mainCanvas) return;

        // 创建分割线
        this.splitLine = document.createElement('div');
        this.splitLine.id = 'split-line';
        this.splitLine.style.cssText = `
            position: absolute;
            top: 0;
            left: ${this.splitPosition}%;
            width: 2px;
            height: 100%;
            background: #00ffcc;
            cursor: ew-resize;
            z-index: 20;
        `;
        
        container.appendChild(this.splitLine);
        
        // 分割原图和标注图
        mainCanvas.style.clipPath = `inset(0 0 0 ${this.splitPosition}%)`;
        
        // 添加分割线拖拽事件
        this.setupSplitDrag();
    }

    /**
     * 设置分割线拖拽
     */
    setupSplitDrag() {
        if (!this.splitLine) return;
        
        let isDragging = false;
        
        this.splitLine.addEventListener('mousedown', (e) => {
            isDragging = true;
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const container = document.getElementById('canvas-container');
            if (!container) return;
            
            const rect = container.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let percent = (x / rect.width) * 100;
            percent = Math.max(0, Math.min(100, percent));
            
            this.splitPosition = percent;
            this.splitLine.style.left = percent + '%';
            
            const mainCanvas = document.getElementById('canvas');
            if (mainCanvas) {
                mainCanvas.style.clipPath = `inset(0 0 0 ${percent}%)`;
            }
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    /**
     * 渲染标注到叠加层
     */
    renderAnnotationsToOverlay() {
        if (!this.overlayCanvas || !AppState.annotations) return;
        
        const mainCanvas = document.getElementById('canvas');
        if (!mainCanvas) return;
        
        // 复制主画布尺寸
        this.overlayCanvas.width = mainCanvas.width;
        this.overlayCanvas.height = mainCanvas.height;
        
        const ctx = this.overlayCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        
        // 绘制所有标注
        AppState.annotations.forEach((ann, idx) => {
            const isSelected = idx === AppState.selectedAnnotation;
            this.drawAnnotation(ctx, ann, isSelected);
        });
    }

    /**
     * 绘制单个标注
     */
    drawAnnotation(ctx, annotation, isSelected) {
        if (!annotation) return;
        
        const annType = annotation.type || 'bbox';
        const color = annotation.color || '#00ffcc';
        
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2;
        
        if (annType === 'bbox') {
            const [x, y, w, h] = annotation.bbox;
            ctx.strokeRect(x, y, w, h);
            
            // 绘制标签
            if (annotation.label) {
                const label = AppState.labels?.find(l => l.id === annotation.label);
                if (label) {
                    ctx.fillStyle = color;
                    ctx.fillRect(x, y - 20, ctx.measureText(label.name).width + 10, 20);
                    ctx.fillStyle = '#000';
                    ctx.font = '12px Arial';
                    ctx.fillText(label.name, x + 5, y - 5);
                }
            }
        } else if (annType === 'polygon' && annotation.points) {
            ctx.beginPath();
            ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
            for (let i = 1; i < annotation.points.length; i++) {
                ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
            }
            ctx.closePath();
            ctx.stroke();
        } else if (annType === 'keypoint' && annotation.points) {
            annotation.points.forEach(point => {
                ctx.beginPath();
                ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
                ctx.fill();
            });
        }
    }

    /**
     * 设置叠加层透明度
     * @param {number} value - 透明度 0-100
     */
    setOpacity(value) {
        this.opacity = Math.max(0, Math.min(100, value));
        
        if (this.overlayCanvas) {
            this.overlayCanvas.style.opacity = (this.opacity / 100).toString();
        }
        
        // 更新滑块UI
        const slider = document.getElementById('opacity-slider');
        if (slider) {
            slider.value = this.opacity;
        }
        
        const valueDisplay = document.getElementById('opacity-value');
        if (valueDisplay) {
            valueDisplay.textContent = this.opacity + '%';
        }
    }

    /**
     * 刷新叠加层
     */
    refresh() {
        if (this.mode === 'overlay' && this.overlayCanvas) {
            this.renderAnnotationsToOverlay();
        }
    }

    /**
     * 获取对比模式状态
     */
    getState() {
        return {
            mode: this.mode,
            opacity: this.opacity,
            splitPosition: this.splitPosition,
            isActive: this.isActive
        };
    }

    /**
     * 创建对比模式UI面板
     */
    createPanel() {
        // 检查是否已存在
        if (document.getElementById('comparison-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'comparison-panel';
        panel.style.cssText = `
            position: fixed;
            top: 60px;
            right: 10px;
            background: #2a2a2a;
            border-radius: 8px;
            padding: 15px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            min-width: 200px;
        `;

        const title = document.createElement('h4');
        title.textContent = '对比模式';
        title.style.cssText = `
            margin: 0 0 10px 0;
            color: #fff;
            font-size: 14px;
        `;

        // 模式选择
        const modeGroup = document.createElement('div');
        modeGroup.style.cssText = `
            display: flex;
            gap: 8px;
            margin-bottom: 15px;
        `;

        const overlayBtn = document.createElement('button');
        overlayBtn.textContent = '叠加';
        overlayBtn.className = 'comparison-mode-btn';
        overlayBtn.style.cssText = `
            flex: 1;
            padding: 8px;
            background: #444;
            border: none;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;

        const splitBtn = document.createElement('button');
        splitBtn.textContent = '分屏';
        splitBtn.className = 'comparison-mode-btn';
        splitBtn.style.cssText = `
            flex: 1;
            padding: 8px;
            background: #444;
            border: none;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;

        const singleBtn = document.createElement('button');
        singleBtn.textContent = '关闭';
        singleBtn.className = 'comparison-mode-btn';
        singleBtn.style.cssText = `
            flex: 1;
            padding: 8px;
            background: #444;
            border: none;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        `;

        // 透明度控制
        const opacityGroup = document.createElement('div');
        opacityGroup.style.cssText = `
            margin-top: 10px;
        `;

        const opacityLabel = document.createElement('div');
        opacityLabel.textContent = '标注透明度:';
        opacityLabel.style.cssText = `
            color: #aaa;
            font-size: 12px;
            margin-bottom: 5px;
        `;

        const opacitySlider = document.createElement('input');
        opacitySlider.id = 'opacity-slider';
        opacitySlider.type = 'range';
        opacitySlider.min = '0';
        opacitySlider.max = '100';
        opacitySlider.value = this.opacity;
        opacitySlider.style.cssText = `
            width: 100%;
            cursor: pointer;
        `;

        const opacityValue = document.createElement('span');
        opacityValue.id = 'opacity-value';
        opacityValue.textContent = this.opacity + '%';
        opacityValue.style.cssText = `
            color: #fff;
            font-size: 12px;
            float: right;
        `;

        // 事件处理
        overlayBtn.onclick = () => {
            this.activate('overlay');
            this.updateButtonStates(overlayBtn, splitBtn, singleBtn);
        };

        splitBtn.onclick = () => {
            this.activate('split');
            this.updateButtonStates(overlayBtn, splitBtn, singleBtn);
        };

        singleBtn.onclick = () => {
            this.deactivate();
            this.updateButtonStates(overlayBtn, splitBtn, singleBtn);
        };

        opacitySlider.oninput = (e) => {
            this.setOpacity(parseInt(e.target.value));
        };

        opacityGroup.appendChild(opacityLabel);
        opacityGroup.appendChild(opacitySlider);
        opacityGroup.appendChild(opacityValue);

        modeGroup.appendChild(overlayBtn);
        modeGroup.appendChild(splitBtn);
        modeGroup.appendChild(singleBtn);

        panel.appendChild(title);
        panel.appendChild(modeGroup);
        panel.appendChild(opacityGroup);

        document.body.appendChild(panel);
    }

    /**
     * 更新按钮状态
     */
    updateButtonStates(overlayBtn, splitBtn, singleBtn) {
        [overlayBtn, splitBtn, singleBtn].forEach(btn => {
            btn.style.background = '#444';
        });

        if (this.mode === 'overlay') {
            overlayBtn.style.background = '#00cc88';
        } else if (this.mode === 'split') {
            splitBtn.style.background = '#00cc88';
        } else {
            singleBtn.style.background = '#00cc88';
        }
    }
}

/**
 * 扩展属性系统 - 为标注对象添加自定义属性
 * 对应需求文档 2.1.3 扩展属性
 */
class ExtendedAttributesManager {
    constructor() {
        this.attributeSchemas = {}; // 属性定义 schema
    }

    /**
     * 注册属性Schema
     * @param {string} labelId - 标签ID
     * @param {Array} attributes - 属性定义数组
     */
    registerAttributes(labelId, attributes) {
        this.attributeSchemas[labelId] = attributes;
    }

    /**
     * 获取属性Schema
     * @param {string} labelId - 标签ID
     * @returns {Array}
     */
    getAttributes(labelId) {
        return this.attributeSchemas[labelId] || [];
    }

    /**
     * 为标注添加扩展属性值
     * @param {Object} annotation - 标注对象
     * @param {Object} values - 属性值对象
     */
    setValues(annotation, values) {
        if (!annotation.extended_attributes) {
            annotation.extended_attributes = {};
        }
        
        Object.assign(annotation.extended_attributes, values);
    }

    /**
     * 获取标注的扩展属性值
     * @param {Object} annotation - 标注对象
     * @returns {Object}
     */
    getValues(annotation) {
        return annotation.extended_attributes || {};
    }

    /**
     * 显示属性编辑面板
     * @param {Object} annotation - 标注对象
     */
    showAttributePanel(annotation) {
        if (!annotation) return;

        // 获取标签对应的属性定义
        const labelId = annotation.label;
        const attributes = this.getAttributes(labelId);
        
        if (attributes.length === 0) {
            // 显示默认属性
            this.showDefaultAttributes(annotation);
            return;
        }

        // 创建属性编辑面板
        const overlay = document.createElement('div');
        overlay.id = 'attributes-overlay';
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
            min-width: 350px;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        const title = document.createElement('h3');
        title.textContent = '扩展属性';
        title.style.cssText = `
            margin: 0 0 15px 0;
            color: #fff;
            font-size: 16px;
        `;

        const form = document.createElement('div');
        
        // 渲染属性字段
        const currentValues = this.getValues(annotation);
        
        attributes.forEach(attr => {
            const field = this.createAttributeField(attr, currentValues[attr.name]);
            form.appendChild(field);
        });

        const buttonGroup = document.createElement('div');
        buttonGroup.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 20px;
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

        cancelBtn.onclick = () => {
            document.body.removeChild(overlay);
        };

        saveBtn.onclick = () => {
            const values = {};
            attributes.forEach(attr => {
                const input = form.querySelector(`[name="${attr.name}"]`);
                if (input) {
                    values[attr.name] = input.value;
                }
            });
            
            this.setValues(annotation, values);
            document.body.removeChild(overlay);
            
            // 重新绘制
            if (typeof redrawCanvas === 'function') {
                redrawCanvas();
            }
            
            // 记录历史
            if (AppState.history && typeof AppState.history.push === 'function') {
                AppState.history.push([...AppState.annotations]);
            }
        };

        buttonGroup.appendChild(cancelBtn);
        buttonGroup.appendChild(saveBtn);

        dialog.appendChild(title);
        dialog.appendChild(form);
        dialog.appendChild(buttonGroup);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    /**
     * 显示默认属性面板（置信度、状态等）
     */
    showDefaultAttributes(annotation) {
        const overlay = document.createElement('div');
        overlay.id = 'attributes-overlay';
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
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        const title = document.createElement('h3');
        title.textContent = '标注属性';
        title.style.cssText = `
            margin: 0 0 15px 0;
            color: #fff;
            font-size: 16px;
        `;

        const currentValues = this.getValues(annotation);

        // 置信度
        const confGroup = document.createElement('div');
        confGroup.style.cssText = 'margin-bottom: 15px;';
        
        const confLabel = document.createElement('label');
        confLabel.textContent = '置信度: ';
        confLabel.style.color = '#aaa';
        
        const confInput = document.createElement('input');
        confInput.type = 'number';
        confInput.name = 'confidence';
        confInput.min = '0';
        confInput.max = '100';
        confInput.value = (annotation.confidence || currentValues.confidence || 100) * 100;
        confInput.style.cssText = `
            width: 60px;
            padding: 4px 8px;
            background: #1a1a1a;
            border: 1px solid #444;
            color: #fff;
            border-radius: 4px;
        `;
        
        const confPercent = document.createElement('span');
        confPercent.textContent = '%';
        confPercent.style.color = '#fff';
        
        confGroup.appendChild(confLabel);
        confGroup.appendChild(confInput);
        confGroup.appendChild(confPercent);

        // 状态
        const statusGroup = document.createElement('div');
        statusGroup.style.cssText = 'margin-bottom: 15px;';
        
        const statusLabel = document.createElement('label');
        statusLabel.textContent = '状态: ';
        statusLabel.style.color = '#aaa';
        
        const statusSelect = document.createElement('select');
        statusSelect.name = 'status';
        statusSelect.style.cssText = `
            padding: 4px 8px;
            background: #1a1a1a;
            border: 1px solid #444;
            color: #fff;
            border-radius: 4px;
        `;
        
        const statuses = [
            { value: 'pending', label: '待处理' },
            { value: 'verified', label: '已验证' },
            { value: 'rejected', label: '已拒绝' },
            { value: 'needs_review', label: '需要审核' }
        ];
        
        statuses.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.value;
            opt.textContent = s.label;
            if (s.value === (annotation.status || currentValues.status || 'pending')) {
                opt.selected = true;
            }
            statusSelect.appendChild(opt);
        });
        
        statusGroup.appendChild(statusLabel);
        statusGroup.appendChild(statusSelect);

        // 备注
        const noteGroup = document.createElement('div');
        noteGroup.style.cssText = 'margin-bottom: 15px;';
        
        const noteLabel = document.createElement('label');
        noteLabel.textContent = '备注: ';
        noteLabel.style.color = '#aaa';
        noteLabel.style.display = 'block';
        noteLabel.style.marginBottom = '5px';
        
        const noteInput = document.createElement('textarea');
        noteInput.name = 'note';
        noteInput.value = currentValues.note || '';
        noteInput.placeholder = '添加备注...';
        noteInput.style.cssText = `
            width: 100%;
            height: 60px;
            padding: 8px;
            background: #1a1a1a;
            border: 1px solid #444;
            color: #fff;
            border-radius: 4px;
            resize: vertical;
            box-sizing: border-box;
        `;
        
        noteGroup.appendChild(noteLabel);
        noteGroup.appendChild(noteInput);

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

        cancelBtn.onclick = () => document.body.removeChild(overlay);
        
        saveBtn.onclick = () => {
            const values = {
                confidence: parseInt(confInput.value) / 100,
                status: statusSelect.value,
                note: noteInput.value
            };
            
            // 同时更新annotation本身的属性
            if (values.confidence !== undefined) {
                annotation.confidence = values.confidence;
            }
            if (values.status !== undefined) {
                annotation.status = values.status;
            }
            
            this.setValues(annotation, values);
            document.body.removeChild(overlay);
            
            if (typeof redrawCanvas === 'function') redrawCanvas();
            
            if (AppState.history && typeof AppState.history.push === 'function') {
                AppState.history.push([...AppState.annotations]);
            }
        };

        buttonGroup.appendChild(cancelBtn);
        buttonGroup.appendChild(saveBtn);

        dialog.appendChild(title);
        dialog.appendChild(confGroup);
        dialog.appendChild(statusGroup);
        dialog.appendChild(noteGroup);
        dialog.appendChild(buttonGroup);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
    }

    /**
     * 创建属性字段
     */
    createAttributeField(attr, currentValue) {
        const group = document.createElement('div');
        group.style.cssText = 'margin-bottom: 15px;';

        const label = document.createElement('label');
        label.textContent = attr.label || attr.name;
        label.style.cssText = `
            display: block;
            color: #aaa;
            margin-bottom: 5px;
            font-size: 13px;
        `;

        let input;

        switch (attr.type) {
            case 'select':
                input = document.createElement('select');
                input.name = attr.name;
                input.style.cssText = `
                    width: 100%;
                    padding: 6px 8px;
                    background: #1a1a1a;
                    border: 1px solid #444;
                    color: #fff;
                    border-radius: 4px;
                `;
                
                (attr.options || []).forEach(opt => {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.label;
                    if (opt.value === currentValue) option.selected = true;
                    input.appendChild(option);
                });
                break;

            case 'number':
                input = document.createElement('input');
                input.type = 'number';
                input.name = attr.name;
                input.value = currentValue || attr.default || 0;
                if (attr.min !== undefined) input.min = attr.min;
                if (attr.max !== undefined) input.max = attr.max;
                input.style.cssText = `
                    width: 100%;
                    padding: 6px 8px;
                    background: #1a1a1a;
                    border: 1px solid #444;
                    color: #fff;
                    border-radius: 4px;
                    box-sizing: border-box;
                `;
                break;

            case 'text':
            default:
                input = document.createElement('input');
                input.type = 'text';
                input.name = attr.name;
                input.value = currentValue || '';
                input.placeholder = attr.placeholder || '';
                input.style.cssText = `
                    width: 100%;
                    padding: 6px 8px;
                    background: #1a1a1a;
                    border: 1px solid #444;
                    color: #fff;
                    border-radius: 4px;
                    box-sizing: border-box;
                `;
        }

        group.appendChild(label);
        group.appendChild(input);

        return group;
    }
}

// 全局实例
window.ComparisonMode = ComparisonMode;
window.ExtendedAttributesManager = ExtendedAttributesManager;
