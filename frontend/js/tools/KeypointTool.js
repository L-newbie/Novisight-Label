// ============================================
// Novisight Label - 关键点标注工具
// ============================================

/**
 * 关键点标注工具类
 */
class KeypointTool {
    constructor() {
        this.points = [];
        this.selectedPoint = null;
        this.isDragging = false;
        this.pointRadius = 8;
        this.skeleton = []; // 骨架连接关系
        this.skeletonColor = '#00ffcc';
    }

    /**
     * 设置骨架定义（用于人体关键点等）
     * @param {Array} skeleton - 骨架连接数组，如 [[0,1], [1,2], ...]
     */
    setSkeleton(skeleton) {
        this.skeleton = skeleton;
    }

    /**
     * 设置预定义的关键点模板
     * @param {string} templateName - 模板名称
     */
    setTemplate(templateName) {
        const templates = {
            // 人体17关键点
            'human_pose': {
                labels: ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
                        'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
                        'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
                        'left_knee', 'right_knee', 'left_ankle', 'right_ankle'],
                skeleton: [[0,1], [0,2], [1,3], [2,4], [5,6], [5,7], [7,9], [6,8], [8,10],
                          [5,11], [6,12], [11,12], [11,13], [13,15], [12,14], [14,16]]
            },
            // 人脸68关键点
            'face_68': {
                // 简化的脸部轮廓
                labels: Array.from({length: 68}, (_, i) => `point_${i}`),
                skeleton: [] // 68点太复杂，使用时按区域绘制
            }
        };

        if (templates[templateName]) {
            this.template = templates[templateName];
        }
    }

    /**
     * 处理鼠标按下
     * @param {number} x - 画布坐标X
     * @param {number} y - 画布坐标Y
     * @returns {Object} 操作结果
     */
    handleMouseDown(x, y) {
        // 检查是否点击了现有关键点
        const clickedIndex = this.findPointAt(x, y);
        
        if (clickedIndex !== -1) {
            // 选中现有关键点
            this.selectedPoint = clickedIndex;
            this.isDragging = true;
            return { type: 'select', index: clickedIndex };
        } else {
            // 添加新关键点
            this.points.push({
                x,
                y,
                id: this.points.length + 1,
                label: this.template ? this.template.labels[this.points.length] : `P${this.points.length + 1}`
            });
            this.selectedPoint = this.points.length - 1;
            return { type: 'add', index: this.points.length - 1 };
        }
    }

    /**
     * 处理鼠标移动
     * @param {number} x - 画布坐标X
     * @param {number} y - 画布坐标Y
     */
    handleMouseMove(x, y) {
        if (this.isDragging && this.selectedPoint !== null) {
            // 移动关键点
            this.points[this.selectedPoint] = {
                ...this.points[this.selectedPoint],
                x,
                y
            };
            return { type: 'move', index: this.selectedPoint };
        }
        
        // 预览新关键点位置
        return null;
    }

    /**
     * 处理鼠标释放
     * @returns {Object} 操作结果
     */
    handleMouseUp() {
        if (this.isDragging) {
            this.isDragging = false;
            return { type: 'drag_end' };
        }
        return null;
    }

    /**
     * 查找指定位置的关键点
     * @param {number} x - 坐标X
     * @param {number} y - 坐标Y
     * @returns {number} 关键点索引，未找到返回-1
     */
    findPointAt(x, y) {
        const hitRadius = this.pointRadius + 4;
        
        for (let i = this.points.length - 1; i >= 0; i--) {
            const point = this.points[i];
            const dx = x - point.x;
            const dy = y - point.y;
            if (dx * dx + dy * dy <= hitRadius * hitRadius) {
                return i;
            }
        }
        
        return -1;
    }

    /**
     * 删除指定索引的关键点
     * @param {number} index - 关键点索引
     */
    deletePoint(index) {
        if (index >= 0 && index < this.points.length) {
            this.points.splice(index, 1);
            // 重新编号
            this.points.forEach((p, i) => {
                p.id = i + 1;
            });
            
            if (this.selectedPoint >= this.points.length) {
                this.selectedPoint = this.points.length - 1;
            }
        }
    }

    /**
     * 删除最后一个关键点
     */
    deleteLastPoint() {
        if (this.points.length > 0) {
            this.points.pop();
            if (this.selectedPoint >= this.points.length) {
                this.selectedPoint = this.points.length - 1;
            }
        }
    }

    /**
     * 清除所有关键点
     */
    clear() {
        this.points = [];
        this.selectedPoint = null;
        this.isDragging = false;
    }

    /**
     * 获取关键点数据
     * @returns {Array} 关键点数组
     */
    getPoints() {
        return [...this.points];
    }

    /**
     * 设置关键点数据
     * @param {Array} points - 关键点数组
     */
    setPoints(points) {
        this.points = points.map((p, i) => ({
            ...p,
            id: p.id || i + 1,
            label: p.label || (this.template ? this.template.labels[i] : `P${i + 1}`)
        }));
    }

    /**
     * 获取标注目标数据
     * @returns {Object} 标注对象
     */
    getAnnotation() {
        if (this.points.length === 0) return null;
        
        return {
            type: 'keypoint',
            points: this.getPoints(),
            skeleton: this.skeleton,
            template: this.template ? this.template.labels : null
        };
    }

    /**
     * 绘制关键点到Canvas
     * @param {CanvasRenderingContext2D} ctx - Canvas上下文
     * @param {number} scale - 缩放比例
     */
    draw(ctx, scale = 1) {
        const radius = this.pointRadius * scale;
        
        // 绘制骨架连线
        if (this.skeleton.length > 0) {
            ctx.save();
            ctx.strokeStyle = this.skeletonColor;
            ctx.lineWidth = 2 * scale;
            
            this.skeleton.forEach(([i, j]) => {
                if (this.points[i] && this.points[j]) {
                    ctx.beginPath();
                    ctx.moveTo(this.points[i].x, this.points[i].y);
                    ctx.lineTo(this.points[j].x, this.points[j].y);
                    ctx.stroke();
                }
            });
            
            ctx.restore();
        } else if (this.template && this.template.skeleton && this.template.skeleton.length > 0) {
            // 使用模板骨架
            ctx.save();
            ctx.strokeStyle = this.skeletonColor;
            ctx.lineWidth = 2 * scale;
            
            this.template.skeleton.forEach(([i, j]) => {
                if (this.points[i] && this.points[j]) {
                    ctx.beginPath();
                    ctx.moveTo(this.points[i].x, this.points[i].y);
                    ctx.lineTo(this.points[j].x, this.points[j].y);
                    ctx.stroke();
                }
            });
            
            ctx.restore();
        } else if (this.points.length > 1) {
            // 默认：按顺序连接所有点
            ctx.save();
            ctx.strokeStyle = this.skeletonColor;
            ctx.lineWidth = 2 * scale;
            ctx.beginPath();
            ctx.moveTo(this.points[0].x, this.points[0].y);
            for (let i = 1; i < this.points.length; i++) {
                ctx.lineTo(this.points[i].x, this.points[i].y);
            }
            ctx.stroke();
            ctx.restore();
        }
        
        // 绘制关键点
        this.points.forEach((point, index) => {
            const isSelected = index === this.selectedPoint;
            const pointRadius = isSelected ? radius * 1.2 : radius;
            
            ctx.save();
            
            // 外圈
            ctx.fillStyle = isSelected ? '#ff6b6b' : this.skeletonColor;
            ctx.beginPath();
            ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
            ctx.fill();
            
            // 内圈
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.arc(point.x, point.y, pointRadius * 0.5, 0, Math.PI * 2);
            ctx.fill();
            
            // 标签
            if (point.label) {
                ctx.fillStyle = '#fff';
                ctx.font = `${10 * scale}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(point.label, point.x, point.y - pointRadius - 8);
            } else {
                // 编号
                ctx.fillStyle = '#fff';
                ctx.font = `bold ${9 * scale}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText((index + 1).toString(), point.x, point.y);
            }
            
            ctx.restore();
        });
    }

    /**
     * 绘制临时状态（如正在添加时的预览）
     * @param {CanvasRenderingContext2D} ctx - Canvas上下文
     * @param {number} x - 预览位置X
     * @param {number} y - 预览位置Y
     */
    drawPreview(ctx, x, y) {
        // 绘制预览点（虚线圆圈）
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 255, 204, 0.5)';
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, this.pointRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // 连接预览点到最后一个点
        if (this.points.length > 0) {
            const lastPoint = this.points[this.points.length - 1];
            ctx.beginPath();
            ctx.moveTo(lastPoint.x, lastPoint.y);
            ctx.lineTo(x, y);
            ctx.stroke();
        }
        
        ctx.restore();
    }
}

// 全局关键点工具实例
window.KeypointTool = KeypointTool;
