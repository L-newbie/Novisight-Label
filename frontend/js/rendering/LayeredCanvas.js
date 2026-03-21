// ============================================
// Novisight Label - 分层渲染模块
// ============================================

/**
 * 分层画布管理器 - 优化渲染性能
 * 将背景、标注、交互层分离，避免全量重绘
 */
class LayeredCanvas {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error('Canvas container not found');
            return;
        }
        
        this.layers = {};
        this.contexts = {};
        this.dirtyFlags = {
            background: false,
            annotations: false,
            interaction: true
        };
        
        this.isRunning = false;
        this.animationFrameId = null;
        
        this.init();
    }

    /**
     * 初始化分层画布
     */
    init() {
        // 创建背景层（图像）
        this.layers.background = this.createCanvas('bg-canvas', 'background-layer');
        
        // 创建标注层
        this.layers.annotations = this.createCanvas('ann-canvas', 'annotation-layer');
        
        // 创建交互层（临时绘制）
        this.layers.interaction = this.createCanvas('int-canvas', 'interaction-layer');
        
        // 获取2D上下文
        this.contexts.background = this.layers.background.getContext('2d');
        this.contexts.annotations = this.layers.annotations.getContext('2d');
        this.contexts.interaction = this.layers.interaction.getContext('2d');
        
        // 设置容器样式
        this.container.style.position = 'relative';
        this.container.style.overflow = 'hidden';
        
        // 启动渲染循环
        this.startRenderLoop();
    }

    /**
     * 创建单个Canvas层
     */
    createCanvas(id, className) {
        const canvas = document.createElement('canvas');
        canvas.id = id;
        canvas.className = className;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        this.container.appendChild(canvas);
        return canvas;
    }

    /**
     * 设置画布尺寸
     */
    setSize(width, height) {
        Object.values(this.layers).forEach(canvas => {
            canvas.width = width;
            canvas.height = height;
        });
        
        this.markDirty('background');
        this.markDirty('annotations');
    }

    /**
     * 标记需要重绘的层
     */
    markDirty(layer) {
        this.dirtyFlags[layer] = true;
    }

    /**
     * 标记所有层需要重绘
     */
    markAllDirty() {
        this.dirtyFlags = {
            background: true,
            annotations: true,
            interaction: true
        };
    }

    /**
     * 渲染背景层（图像）
     */
    renderBackground() {
        const ctx = this.contexts.background;
        const canvas = this.layers.background;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (AppState.currentImage) {
            ctx.drawImage(AppState.currentImage, 0, 0, canvas.width, canvas.height);
        }
    }

    /**
     * 渲染标注层
     */
    renderAnnotations() {
        const ctx = this.contexts.annotations;
        const canvas = this.layers.annotations;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (!AppState.annotations || AppState.annotations.length === 0) return;
        
        const scale = AppState.zoom;
        
        AppState.annotations.forEach((ann, index) => {
            // 检查可见性
            if (ann.visible === false) return;
            
            const isSelected = index === AppState.selectedAnnotation;
            const isHovered = index === AppState.hoveredAnnotation;
            this.drawAnnotation(ctx, ann, isSelected, isHovered, scale);
        });
    }

    /**
     * 绘制单个标注
     */
    drawAnnotation(ctx, annotation, isSelected, isHovered, scale) {
        ctx.save();
        
        const annType = annotation.type || 'bbox';
        let color = annotation.color || '#00ffcc';
        
        // 选中/悬停状态颜色
        if (isSelected) {
            color = '#ff6b6b';
        } else if (isHovered) {
            color = '#ffd93d';
        }
        
        ctx.strokeStyle = color;
        ctx.fillStyle = color + '33';
        ctx.lineWidth = 2;
        
        if (annType === 'bbox') {
            const [x, y, w, h] = annotation.bbox;
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
            
            if (isSelected) {
                this.drawResizeHandles(ctx, x, y, w, h, scale);
            }
        } else if (annType === 'polygon' && annotation.points) {
            ctx.beginPath();
            ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
            for (let i = 1; i < annotation.points.length; i++) {
                ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else if (annType === 'brush' && annotation.points) {
            ctx.beginPath();
            ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
            for (let i = 1; i < annotation.points.length; i++) {
                ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
            }
            ctx.stroke();
        } else if (annType === 'keypoint' && annotation.points) {
            // 绘制关键点
            this.drawKeypoints(ctx, annotation.points, color, isSelected);
        }
        
        // 绘制标签
        if (annotation.label && isSelected && annotation.type === 'bbox') {
            const [x, y] = annotation.bbox;
            const label = AppState.labels.find(l => l.id === annotation.label);
            if (label) {
                ctx.fillStyle = color;
                ctx.fillRect(x, y - 20, ctx.measureText(label.name).width + 10, 20);
                ctx.fillStyle = '#000';
                ctx.font = '12px Arial';
                ctx.fillText(label.name, x + 5, y - 5);
            }
        }
        
        // 绘制序号
        if (isSelected || true) {
            const idx = AppState.annotations.indexOf(annotation);
            if (annotation.type === 'bbox') {
                const [x, y] = annotation.bbox;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x + 10, y + 10, 10, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#000';
                ctx.font = 'bold 10px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((idx + 1).toString(), x + 10, y + 10);
            }
        }
        
        ctx.restore();
    }

    /**
     * 绘制关键点
     */
    drawKeypoints(ctx, points, color, isSelected) {
        // 绘制骨架连线
        if (points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x, points[i].y);
            }
            ctx.stroke();
        }
        
        // 绘制关键点
        const radius = isSelected ? 8 : 6;
        points.forEach((point, index) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            ctx.fill();
            
            // 绘制编号
            ctx.fillStyle = '#000';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((index + 1).toString(), point.x, point.y);
        });
    }

    /**
     * 绘制调整手柄
     */
    drawResizeHandles(ctx, x, y, w, h, scale) {
        const handleSize = 8;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#00ffcc';
        ctx.lineWidth = 1;
        
        const handles = [
            [x, y], [x + w / 2, y], [x + w, y],
            [x + w, y + h / 2], [x + w, y + h],
            [x + w / 2, y + h], [x, y + h], [x, y + h / 2]
        ];
        
        handles.forEach(([hx, hy]) => {
            ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
            ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
        });
    }

    /**
     * 渲染交互层（临时绘制）
     */
    renderInteraction() {
        const ctx = this.contexts.interaction;
        const canvas = this.layers.interaction;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 由外部控制临时绘制内容
        EventBus.emit('render:interaction', ctx);
    }

    /**
     * 渲染循环
     */
    render() {
        if (this.dirtyFlags.background) {
            this.renderBackground();
            this.dirtyFlags.background = false;
        }
        
        if (this.dirtyFlags.annotations) {
            this.renderAnnotations();
            this.dirtyFlags.annotations = false;
        }
        
        // 交互层总是重绘
        this.renderInteraction();
    }

    /**
     * 启动渲染循环
     */
    startRenderLoop() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        const loop = () => {
            if (!this.isRunning) return;
            
            this.render();
            this.animationFrameId = requestAnimationFrame(loop);
        };
        
        loop();
    }

    /**
     * 停止渲染循环
     */
    stopRenderLoop() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * 获取交互层上下文（用于临时绘制）
     */
    getInteractionContext() {
        return this.contexts.interaction;
    }

    /**
     * 清除交互层
     */
    clearInteraction() {
        const ctx = this.contexts.interaction;
        const canvas = this.layers.interaction;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// 全局分层画布实例
window.LayeredCanvas = LayeredCanvas;
