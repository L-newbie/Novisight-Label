/**
 * 视图控制模块 - 处理图像旋转、翻转、微调等功能
 * 对应需求文档 2.1.1 视图控制功能
 */
class ViewControl {
    constructor() {
        this.rotation = 0; // 0, 90, 180, 270
        this.flipH = false; // 水平翻转
        this.flipV = false; // 垂直翻转
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        
        // 微调步长（像素）
        this.fineTuneStep = 1;
        // Shift按下时的微调步长
        this.fineTuneStepShift = 10;
    }

    /**
     * 旋转图像
     * @param {number} degrees - 旋转角度（90/180/270/-90）
     */
    rotate(degrees) {
        this.rotation = (this.rotation + degrees + 360) % 360;
        this.applyTransform();
        this.updateUI();
    }

    /**
     * 水平翻转
     */
    flipHorizontal() {
        this.flipH = !this.flipH;
        this.applyTransform();
        this.updateUI();
    }

    /**
     * 垂直翻转
     */
    flipVertical() {
        this.flipV = !this.flipV;
        this.applyTransform();
        this.updateUI();
    }

    /**
     * 重置视图
     */
    reset() {
        this.rotation = 0;
        this.flipH = false;
        this.flipV = false;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.applyTransform();
        this.updateUI();
    }

    /**
     * 应用变换到画布
     */
    applyTransform() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        const transform = [];
        
        // 获取画布中心
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        
        // 先移动到中心
        transform.push(`translate(${centerX}px, ${centerY}px)`);
        
        // 应用旋转
        if (this.rotation !== 0) {
            transform.push(`rotate(${this.rotation}deg)`);
        }
        
        // 应用翻转
        if (this.flipH) transform.push('scaleX(-1)');
        if (this.flipV) transform.push('scaleY(-1)');
        
        // 应用缩放
        if (this.zoom !== 1) {
            transform.push(`scale(${this.zoom})`);
        }
        
        // 移回原点
        transform.push(`translate(-${centerX}px, -${centerY}px)`);
        
        // 应用平移
        if (this.panX !== 0 || this.panY !== 0) {
            transform.push(`translate(${this.panX}px, ${this.panY}px)`);
        }
        
        canvas.style.transform = transform.join(' ');
        
        // 触发重新绘制
        if (typeof redrawCanvas === 'function') {
            redrawCanvas();
        }
        
        // 发送事件通知
        if (typeof EventBus !== 'undefined') {
            EventBus.emit('view:transform', {
                rotation: this.rotation,
                flipH: this.flipH,
                flipV: this.flipV,
                zoom: this.zoom
            });
        }
    }

    /**
     * 缩放视图
     * @param {number} delta - 缩放增量
     */
    zoomIn(delta = 0.1) {
        this.zoom = Math.max(0.1, Math.min(10, this.zoom + delta));
        this.applyTransform();
    }

    /**
     * 缩小视图
     * @param {number} delta - 缩放增量
     */
    zoomOut(delta = 0.1) {
        this.zoom = Math.max(0.1, Math.min(10, this.zoom - delta));
        this.applyTransform();
    }

    /**
     * 平移视图
     * @param {number} dx - X轴平移
     * @param {number} dy - Y轴平移
     */
    pan(dx, dy) {
        this.panX += dx;
        this.panY += dy;
        this.applyTransform();
    }

    /**
     * 更新UI状态
     */
    updateUI() {
        // 更新旋转按钮状态
        const rotateBtn = document.getElementById('rotate-btn');
        if (rotateBtn) {
            rotateBtn.classList.toggle('active', this.rotation !== 0);
        }
        
        // 更新翻转按钮状态
        const flipHBtn = document.getElementById('flip-h-btn');
        const flipVBtn = document.getElementById('flip-v-btn');
        if (flipHBtn) flipHBtn.classList.toggle('active', this.flipH);
        if (flipVBtn) flipVBtn.classList.toggle('active', this.flipV);
    }

    /**
     * 获取视图状态（用于序列化）
     */
    getState() {
        return {
            rotation: this.rotation,
            flipH: this.flipH,
            flipV: this.flipV,
            zoom: this.zoom,
            panX: this.panX,
            panY: this.panY
        };
    }

    /**
     * 恢复视图状态
     * @param {Object} state - 视图状态
     */
    setState(state) {
        if (state.rotation !== undefined) this.rotation = state.rotation;
        if (state.flipH !== undefined) this.flipH = state.flipH;
        if (state.flipV !== undefined) this.flipV = state.flipV;
        if (state.zoom !== undefined) this.zoom = state.zoom;
        if (state.panX !== undefined) this.panX = state.panX;
        if (state.panY !== undefined) this.panY = state.panY;
        this.applyTransform();
    }
}

/**
 * Bbox微调控制器 - 处理W/A/S/D微调和Shift+拖拽保持宽高比
 * 对应需求文档 2.1.2 矩形框标注辅助功能
 */
class BboxController {
    constructor() {
        this.stepSize = 1;      // 普通步长
        this.stepSizeShift = 10; // Shift按下时的大步长
    }

    /**
     * 微调bbox位置
     * @param {Object} annotation - 标注对象
     * @param {string} direction - 方向 (up/down/left/right)
     * @param {boolean} useLargeStep - 是否使用大步长
     */
    fineTune(annotation, direction, useLargeStep = false) {
        if (!annotation || annotation.type !== 'bbox') return;
        
        const step = useLargeStep ? this.stepSizeShift : this.stepSize;
        
        switch (direction) {
            case 'up':
                annotation.bbox[1] -= step;
                break;
            case 'down':
                annotation.bbox[1] += step;
                break;
            case 'left':
                annotation.bbox[0] -= step;
                break;
            case 'right':
                annotation.bbox[0] += step;
                break;
        }
        
        // 边界检查
        this.clampToImage(annotation);
        
        // 重新绘制
        if (typeof redrawCanvas === 'function') {
            redrawCanvas();
        }
        
        // 更新属性面板
        if (typeof updateAnnotationPanel === 'function') {
            updateAnnotationPanel();
        }
        
        // 记录历史
        if (AppState.history && typeof AppState.history.push === 'function') {
            AppState.history.push([...AppState.annotations]);
        }
    }

    /**
     * 限制bbox在图像范围内
     * @param {Object} annotation - 标注对象
     */
    clampToImage(annotation) {
        if (!annotation || !annotation.bbox) return;
        
        const img = document.getElementById('current-image');
        if (!img) return;
        
        const imgW = img.naturalWidth || img.width;
        const imgH = img.naturalHeight || img.height;
        
        const [x, y, w, h] = annotation.bbox;
        
        // 确保不超出边界
        if (x < 0) annotation.bbox[0] = 0;
        if (y < 0) annotation.bbox[1] = 0;
        if (x + w > imgW) annotation.bbox[0] = imgW - w;
        if (y + h > imgH) annotation.bbox[1] = imgH - h;
    }

    /**
     * 处理Shift+拖拽保持宽高比
     * @param {number} startX - 起始X
     * @param {number} startY - 起始Y
     * @param {number} currentX - 当前X
     * @param {number} currentY - 当前Y
     * @param {number} originalWidth - 原始宽度
     * @param {number} originalHeight - 原始高度
     * @returns {Array} - 调整后的 [x, y, width, height]
     */
    handleAspectRatio(startX, startY, currentX, currentY, originalWidth, originalHeight) {
        const dx = currentX - startX;
        const dy = currentY - startY;
        
        // 计算宽高比
        const aspectRatio = originalWidth / originalHeight;
        
        // 确定主要移动方向
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        
        let newWidth, newHeight;
        
        if (absDx > absDy) {
            // 水平移动为主
            newWidth = absDx * 2;
            newHeight = newWidth / aspectRatio;
        } else {
            // 垂直移动为主
            newHeight = absDy * 2;
            newWidth = newHeight * aspectRatio;
        }
        
        // 保持中心点不变
        const centerX = startX;
        const centerY = startY;
        
        return [
            centerX - newWidth / 2,
            centerY - newHeight / 2,
            newWidth,
            newHeight
        ];
    }

    /**
     * 批量微调多个选中的标注
     * @param {Array} annotations - 标注数组
     * @param {string} direction - 方向
     * @param {boolean} useLargeStep - 是否使用大步长
     */
    batchFineTune(annotations, direction, useLargeStep = false) {
        if (!annotations || annotations.length === 0) return;
        
        annotations.forEach(ann => {
            this.fineTune(ann, direction, useLargeStep);
        });
    }

    /**
     * 调整bbox大小（带宽高比保持）
     * @param {Object} annotation - 标注对象
     * @param {string} handle - 调整手柄
     * @param {number} dx - X增量
     * @param {number} dy - Y增量
     * @param {boolean} maintainAspect - 是否保持宽高比
     */
    resizeWithAspect(annotation, handle, dx, dy, maintainAspect = false) {
        if (!annotation || annotation.type !== 'bbox') return;
        
        const [x, y, w, h] = [...annotation.bbox];
        const aspectRatio = w / h;
        
        let newX = x, newY = y, newW = w, newH = h;
        
        if (maintainAspect) {
            // 保持宽高比的调整
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            
            if (absDx > absDy) {
                newW = w + (dx > 0 ? absDx : -absDx);
                newH = newW / aspectRatio;
            } else {
                newH = h + (dy > 0 ? absDy : -absDy);
                newW = newH * aspectRatio;
            }
        } else {
            // 普通调整（现有的resize逻辑）
            return; // 交给原有逻辑处理
        }
        
        // 应用新尺寸
        annotation.bbox = [newX, newY, newW, newH];
        this.clampToImage(annotation);
    }
}

// 全局实例
window.ViewControl = ViewControl;
window.BboxController = BboxController;
