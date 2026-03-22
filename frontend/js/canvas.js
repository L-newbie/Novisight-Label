// ============================================
// Novisight Label - 画布标注核心
// ============================================

(function() {
    // 画布状态
    const CanvasState = {
        isDrawing: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
        draggedAnnotation: null,
        originalBbox: null,  // 保存原始bbox用于正确的增量计算
        originalPoints: null,  // 保存原始points用于多边形/画笔
        resizeHandle: null,
        polygonPoints: [],
        brushPoints: [],
        isPanning: false,    // 是否正在平移视图
        panStartX: 0,        // 平移开始时的鼠标X坐标
        panStartY: 0,        // 平移开始时的鼠标Y坐标
        panOffsetX: 0,       // 当前平移的X偏移
        panOffsetY: 0       // 当前平移的Y偏移
    };
    
    // 标准化bbox格式：将 [x1, y1, x2, y2] 转换为 [x, y, w, h]
    function normalizeBbox(bbox) {
        if (!bbox || bbox.length !== 4) return [0, 0, 0, 0];
        
        const [a, b, c, d] = bbox;
        // 如果是 [x1, y1, x2, y2] 格式 (右下角坐标)
        if (c < a || d < b) {
            return [
                Math.min(a, c),
                Math.min(b, d),
                Math.abs(c - a),
                Math.abs(d - b)
            ];
        }
        // 如果是 [x, y, w, h] 格式 (宽度高度)
        // 检查 c 和 d 是宽度/高度还是右下角坐标
        // 如果 c > a 且 d > b，且 c-a > 1 且 d-b > 1，可能是右下角坐标
        if (c > a && d > b && (c - a) > 1 && (d - b) > 1 && a < 1000 && b < 1000) {
            // 可能是 [x1, y1, x2, y2] 格式
            return [
                a, b, c - a, d - b
            ];
        }
        // 默认认为是 [x, y, w, h] 格式
        return [a, b, c, d];
    }
    
    // 导出标准化函数供其他地方使用
    window.normalizeBbox = normalizeBbox;
    
    // 性能优化：渲染队列和节流
    let renderPending = false;
    let lastRenderTime = 0;
    const MIN_RENDER_INTERVAL = 16; // 约60fps
    
    // 批量渲染请求
    function scheduleRender() {
        if (renderPending) return;
        
        renderPending = true;
        const now = performance.now();
        const timeSinceLastRender = now - lastRenderTime;
        
        if (timeSinceLastRender >= MIN_RENDER_INTERVAL) {
            performRender();
        } else {
            setTimeout(performRender, MIN_RENDER_INTERVAL - timeSinceLastRender);
        }
    }
    
    function performRender() {
        if (!renderPending) return;
        renderPending = false;
        lastRenderTime = performance.now();
        window.redrawCanvas();
    }

    // 初始化画布
    function initCanvas() {
        const canvas = document.getElementById('main-canvas');
        if (!canvas) return;
        
        const wrapper = document.getElementById('canvas-wrapper');
        
        // 设置画布大小
        resizeCanvas();
        
        // 绑定鼠标事件
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseleave', handleMouseLeave);
        
        // 滚轮缩放
        wrapper.addEventListener('wheel', handleWheel);
        
        // 窗口大小改变
        window.addEventListener('resize', resizeCanvas);
    }

    function resizeCanvas() {
        const canvas = document.getElementById('main-canvas');
        const wrapper = document.getElementById('canvas-wrapper');
        
        if (!canvas || !wrapper) return;
        
        // 等待wrapper有正确的尺寸
        const rect = wrapper.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            setTimeout(resizeCanvas, 100);
            return;
        }
        
        // 如果已经有图像，保持canvas的内部尺寸为图像的实际像素尺寸
        // 使用CSS transform来处理缩放，性能更好
        if (AppState.currentImage) {
            const img = AppState.currentImage;
            
            // 确保canvas内部尺寸保持为图像的实际像素尺寸
            canvas.width = img.width;
            canvas.height = img.height;
            
            // 重置平移偏移量（加载新图像时）
            CanvasState.panOffsetX = 0;
            CanvasState.panOffsetY = 0;
            
            // 计算显示缩放：让图像适应wrapper大小，同时保持宽高比
            const scaleX = rect.width / img.width;
            const scaleY = rect.height / img.height;
            const displayScale = Math.min(scaleX, scaleY, 1); // 不放大，只缩小或保持原尺寸
            
            // 保存当前显示比例供其他函数使用
            AppState.displayScale = displayScale;
            
            // 使用CSS transform来处理缩放，性能更好
            updateCanvasTransform();
            
            console.log(`[resizeCanvas] 图像: ${img.width}x${img.height}, Wrapper: ${rect.width}x${rect.height}, displayScale: ${displayScale.toFixed(4)}, zoom: ${AppState.zoom}`);
            
            // 使用节流渲染
            scheduleRender();
        } else {
            // 首次加载时使用wrapper的尺寸
            canvas.width = rect.width;
            canvas.height = rect.height;
            canvas.style.width = rect.width + 'px';
            canvas.style.height = rect.height + 'px';
            canvas.style.transform = 'none';
            AppState.displayScale = 1;
        }
    }

    // 鼠标按下处理
    function handleMouseDown(e) {
        const canvas = document.getElementById('main-canvas');
        const rect = canvas.getBoundingClientRect();
        
        // 计算画布内的坐标（以左上角为原点）
        // 需要考虑平移偏移量，将屏幕坐标转换为原始图像坐标
        const scale = getScale();
        const screenX = (e.clientX - rect.left) / scale;
        const screenY = (e.clientY - rect.top) / scale;
        const x = screenX - CanvasState.panOffsetX;
        const y = screenY - CanvasState.panOffsetY;
        
        CanvasState.startX = x;
        CanvasState.startY = y;
        CanvasState.currentX = x;
        CanvasState.currentY = y;
        CanvasState.shiftKey = e.shiftKey; // 追踪Shift键状态
        
        // 处理平移功能：支持中键拖动、或按住Alt键拖动、或在选择工具下拖动空白区域
        // 判断是否可以平移：选择工具时可以在空白区域拖动，或按住Alt/中键
        const canPan = (e.button === 1) || (e.button === 0 && e.altKey);
        const isSelectTool = AppState.currentTool === 'select';
        const clickedIndex = isSelectTool ? findAnnotationAt(x, y) : -1;
        const canPanInSelectMode = isSelectTool && clickedIndex === -1;
        
        if ((canPan || canPanInSelectMode) && !CanvasState.isDrawing) {
            e.preventDefault();
            CanvasState.isPanning = true;
            CanvasState.panStartX = e.clientX;
            CanvasState.panStartY = e.clientY;
            canvas.style.cursor = 'grabbing';
            return;
        }
        
        // 用户开始标注，设置状态
        if (AppState.currentTool !== 'select') {
            AppState.isUserAnnotating = true;
        }
        
        if (AppState.currentTool === 'select') {
            // 检查是否点击了标注
            const clickedIndex = findAnnotationAt(x, y);
            
            if (clickedIndex !== -1) {
                AppState.selectedAnnotation = clickedIndex;
                CanvasState.isDragging = true;
                CanvasState.dragStartX = x;
                CanvasState.dragStartY = y;
                CanvasState.draggedAnnotation = {...AppState.annotations[clickedIndex]};
                
                // 保存原始位置用于正确的增量计算
                const ann = AppState.annotations[clickedIndex];
                if (ann.type === 'bbox') {
                    CanvasState.originalBbox = [...ann.bbox];
                } else if (ann.points) {
                    CanvasState.originalPoints = ann.points.map(p => ({...p}));
                } else if (ann.type === 'text') {
                    CanvasState.originalBbox = [ann.x, ann.y];
                }
                
                // 检查是否点击了调整手柄
                const handle = findResizeHandle(x, y, AppState.annotations[clickedIndex]);
                if (handle) {
                    CanvasState.resizeHandle = handle;
                }
                
                // 显示标注详情（支持双向关联）
                if (typeof showAnnotationDetails === 'function') {
                    showAnnotationDetails(clickedIndex);
                }
            } else {
                AppState.selectedAnnotation = null;
            }
            
            renderAnnotations();
            redrawCanvas();
        } else if (AppState.currentTool === 'bbox') {
            CanvasState.isDrawing = true;
        } else if (AppState.currentTool === 'polygon') {
            if (!CanvasState.isDrawing) {
                CanvasState.isDrawing = true;
                CanvasState.polygonPoints = [{x, y}];
            } else {
                CanvasState.polygonPoints.push({x, y});
            }
            redrawCanvas();
        } else if (AppState.currentTool === 'text') {
            // 文本标注工具 - 点击创建文本
            if (typeof TextTool !== 'undefined' && AppState.textTool) {
                AppState.textTool.createTextAnnotation(x, y, '');
            }
        } else if (AppState.currentTool === 'brush') {
            CanvasState.isDrawing = true;
            CanvasState.brushPoints = [{x, y}];
            redrawCanvas();
        }
    }

    // 鼠标移动处理
    function handleMouseMove(e) {
        const canvas = document.getElementById('main-canvas');
        const rect = canvas.getBoundingClientRect();
        
        // 处理平移（拖动视图）- 在canvas内部移动图像
        if (CanvasState.isPanning) {
            const scale = getScale();
            const dx = (e.clientX - CanvasState.panStartX) / scale;
            const dy = (e.clientY - CanvasState.panStartY) / scale;
            
            // 保存平移偏移量，用于在绘制时应用
            CanvasState.panOffsetX += dx;
            CanvasState.panOffsetY += dy;
            
            // 限制平移范围，确保图像不会完全移出可视区域
            const maxOffsetX = canvas.width / 2;
            const maxOffsetY = canvas.height / 2;
            CanvasState.panOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, CanvasState.panOffsetX));
            CanvasState.panOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, CanvasState.panOffsetY));
            
            // 重绘canvas，应用平移
            redrawCanvas();
            
            CanvasState.panStartX = e.clientX;
            CanvasState.panStartY = e.clientY;
            return;
        }
        
        const scale = getScale();
        const screenX = (e.clientX - rect.left) / scale;
        const screenY = (e.clientY - rect.top) / scale;
        const x = screenX - CanvasState.panOffsetX;
        const y = screenY - CanvasState.panOffsetY;
        
        CanvasState.currentX = x;
        CanvasState.currentY = y;
        CanvasState.shiftKey = e.shiftKey; // 实时更新Shift键状态
        
        // 更新坐标显示
        updateCoordinatesDisplay(x, y);
        
        // 光标反馈 - 仅在选择工具时
        if (AppState.currentTool === 'select') {
            // 检查是否悬停在调整手柄上
            if (AppState.selectedAnnotation !== null) {
                const selectedAnn = AppState.annotations[AppState.selectedAnnotation];
                const handle = findResizeHandle(x, y, selectedAnn);
                
                if (handle) {
                    // 设置对应的光标
                    const cursorMap = {
                        'nw': 'nwse-resize', 'se': 'nwse-resize',
                        'ne': 'nesw-resize', 'sw': 'nesw-resize',
                        'n': 'ns-resize', 's': 'ns-resize',
                        'e': 'ew-resize', 'w': 'ew-resize'
                    };
                    canvas.style.cursor = cursorMap[handle] || 'pointer';
                    e.preventDefault();
                    return;
                }
            }
            
            // 检查是否悬停在标注上
            const hoveredIndex = findAnnotationAt(x, y);
            if (hoveredIndex !== -1) {
                canvas.style.cursor = 'move';
                AppState.hoveredAnnotation = hoveredIndex;
                renderAnnotations();
            } else {
                if (AppState.hoveredAnnotation !== null) {
                    AppState.hoveredAnnotation = null;
                    renderAnnotations();
                }
                canvas.style.cursor = 'default';
            }
        }
        
        if (CanvasState.isDragging && AppState.selectedAnnotation !== null) {
            const ann = AppState.annotations[AppState.selectedAnnotation];
            const dx = x - CanvasState.dragStartX;
            const dy = y - CanvasState.dragStartY;
            
            if (CanvasState.resizeHandle) {
                // 调整大小 - 使用原始bbox计算正确的增量
                resizeAnnotation(ann, CanvasState.resizeHandle, dx, dy, CanvasState.originalBbox);
            } else {
                // 移动整个标注框
                if (ann.type === 'bbox' && CanvasState.originalBbox) {
                    // bbox格式为 [x1, y1, x2, y2]
                    const [x1_orig, y1_orig, x2_orig, y2_orig] = CanvasState.originalBbox;
                    
                    // 计算新的坐标
                    let newX1 = x1_orig + dx;
                    let newY1 = y1_orig + dy;
                    let newX2 = x2_orig + dx;
                    let newY2 = y2_orig + dy;
                    
                    // 确保边界检查
                    const imgWidth = AppState.currentImage ? AppState.currentImage.width : canvas.width;
                    const imgHeight = AppState.currentImage ? AppState.currentImage.height : canvas.height;
                    
                    // 计算宽度和高度
                    const w = Math.abs(newX2 - newX1);
                    const h = Math.abs(newY2 - newY1);
                    
                    // 限制在图像范围内
                    newX1 = Math.max(0, Math.min(newX1, imgWidth - w));
                    newY1 = Math.max(0, Math.min(newY1, imgHeight - h));
                    newX2 = Math.max(w, Math.min(newX2, imgWidth));
                    newY2 = Math.max(h, Math.min(newY2, imgHeight));
                    
                    ann.bbox = [newX1, newY1, newX2, newY2];
                } else if ((ann.type === 'polygon' || ann.type === 'brush') && CanvasState.originalPoints) {
                    // 移动多边形/画笔所有点
                    ann.points = CanvasState.originalPoints.map(p => ({
                        x: p.x + dx,
                        y: p.y + dy
                    }));
                } else if (ann.type === 'text' && CanvasState.originalBbox) {
                    // 移动文本位置
                    ann.x = CanvasState.originalBbox[0] + dx;
                    ann.y = CanvasState.originalBbox[1] + dy;
                }
            }
            
            redrawCanvas();
            renderAnnotations();
        } else if (CanvasState.isDrawing) {
            if (AppState.currentTool === 'bbox') {
                redrawCanvas();
                const ctx = canvas.getContext('2d');
                drawTempBoundingBox(ctx, CanvasState.startX, CanvasState.startY, x, y, CanvasState.shiftKey);
            } else if (AppState.currentTool === 'brush') {
                CanvasState.brushPoints.push({x, y});
                redrawCanvas();
                drawBrushStroke();
            }
        }
    }

    // 鼠标释放处理
    function handleMouseUp(e) {
        // 结束平移
        if (CanvasState.isPanning) {
            CanvasState.isPanning = false;
            const c = document.getElementById('main-canvas');
            if (c) c.style.cursor = 'default';
            return;
        }
        
        // 用户结束标注
        AppState.isUserAnnotating = false;
        
        if (CanvasState.isDragging) {
            CanvasState.isDragging = false;
            CanvasState.resizeHandle = null;
            CanvasState.originalBbox = null;
            CanvasState.originalPoints = null;
            saveAnnotations();
            return;
        }
        
        if (!CanvasState.isDrawing) return;
        
        const canvas = document.getElementById('main-canvas');
        const rect = canvas.getBoundingClientRect();
        const scale = getScale();
        const screenX = (e.clientX - rect.left) / scale;
        const screenY = (e.clientY - rect.top) / scale;
        const x = screenX - CanvasState.panOffsetX;
        const y = screenY - CanvasState.panOffsetY;
        
        if (AppState.currentTool === 'bbox') {
            // bbox格式为 [x1, y1, x2, y2]
            const x1 = Math.min(CanvasState.startX, x);
            const y1 = Math.min(CanvasState.startY, y);
            const x2 = Math.max(CanvasState.startX, x);
            const y2 = Math.max(CanvasState.startY, y);
            
            const width = x2 - x1;
            const height = y2 - y1;
            
            if (width > 5 && height > 5) {
                // 不直接创建标注，而是显示标签选择菜单
                const annotationData = {
                    type: 'bbox',
                    bbox: [x1, y1, x2, y2]
                };
                
                // 调用全局函数显示标签选择菜单
                if (typeof openLabelSelectModal === 'function') {
                    openLabelSelectModal(annotationData);
                } else {
                    // 如果函数不存在，直接创建标注
                    AppState.annotations.push({
                        type: 'bbox',
                        bbox: bbox,
                        label: '',
                        note: ''
                    });
                    AppState.selectedAnnotation = AppState.annotations.length - 1;
                    renderAnnotations();
                    saveAnnotations();
                }
            }
        }
        
        CanvasState.isDrawing = false;
        redrawCanvas();
    }

    function handleMouseLeave() {
        if (CanvasState.isDragging) {
            CanvasState.isDragging = false;
            CanvasState.resizeHandle = null;
            CanvasState.originalBbox = null;
            CanvasState.originalPoints = null;
            saveAnnotations();
        }
        
        if (CanvasState.isDrawing) {
            CanvasState.isDrawing = false;
            
            if (AppState.currentTool === 'polygon' && CanvasState.polygonPoints.length >= 3) {
                // 显示标签选择菜单
                const annotationData = {
                    type: 'polygon',
                    points: [...CanvasState.polygonPoints]
                };
                
                if (typeof openLabelSelectModal === 'function') {
                    openLabelSelectModal(annotationData);
                } else {
                    AppState.annotations.push({
                        type: 'polygon',
                        points: [...CanvasState.polygonPoints],
                        label: '',
                        note: ''
                    });
                    AppState.selectedAnnotation = AppState.annotations.length - 1;
                    renderAnnotations();
                    saveAnnotations();
                }
            } else if (AppState.currentTool === 'brush' && CanvasState.brushPoints.length > 2) {
                // 显示标签选择菜单
                const annotationData = {
                    type: 'brush',
                    points: [...CanvasState.brushPoints]
                };
                
                if (typeof openLabelSelectModal === 'function') {
                    openLabelSelectModal(annotationData);
                } else {
                    AppState.annotations.push({
                        type: 'brush',
                        points: [...CanvasState.brushPoints],
                        label: '',
                        note: ''
                    });
                    AppState.selectedAnnotation = AppState.annotations.length - 1;
                    renderAnnotations();
                    saveAnnotations();
                }
            }
            
            CanvasState.polygonPoints = [];
            CanvasState.brushPoints = [];
        }
        
        redrawCanvas();
    }

    // 双击完成多边形
    function handleDoubleClick(e) {
        if (AppState.currentTool === 'polygon' && CanvasState.polygonPoints.length >= 3) {
            CanvasState.isDrawing = false;
            
            // 显示标签选择菜单
            const annotationData = {
                type: 'polygon',
                points: [...CanvasState.polygonPoints]
            };
            
            if (typeof openLabelSelectModal === 'function') {
                openLabelSelectModal(annotationData);
            } else {
                AppState.annotations.push({
                    type: 'polygon',
                    points: [...CanvasState.polygonPoints],
                    label: '',
                    note: ''
                });
                AppState.selectedAnnotation = AppState.annotations.length - 1;
                CanvasState.polygonPoints = [];
                
                renderAnnotations();
                redrawCanvas();
                saveAnnotations();
            }
            
            CanvasState.polygonPoints = [];
            redrawCanvas();
        }
    }

    // 滚轮缩放 - 优化版本，使用CSS transform
    function handleWheel(e) {
        e.preventDefault();
        
        // 使用节流防止频繁触发
        const now = performance.now();
        if (this._lastWheelTime && now - this._lastWheelTime < 16) {
            return;
        }
        this._lastWheelTime = now;
        
        if (e.deltaY < 0) {
            AppState.zoom = Math.min(AppState.zoom * 1.1, 5);
        } else {
            AppState.zoom = Math.max(AppState.zoom / 1.1, 0.2);
        }
        
        // 使用CSS transform替代修改尺寸，性能更好
        updateCanvasTransform();
        
        // 保存缩放级别
        if (typeof saveZoomLevel === 'function') {
            saveZoomLevel();
        }
        
        // 使用节流渲染
        scheduleRender();
    }
    
    // 更新画布CSS transform
    function updateCanvasTransform() {
        const canvas = document.getElementById('main-canvas');
        const wrapper = document.getElementById('canvas-wrapper');
        if (!canvas) return;
        
        if (AppState.currentImage) {
            const displayScale = AppState.displayScale || 1;
            const transformScale = displayScale * AppState.zoom;
            // 保持现有的平移状态
            const currentTransform = wrapper ? wrapper.style.transform || '' : '';
            const translateMatch = currentTransform.match(/translate\((-?\d+\.?\d*)px,\s*(-?\d+\.?\d*)px\)/);
            let translateX = 0;
            let translateY = 0;
            if (translateMatch) {
                translateX = parseFloat(translateMatch[1]);
                translateY = parseFloat(translateMatch[2]);
            }
            canvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${transformScale})`;
        }
    }

    // 获取缩放比例（用户缩放 * 显示适应缩放）
    function getScale() {
        // 使用保存的显示缩放比例（图像适应wrapper的比例）
        // 乘以用户控制的缩放级别
        const displayScale = AppState.displayScale || 1;
        return AppState.zoom * displayScale;
    }

    // 更新坐标显示
    function updateCoordinatesDisplay(x, y) {
        const coordX = document.getElementById('coord-x');
        const coordY = document.getElementById('coord-y');
        const coordW = document.getElementById('coord-w');
        const coordH = document.getElementById('coord-h');
        
        if (coordX) coordX.textContent = `X: ${Math.round(x)}`;
        if (coordY) coordY.textContent = `Y: ${Math.round(y)}`;
        
        if (AppState.selectedAnnotation !== null && AppState.selectedAnnotation >= 0) {
            const ann = AppState.annotations[AppState.selectedAnnotation];
            if (ann && ann.type === 'bbox' && ann.bbox) {
                // bbox格式为 [x1, y1, x2, y2]
                const [x1, y1, x2, y2] = ann.bbox;
                const w = Math.abs(x2 - x1);
                const h = Math.abs(y2 - y1);
                if (coordW) coordW.textContent = `W: ${Math.round(w)}`;
                if (coordH) coordH.textContent = `H: ${Math.round(h)}`;
                return;
            }
        }
        
        if (coordW) coordW.textContent = 'W: 0';
        if (coordH) coordH.textContent = 'H: 0';
    }

    // 查找指定位置的标注
    function findAnnotationAt(x, y) {
        for (let i = AppState.annotations.length - 1; i >= 0; i--) {
            const ann = AppState.annotations[i];
            
            if (ann.type === 'bbox') {
                // bbox格式为 [x1, y1, x2, y2]
                const [x1, y1, x2, y2] = ann.bbox;
                const bx = Math.min(x1, x2);
                const by = Math.min(y1, y2);
                const bw = Math.abs(x2 - x1);
                const bh = Math.abs(y2 - y1);
                if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) {
                    return i;
                }
            } else if (ann.type === 'polygon' && ann.points) {
                if (isPointInPolygon(x, y, ann.points)) {
                    return i;
                }
            } else if (ann.type === 'text') {
                // 文本标注的点击检测
                const tx = ann.x || 0;
                const ty = ann.y || 0;
                const tw = ann.width || 200;
                const th = ann.height || 40;
                if (x >= tx && x <= tx + tw && y >= ty && y <= ty + th) {
                    return i;
                }
            } else if (ann.type === 'brush' && ann.points && ann.points.length > 0) {
                // 画笔笔触的点击检测 - 检查点附近
                for (const point of ann.points) {
                    if (Math.abs(x - point.x) <= 10 && Math.abs(y - point.y) <= 10) {
                        return i;
                    }
                }
            }
        }
        
        return -1;
    }

    // 查找调整手柄
    function findResizeHandle(x, y, annotation) {
        if (!annotation || annotation.type !== 'bbox') return null;
        
        const handleSize = 10;
        // bbox格式为 [x1, y1, x2, y2]
        const [x1, y1, x2, y2] = annotation.bbox;
        const bx = Math.min(x1, x2);
        const by = Math.min(y1, y2);
        const bw = Math.abs(x2 - x1);
        const bh = Math.abs(y2 - y1);
        
        // 检查八个方向的调整手柄
        const handles = [
            {name: 'nw', x: bx, y: by},
            {name: 'n', x: bx + bw / 2, y: by},
            {name: 'ne', x: bx + bw, y: by},
            {name: 'e', x: bx + bw, y: by + bh / 2},
            {name: 'se', x: bx + bw, y: by + bh},
            {name: 's', x: bx + bw / 2, y: by + bh},
            {name: 'sw', x: bx, y: by + bh},
            {name: 'w', x: bx, y: by + bh / 2}
        ];
        
        for (const handle of handles) {
            if (Math.abs(x - handle.x) <= handleSize && Math.abs(y - handle.y) <= handleSize) {
                return handle.name;
            }
        }
        
        return null;
    }

    // 调整标注大小
    function resizeAnnotation(annotation, handle, dx, dy, originalBbox) {
        if (annotation.type !== 'bbox') return;
        
        // 原始bbox为 [x1, y1, x2, y2] 格式
        const [x1_orig, y1_orig, x2_orig, y2_orig] = originalBbox ? [...originalBbox] : [...annotation.bbox];
        
        // 计算左上角和右下角
        let x1 = Math.min(x1_orig, x2_orig);
        let y1 = Math.min(y1_orig, y2_orig);
        let x2 = Math.max(x1_orig, x2_orig);
        let y2 = Math.max(y1_orig, y2_orig);
        const w = x2 - x1;
        const h = y2 - y1;
        
        switch(handle) {
            case 'nw':
                x1 = x1_orig + dx;
                y1 = y1_orig + dy;
                break;
            case 'n':
                y1 = y1_orig + dy;
                break;
            case 'ne':
                y1 = y1_orig + dy;
                x2 = x2_orig + dx;
                break;
            case 'e':
                x2 = x2_orig + dx;
                break;
            case 'se':
                x2 = x2_orig + dx;
                y2 = y2_orig + dy;
                break;
            case 's':
                y2 = y2_orig + dy;
                break;
            case 'sw':
                x1 = x1_orig + dx;
                y2 = y2_orig + dy;
                break;
            case 'w':
                x1 = x1_orig + dx;
                break;
        }
        
        // 确保右下角大于左上角
        if (x2 < x1) {
            const temp = x1;
            x1 = x2;
            x2 = temp;
        }
        if (y2 < y1) {
            const temp = y1;
            y1 = y2;
            y2 = temp;
        }
        
        // 边界检查：确保标注框在图像范围内
        const canvas = document.getElementById('main-canvas');
        const imgWidth = AppState.currentImage ? AppState.currentImage.width : canvas.width;
        const imgHeight = AppState.currentImage ? AppState.currentImage.height : canvas.height;
        
        // 确保坐标非负
        x1 = Math.max(0, x1);
        y1 = Math.max(0, y1);
        
        // 确保不超出边界
        x2 = Math.min(x2, imgWidth);
        y2 = Math.min(y2, imgHeight);
        
        // 确保最小尺寸
        if (x2 - x1 < 5) {
            x2 = x1 + 5;
        }
        if (y2 - y1 < 5) {
            y2 = y1 + 5;
        }
        
        // 保存为 [x1, y1, x2, y2] 格式
        annotation.bbox = [x1, y1, x2, y2];
    }

    // 点是否在多边形内
    function isPointInPolygon(x, y, points) {
        let inside = false;
        
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;
            
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }

    // 重新绘制画布
    window.redrawCanvas = function() {
        const canvas = document.getElementById('main-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        // 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.save();
        
        // 应用平移偏移量（如果有）
        if (CanvasState.panOffsetX !== 0 || CanvasState.panOffsetY !== 0) {
            ctx.translate(CanvasState.panOffsetX, CanvasState.panOffsetY);
        }
        
        // 绘制背景图像
        if (AppState.currentImage) {
            ctx.drawImage(AppState.currentImage, 0, 0);
        }
        
        // 绘制标注 - 不需要乘以zoom，因为使用CSS transform处理缩放
        if (AppState.annotations && AppState.annotations.length > 0) {
            AppState.annotations.forEach((ann, index) => {
                const isSelected = index === AppState.selectedAnnotation;
                const isHovered = index === AppState.hoveredAnnotation;
                drawAnnotation(ctx, ann, isSelected, isHovered);
            });
        }
        
        // 绘制临时多边形
        if (CanvasState.polygonPoints.length > 0) {
            drawTempPolygon(ctx, CanvasState.polygonPoints);
        }
        
        ctx.restore();
    };
    
    // 批量渲染包装器
    window.batchRedraw = function() {
        scheduleRender();
    };

    // 绘制标注
    function drawAnnotation(ctx, annotation, isSelected, isHovered) {
        // 使用CSS transform处理缩放，这里不再需要乘以zoom
        const scale = 1;
        
        ctx.save();
        
        // 获取标注类型，默认为 bbox
        const annType = annotation.type || 'bbox';
        
        // 获取标注颜色 - 优先使用标注自己的颜色
        let color = annotation.color || '#00ffcc';
        
        // 如果被选中或悬停，使用更亮的颜色
        if (isSelected) {
            color = '#ff6b6b';  // 选中时使用红色
        } else if (isHovered) {
            color = '#ffd93d';  // 悬停时使用黄色
        }
        
        // 根据选中状态设置不同的样式
        if (annType === 'bbox') {
            // bbox格式为 [x1, y1, x2, y2]
            const [x1, y1, x2, y2] = annotation.bbox;
            const x = Math.min(x1, x2);
            const y = Math.min(y1, y2);
            const w = Math.abs(x2 - x1);
            const h = Math.abs(y2 - y1);
            
            if (isSelected || isHovered) {
                // 选中或悬停时：显示完整样式（填充+粗边框+手柄）
                ctx.strokeStyle = color;
                ctx.fillStyle = color + '33';
                ctx.lineWidth = 2;
                ctx.fillRect(x, y, w, h);
                ctx.strokeRect(x, y, w, h);
                
                // 绘制调整手柄（仅选中时）
                if (isSelected) {
                    drawResizeHandles(ctx, x, y, w, h, scale);
                }
            } else {
                // 未选中时：仅显示精细边框线条，避免遮挡图像
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;  // 1px 细边框
                ctx.setLineDash([]);  // 实线
                ctx.strokeRect(x, y, w, h);
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
        } else if (annType === 'text' && annotation.text) {
            // 绘制文本标注
            const { x, y, text, fontSize, fontFamily, color: textColor, backgroundColor } = annotation;
            const width = annotation.width || 200;
            const height = annotation.height || 40;
            
            // 绘制背景
            ctx.fillStyle = backgroundColor || 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(x, y, width, height);
            
            // 绘制边框
            if (isSelected) {
                ctx.strokeStyle = '#00ffcc';
                ctx.lineWidth = 2;
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.lineWidth = 1;
            }
            ctx.strokeRect(x, y, width, height);
            
            // 绘制文本
            ctx.fillStyle = textColor || '#ffffff';
            ctx.font = `${fontSize || 16}px ${fontFamily || 'Arial'}`;
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x + 10, y + height / 2);
        }
        
        // 绘制标签
        if (annotation.label && isSelected) {
            const label = AppState.labels.find(l => l.id === annotation.label);
            if (label && annotation.type === 'bbox') {
                // bbox格式为 [x1, y1, x2, y2]
                const [x1, y1, x2, y2] = annotation.bbox;
                const x = Math.min(x1, x2);
                const y = Math.min(y1, y2);
                ctx.fillStyle = color;
                ctx.fillRect(x, y - 20, ctx.measureText(label.name).width + 10, 20);
                ctx.fillStyle = '#000';
                ctx.font = '12px Arial';
                ctx.fillText(label.name, x + 5, y - 5);
            }
        }
        
        // 绘制序号 - 仅在选中或悬停时显示
        if (isSelected || isHovered) {
            const idx = AppState.annotations.indexOf(annotation);
            if (annotation.type === 'bbox') {
                // bbox格式为 [x1, y1, x2, y2]
                const [x1, y1, x2, y2] = annotation.bbox;
                const x = Math.min(x1, x2);
                const y = Math.min(y1, y2);
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

    // 绘制调整手柄
    function drawResizeHandles(ctx, x, y, w, h, scale) {
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

    // 绘制临时边界框
    function drawTempBoundingBox(ctx, startX, startY, endX, endY, maintainAspect = false) {
        if (!ctx) return;
        
        ctx.save();
        ctx.strokeStyle = '#00ffcc';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        
        // 确保坐标是有效的数字
        if (isNaN(startX) || isNaN(startY) || isNaN(endX) || isNaN(endY)) {
            ctx.restore();
            return;
        }
        
        let x, y, w, h;
        
        if (maintainAspect && typeof BboxController !== 'undefined') {
            // 使用BboxController计算保持宽高比的bbox
            const bboxCtrl = new BboxController();
            const [bx, by, bw, bh] = bboxCtrl.handleAspectRatio(
                startX, startY, endX, endY, 
                Math.abs(endX - startX) || 100, // 默认宽高比
                Math.abs(endY - startY) || 100
            );
            x = bx;
            y = by;
            w = bw;
            h = bh;
        } else {
            x = Math.min(startX, endX);
            y = Math.min(startY, endY);
            w = Math.abs(endX - startX);
            h = Math.abs(endY - startY);
        }
        
        ctx.strokeRect(x, y, w, h);
        
        // 显示尺寸
        ctx.fillStyle = '#00ffcc';
        ctx.font = '12px monospace';
        ctx.fillText(`${Math.round(w)} x ${Math.round(h)}`, x, y - 5);
        
        ctx.restore();
    }

    // 绘制临时多边形
    function drawTempPolygon(ctx, points) {
        const canvas = document.getElementById('main-canvas');
        const context = canvas.getContext('2d');
        
        context.strokeStyle = '#ff00ff';
        context.fillStyle = '#ff00ff33';
        context.lineWidth = 2;
        
        if (points.length > 0) {
            context.beginPath();
            context.moveTo(points[0].x, points[0].y);
            
            for (let i = 1; i < points.length; i++) {
                context.lineTo(points[i].x, points[i].y);
            }
            
            context.closePath();
            context.fill();
            context.stroke();
            
            // 绘制顶点
            points.forEach((point, i) => {
                context.fillStyle = '#ff00ff';
                context.beginPath();
                context.arc(point.x, point.y, 4, 0, Math.PI * 2);
                context.fill();
            });
        }
    }

    // 绘制画笔笔触
    function drawBrushStroke() {
        const canvas = document.getElementById('main-canvas');
        const ctx = canvas.getContext('2d');
        
        ctx.strokeStyle = '#ff5500';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        if (CanvasState.brushPoints.length > 1) {
            ctx.beginPath();
            ctx.moveTo(CanvasState.brushPoints[0].x, CanvasState.brushPoints[0].y);
            
            for (let i = 1; i < CanvasState.brushPoints.length; i++) {
                ctx.lineTo(CanvasState.brushPoints[i].x, CanvasState.brushPoints[i].y);
            }
            
            ctx.stroke();
        }
    }

    // 初始化
    document.addEventListener('DOMContentLoaded', function() {
        setTimeout(initCanvas, 100);
        
        // 双击完成多边形
        const canvas = document.getElementById('main-canvas');
        if (canvas) {
            canvas.addEventListener('dblclick', handleDoubleClick);
        }
    });

})();
