 // ============================================
// Novisight Label - 主应用程序
// ============================================

// 全局状态
const AppState = {
    currentProject: null,
    currentTask: null,
    labels: [],
    annotations: [],
    currentTool: 'select',
    currentLabel: null,
    selectedAnnotation: null,
    hoveredAnnotation: null,
    zoom: 1,
    displayScale: 1,  // 图像适应画布的缩放比例
    history: null,    // 历史记录管理器
    layeredCanvas: null, // 分层画布实例
    keypointTool: null,   // 关键点工具实例
    textTool: null,       // 文本标注工具实例
    classificationManager: null, // 分类标注管理器
    viewControl: null,    // 视图控制实例
    bboxController: null, // Bbox微调控制器
    comparisonMode: null, // 对比模式实例
    extendedAttributes: null, // 扩展属性管理器
    annotationViewMode: 'list', // 标注视图模式: 'list' 或 'timeline'
    
    // 预刷任务状态管理
    inferenceAnnotations: [],    // 预刷标注列表
    manualAnnotations: [],       // 人工标注列表
    isUserAnnotating: false,      // 用户是否正在标注
    prefetchTaskId: null,         // 当前预刷任务ID
    prefetchRefreshInterval: null // 预刷任务轮询定时器
};

// API基础URL
const API_BASE = '';

// ============================================
// 视图切换
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    initApp();
});

function initApp() {
    // 初始化历史记录管理器
    AppState.history = new HistoryManager(50);
    
    // 初始化快捷键管理器
    initShortcuts();
    
    // 绑定导航按钮
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const view = this.dataset.view;
            saveCurrentView(view);
            switchView(view);
        });
    });

    // 绑定工具栏按钮
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', function() {
            const tool = this.dataset.tool;
            selectTool(tool);
        });
    });

    document.querySelectorAll('.tool-btn[data-action]').forEach(btn => {
        btn.addEventListener('click', function() {
            const action = this.dataset.action;
            handleAction(action);
        });
    });

    // 绑定快捷键（使用ShortcutManager）
    document.addEventListener('keydown', (e) => ShortcutManager.handleKeydown(e));

    // 加载项目列表
    loadProjects();
    
    // 恢复上次查看的视图
    restoreLastView();
    
    // 监听事件
    setupEventListeners();
}

// 初始化快捷键系统
function initShortcuts() {
    // 工具类快捷键
    ShortcutManager.register('V', () => selectTool('select'), '选择工具');
    ShortcutManager.register('R', () => selectTool('bbox'), '矩形框标注');

    ShortcutManager.register('B', () => selectTool('brush'), '画笔标注');
    ShortcutManager.register('K', () => selectTool('keypoint'), '关键点标注');
    
    // 编辑类快捷键
    ShortcutManager.register('Delete', () => handleAction('delete'), '删除选中');
    ShortcutManager.register('Ctrl+C', () => handleAction('copy'), '复制');
    ShortcutManager.register('Ctrl+V', () => handleAction('paste'), '粘贴');
    ShortcutManager.register('Ctrl+Z', () => undoAnnotation(), '撤销');
    ShortcutManager.register('Ctrl+Y', () => redoAnnotation(), '重做');
    ShortcutManager.register('Ctrl+S', () => saveAnnotations(), '保存');
    
    // 视图类快捷键
    ShortcutManager.register('+', () => handleAction('zoom-in'), '放大');
    ShortcutManager.register('=', () => handleAction('zoom-in'), '放大');
    ShortcutManager.register('-', () => handleAction('zoom-out'), '缩小');
    ShortcutManager.register('F', () => handleAction('fit'), '适应窗口');
    ShortcutManager.register('H', () => toggleVisibilityPanel(), '切换可见性面板');
    
    // 其他快捷键
    ShortcutManager.register('?', () => ShortcutManager.showHelp(), '显示快捷键帮助');
    ShortcutManager.register('Escape', () => cancelCurrentOperation(), '取消当前操作');
}

// 设置事件监听
function setupEventListeners() {
    // 历史记录变化事件
    EventBus.on('history:changed', (state) => {
        updateUndoRedoButtons(state.canUndo, state.canRedo);
    });
    
    // 可见性变化事件
    EventBus.on('visibility:changed', () => {
        if (AppState.layeredCanvas) {
            AppState.layeredCanvas.markDirty('annotations');
        }
    });
    
    // 标注变化事件
    EventBus.on('annotation:changed', () => {
        if (AppState.layeredCanvas) {
            AppState.layeredCanvas.markDirty('annotations');
        }
        renderAnnotations();
    });
    
    // 属性面板自动保存功能
    setupAttributeAutoSave();
}

// 属性面板自动保存
function setupAttributeAutoSave() {
    const attributeInputs = ['attribute-note', 'attribute-occlusion', 'attribute-truncation', 'attribute-motion'];
    
    attributeInputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            // 输入时保存属性值到标注对象
            element.addEventListener('input', function() {
                autoSaveCurrentAnnotation();
            });
            // 失去焦点时保存到后端
            element.addEventListener('change', function() {
                autoSaveCurrentAnnotation();
                saveAnnotations();
            });
        }
    });
    
    // 页面刷新/关闭前自动保存当前标注属性
    window.addEventListener('beforeunload', function() {
        if (AppState.selectedAnnotation !== null && AppState.currentTask) {
            autoSaveCurrentAnnotation();
            // 使用同步方式保存（不等待响应）
            navigator.sendBeacon(
                `${API_BASE}/api/tasks/${AppState.currentTask.id}/annotations`,
                JSON.stringify({
                    annotations: AppState.annotations,
                    status: 'annotated'
                })
            );
        }
    });
    
    // 页面可见性变化时保存（如切换标签页）
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden' && AppState.selectedAnnotation !== null) {
            autoSaveCurrentAnnotation();
            saveAnnotations();
        }
    });
}

// 更新撤销/重做按钮状态
function updateUndoRedoButtons(canUndo, canRedo) {
    const undoBtn = document.querySelector('.tool-btn[data-action="undo"]');
    const redoBtn = document.querySelector('.tool-btn[data-action="redo"]');
    
    if (undoBtn) {
        undoBtn.disabled = !canUndo;
        undoBtn.style.opacity = canUndo ? 1 : 0.5;
    }
    if (redoBtn) {
        redoBtn.disabled = !canRedo;
        redoBtn.style.opacity = canRedo ? 1 : 0.5;
    }
}

// 撤销操作
function undoAnnotation() {
    try {
        if (AppState.history && AppState.history.canUndo && AppState.history.canUndo()) {
            AppState.history.undo((annotations) => {
                AppState.annotations = annotations;
                AppState.selectedAnnotation = null;
                if (typeof redrawCanvas === 'function') redrawCanvas();
                if (typeof renderAnnotations === 'function') renderAnnotations();
            });
        }
    } catch (e) {
        console.error('撤销失败:', e);
    }
}

// 重做操作
function redoAnnotation() {
    try {
        if (AppState.history && AppState.history.canRedo && AppState.history.canRedo()) {
            AppState.history.redo((annotations) => {
                AppState.annotations = annotations;
                AppState.selectedAnnotation = null;
                if (typeof redrawCanvas === 'function') redrawCanvas();
                if (typeof renderAnnotations === 'function') renderAnnotations();
            });
        }
    } catch (e) {
        console.error('重做失败:', e);
    }
}

// 切换可见性面板
function toggleVisibilityPanel() {
    const container = document.getElementById('visibility-panel-container');
    const panel = document.getElementById('visibility-panel');
    
    if (container && panel) {
        // 检查是否已经显示
        const isVisible = container.style.display !== 'none';
        
        if (isVisible) {
            // 隐藏面板
            container.style.display = 'none';
        } else {
            // 显示面板
            container.style.display = 'block';
            
            // 初始化可见性管理器
            if (AppState.labels && AppState.labels.length > 0) {
                VisibilityManager.init(AppState.labels);
                panel.innerHTML = VisibilityManager.renderControlPanel();
            } else {
                panel.innerHTML = '<p style="color: var(--text-muted); text-align: center;">请先加载标签数据</p>';
            }
        }
    }
}

// 取消当前操作
function cancelCurrentOperation() {
    AppState.selectedAnnotation = null;
    
    // 清除关键点工具状态
    if (AppState.keypointTool) {
        AppState.keypointTool.clear();
    }
    
    redrawCanvas();
    renderAnnotations();
    
    // 隐藏模态框
    const modals = document.querySelectorAll('.modal-overlay');
    modals.forEach(modal => {
        modal.style.display = 'none';
    });
}

// 保存当前视图到 localStorage
function saveCurrentView(viewName) {
    try {
        localStorage.setItem('lastView', viewName);
    } catch (e) {
        console.warn('无法保存视图状态:', e);
    }
}

// 保存当前任务ID到 localStorage
function saveCurrentTask(taskId) {
    try {
        localStorage.setItem('lastTaskId', taskId);
    } catch (e) {
        console.warn('无法保存任务状态:', e);
    }
}

// 保存当前项目信息到 localStorage
function saveCurrentProject(project) {
    try {
        localStorage.setItem('currentProject', JSON.stringify(project));
    } catch (e) {
        console.warn('无法保存项目状态:', e);
    }
}

// 从 localStorage 恢复项目信息
function restoreCurrentProject() {
    try {
        const saved = localStorage.getItem('currentProject');
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.warn('无法恢复项目状态:', e);
    }
    return null;
}

// 保存缩放级别到 localStorage
function saveZoomLevel() {
    try {
        localStorage.setItem('zoomLevel', AppState.zoom.toString());
    } catch (e) {
        console.warn('无法保存缩放级别:', e);
    }
}

// 从 localStorage 恢复缩放级别
function restoreZoomLevel() {
    try {
        const savedZoom = localStorage.getItem('zoomLevel');
        if (savedZoom) {
            AppState.zoom = parseFloat(savedZoom);
        }
    } catch (e) {
        console.warn('无法恢复缩放级别:', e);
    }
}

// 恢复上次查看的视图
function restoreLastView() {
    try {
        const lastView = localStorage.getItem('lastView');
        
        if (lastView && ['projects', 'inference', 'workspace', 'export', 'categories'].includes(lastView)) {
            // 如果是工作区视图，先恢复项目信息
            if (lastView === 'workspace') {
                const savedProject = restoreCurrentProject();
                if (savedProject) {
                    AppState.currentProject = savedProject;
                    
                    // 更新工作区项目标题
                    const projectTitle = document.getElementById('workspace-project-title');
                    if (projectTitle) {
                        projectTitle.innerHTML = `<i class="fas fa-project-diagram"></i> <span>${savedProject.name}</span>`;
                    }
                    
                    // 切换视图，传递恢复标志
                    switchView(lastView, true);
                    return;
                }
            }
            
            switchView(lastView);
        }
    } catch (e) {
        console.warn('无法恢复视图状态:', e);
    }
}

function switchView(viewName, isRestoring = false) {
    // 离开工作区时停止预刷轮询
    if (viewName !== 'workspace') {
        stopPrefetchPolling();
    }
    
    // 更新导航按钮状态
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    
    // 显示/隐藏工作区导航按钮
    const workspaceBtn = document.querySelector('.nav-btn[data-view="workspace"]');
    if (workspaceBtn) {
        if (viewName === 'workspace') {
            workspaceBtn.classList.remove('hidden');
        } else {
            workspaceBtn.classList.add('hidden');
        }
    }
    
    // 更新视图显示
    document.querySelectorAll('.view').forEach(view => {
        view.classList.toggle('active', view.id === `${viewName}-view`);
    });
    
    // 根据视图切换导航栏样式
    const headerNav = document.querySelector('.header-nav');
    if (headerNav) {
        // 在工作区视图中隐藏导航按钮文字，只显示图标
        if (viewName === 'workspace') {
            headerNav.classList.add('compact-mode');
        } else {
            headerNav.classList.remove('compact-mode');
        }
    }
    
    // 视图特定初始化
    if (viewName === 'projects') {
        loadProjects();
    } else if (viewName === 'workspace') {
        
        if (!AppState.currentProject) {
            if (isRestoring) {
                // 恢复时项目应该已在 AppState 中
                console.warn('恢复工作区时项目信息缺失');
            }
            switchView('projects');
            showToast('请先选择一个项目', 'warning');
            return;
        }
        
        // 扫描并同步数据目录中的文件
        scanFiles(AppState.currentProject.id).then(() => {
            // 加载项目任务
            loadProjectTasks(AppState.currentProject.id);
            
            // 恢复上次选择的文件（仅在恢复模式时）
            if (isRestoring) {
                const lastTaskId = localStorage.getItem('lastTaskId_' + AppState.currentProject.id);
                if (lastTaskId) {
                    openTask(lastTaskId);
                }
            }
        });
    } else if (viewName === 'categories') {
        loadCategories();
    }
}

// 返回项目管理页面 - 保存标注后返回
async function goBackToProjects() {
    // 如果当前有任务和未保存的标注，先保存
    if (AppState.currentTask && AppState.annotations && AppState.annotations.length > 0) {
        // 显示加载状态
        showLoadingSpinner(true);
        
        try {
            // 保存当前任务的标注
            const response = await fetch(`${API_BASE}/api/tasks/${AppState.currentTask.id}/annotations`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({annotations: AppState.annotations})
            });
            
            const result = await response.json();
            
            if (!result.success) {
                showToast('保存标注失败: ' + (result.error || '未知错误'), 'error');
                showLoadingSpinner(false);
                return; // 不返回，阻止跳转
            }
            
            showToast('标注已自动保存', 'success');
        } catch (error) {
            console.error('保存标注失败:', error);
            showToast('保存标注失败，请重试', 'error');
            showLoadingSpinner(false);
            return; // 不返回，阻止跳转
        }
    }
    
    // 清除标注页面状态
    clearWorkspaceState();
    
    // 隐藏加载状态
    showLoadingSpinner(false);
    
    // 切换到项目视图
    switchView('projects');
}

// 显示/隐藏加载 spinner
function showLoadingSpinner(show) {
    let spinner = document.getElementById('loading-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'loading-spinner';
        spinner.innerHTML = '<div class="spinner"></div><p>保存中...</p>';
        spinner.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999;';
        document.body.appendChild(spinner);
    }
    spinner.style.display = show ? 'flex' : 'none';
}

// 清除工作区状态
function clearWorkspaceState() {
    // 保存当前任务ID到localStorage，以便下次进入时恢复
    if (AppState.currentTask) {
        localStorage.setItem('lastTaskId_' + AppState.currentProject?.id, AppState.currentTask.id);
    }
    
    AppState.currentTask = null;
    AppState.annotations = [];
    AppState.selectedAnnotation = null;
    
    // 清除画布
    const canvas = document.getElementById('main-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    // 清除文件列表选择
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('active');
    });
}

// ============================================
// 项目管理
// ============================================

async function loadProjects() {
    try {
        const response = await fetch(`${API_BASE}/api/projects`);
        const result = await response.json();
        
        if (result.success) {
            renderProjects(result.data);
        }
    } catch (error) {
        console.error('加载项目失败:', error);
        showToast('加载项目失败', 'error');
    }
}

function renderProjects(projects) {
    const grid = document.getElementById('projects-grid');
    const empty = document.getElementById('projects-empty');
    
    if (!projects || projects.length === 0) {
        grid.style.display = 'none';
        empty.classList.add('active');
        return;
    }
    
    grid.style.display = 'grid';
    empty.classList.remove('active');
    
    // 获取分类映射
    fetchCategoriesMap().then(categoryMap => {
        grid.innerHTML = projects.map(project => {
            // 计算标注状态
            const stats = project.task_stats || {total: 0, completed: 0, pending: 0};
            let statusText = '未开始';
            let statusClass = 'not-started';
            if (stats.total > 0) {
                if (stats.completed === stats.total) {
                    statusText = '已完成';
                    statusClass = 'completed';
                } else if (stats.completed > 0) {
                    statusText = '进行中';
                    statusClass = 'in-progress';
                }
            }
            
            // 数据类型映射
            const dataTypeMap = {
                'all': '全部',
                'image': '图像'
            };
            const dataTypeText = dataTypeMap[project.data_type] || '全部';
            
            // 分类显示
            const categoryId = project.category_id || project.category;
            const categoryName = categoryMap[categoryId] || '未分类';
            
            // AI预刷状态
            const inferenceEnabled = project.enable_inference === 1 || project.enable_inference === true;
            const targetLabels = project.target_labels ? JSON.parse(project.target_labels) : [];
            const inferenceProgress = project.inference_progress;
            
            // 预刷状态显示
            let inferenceStatus = '';
            let inferenceProgressHtml = '';
            let inferenceLogsHtml = '';
            let inferenceRetryHtml = '';
            
            if (inferenceEnabled) {
                if (inferenceProgress) {
                    const ipStatus = inferenceProgress.status;
                    const totalTasks = inferenceProgress.total_tasks || 0;
                    const completedTasks = inferenceProgress.completed_tasks || 0;
                    const failedTasks = inferenceProgress.failed_tasks || 0;
                    const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
                    const queuePosition = project.queue_position;
                    
                    // 状态徽章
                    if (ipStatus === 'completed') {
                        inferenceStatus = '<span class="inference-badge completed"><i class="fas fa-check"></i> 已完成</span>';
                        // 添加重刷按钮
                        inferenceRetryHtml = `
                        <button class="cyber-btn small retry-btn" id="project-refresh-btn-${project.id}" onclick="refreshProjectFromProjectList('${project.id}')" title="重新执行AI预刷">
                            <i class="fas fa-redo"></i>
                        </button>`;
                    } else if (ipStatus === 'processing') {
                        inferenceStatus = '<span class="inference-badge processing"><i class="fas fa-spinner fa-spin"></i> 处理中</span>';
                    } else if (ipStatus === 'failed') {
                        inferenceStatus = '<span class="inference-badge failed"><i class="fas fa-exclamation"></i> 失败</span>';
                        // 添加重试按钮
                        inferenceRetryHtml = `
                        <button class="cyber-btn small retry-btn" id="project-refresh-btn-${project.id}" onclick="refreshProjectFromProjectList('${project.id}')" title="重新执行AI预刷">
                            <i class="fas fa-redo"></i>
                        </button>`;
                    } else if (ipStatus === 'queued') {
                        inferenceStatus = `<span class="inference-badge queued"><i class="fas fa-clock"></i> 队列中${queuePosition ? ` (第${queuePosition}位)` : ''}</span>`;
                    } else {
                        inferenceStatus = '<span class="inference-badge pending"><i class="fas fa-clock"></i> 待处理</span>';
                        // 待处理状态也显示重刷按钮
                        inferenceRetryHtml = `
                        <button class="cyber-btn small retry-btn" id="project-refresh-btn-${project.id}" onclick="refreshProjectFromProjectList('${project.id}')" title="重新执行AI预刷">
                            <i class="fas fa-redo"></i>
                        </button>`;
                    }
                    
                    // 进度条和日志查看按钮
                    if (ipStatus === 'processing' || ipStatus === 'completed' || ipStatus === 'failed') {
                        inferenceProgressHtml = `
                        <div class="inference-progress-container">
                            <div class="inference-progress-bar">
                                <div class="inference-progress-fill" style="width: ${progressPercent}%"></div>
                            </div>
                            <div class="inference-progress-stats">
                                <span>${completedTasks}/${totalTasks} (${progressPercent}%)</span>
                                ${failedTasks > 0 ? `<span class="failed-count">失败: ${failedTasks}</span>` : ''}
                                ${inferenceProgress.logs ? `
                                <button class="cyber-btn small log-view-btn" onclick="showInferenceLogs('${project.id}')" title="查看详细日志">
                                    <i class="fas fa-eye"></i> 查看日志
                                </button>` : ''}
                            </div>
                        </div>`;
                    }
                } else {
                    inferenceStatus = '<span class="inference-badge enabled"><i class="fas fa-robot"></i> 已启用</span>';
                }
            } else {
                inferenceStatus = '<span class="inference-badge disabled"><i class="fas fa-robot"></i> 未启用</span>';
            }
            
            return `
            <div class="project-card hover-float">
                <div class="project-card-header">
                    <div class="project-card-icon">
                        <i class="fas fa-cube"></i>
                    </div>
                    <div class="project-card-actions">
                        <button class="action-btn start" onclick="openProject('${project.id}')" title="开始标注">
                            <i class="fas fa-play"></i>
                        </button>
                        <button class="action-btn download" onclick="showExportMenu('${project.id}', '${project.name}')" title="导出数据">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="action-btn edit" onclick="editProject('${project.id}')" title="编辑项目">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn delete" onclick="showProjectMenu('${project.id}', '${project.name}')" title="删除项目">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
                <h3 onclick="openProject('${project.id}')">${project.name}</h3>
                <p>${project.description || '暂无描述'}</p>
                <div class="project-card-stats">
                    <div class="stat-item">
                        <span class="stat-value">${categoryName}</span>
                        <span class="stat-label">分类</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${dataTypeText}</span>
                        <span class="stat-label">数据类型</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value ${statusClass}">${statusText}</span>
                        <span class="stat-label">标注状态</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value">${stats.completed}/${stats.total}</span>
                        <span class="stat-label">进度</span>
                    </div>
                </div>
                ${inferenceEnabled ? `
                <div class="project-inference-info">
                    <div class="inference-status-row">
                        <i class="fas fa-robot"></i>
                        <span>AI预刷:</span>
                        ${inferenceStatus}
                        ${inferenceRetryHtml}
                    </div>
                    ${targetLabels.length > 0 ? `
                    <div class="inference-labels-row">
                        <span class="inference-labels-list">
                            ${targetLabels.map(label => `<span class="inference-label-tag">${label}</span>`).join('')}
                        </span>
                    </div>
                    ` : ''}
                    ${inferenceProgressHtml}
                    ${inferenceLogsHtml}
                </div>
                ` : ''}
            </div>`;
        }).join('');
    }).catch(() => {
        // 如果获取分类失败，使用默认显示
        grid.innerHTML = projects.map(project => {
            const stats = project.task_stats || {total: 0, completed: 0, pending: 0};
            const dataTypeText = {'all': '全部', 'image': '图像'}[project.data_type] || '全部';
            
            return `
            <div class="project-card hover-float">
                <div class="project-card-header">
                    <div class="project-card-icon"><i class="fas fa-cube"></i></div>
                    <div class="project-card-actions">
                        <button class="action-btn start" onclick="openProject('${project.id}')"><i class="fas fa-play"></i></button>
                        <button class="action-btn download" onclick="showExportMenu('${project.id}', '${project.name}')"><i class="fas fa-download"></i></button>
                        <button class="action-btn edit" onclick="editProject('${project.id}')"><i class="fas fa-edit"></i></button>
                        <button class="action-btn delete" onclick="showProjectMenu('${project.id}', '${project.name}')"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>
                <h3 onclick="openProject('${project.id}')">${project.name}</h3>
                <p>${project.description || '暂无描述'}</p>
                <div class="project-card-stats">
                    <div class="stat-item"><span class="stat-value">未分类</span><span class="stat-label">分类</span></div>
                    <div class="stat-item"><span class="stat-value">${dataTypeText}</span><span class="stat-label">数据类型</span></div>
                    <div class="stat-item"><span class="stat-value">${stats.completed > 0 ? '进行中' : '未开始'}</span><span class="stat-label">状态</span></div>
                    <div class="stat-item"><span class="stat-value">${stats.completed}/${stats.total}</span><span class="stat-label">进度</span></div>
                </div>
            </div>`;
        }).join('');
    });
}

// 获取分类ID到名称的映射
async function fetchCategoriesMap() {
    const categoryMap = {};
    try {
        const response = await fetch(`${API_BASE}/api/categories`);
        const categories = await response.json();
        
        function addCategory(cat) {
            categoryMap[cat.id] = cat.name;
            if (cat.children) {
                cat.children.forEach(addCategory);
            }
        }
        categories.forEach(addCategory);
    } catch (e) {
        console.error('获取分类失败:', e);
    }
    return categoryMap;
}

async function openProject(projectId) {
    try {
        // 显示加载进度指示器
        showLoading('正在打开项目...');
        
        const response = await fetch(`${API_BASE}/api/projects/${projectId}`);
        const result = await response.json();
        
        if (result.success) {
            AppState.currentProject = result.data.project;
            AppState.annotations = [];
            
            // 保存项目信息到 localStorage，以便刷新页面时恢复
            saveCurrentProject(result.data.project);
            
            // 更新工作区项目标题
            const projectTitle = document.getElementById('workspace-project-title');
            if (projectTitle) {
                projectTitle.innerHTML = `<i class="fas fa-project-diagram"></i> <span>${result.data.project.name}</span>`;
            }
            
            // 扫描上传目录，导入已有文件
            await scanFiles(projectId);
            
            // 加载项目任务
            updateLoadingProgress(30, '加载任务列表...');
            const tasksResult = await loadProjectTasks(projectId);
            
            // 切换到工作区
            switchView('workspace');
            
            // 自动加载第一个任务
            if (tasksResult && tasksResult.length > 0) {
                updateLoadingProgress(60, '加载第一张图像...');
                await openTask(tasksResult[0].id);
            } else {
                // 没有任务，显示空状态
                hideLoading();
                showEmptyCanvasState();
            }
            
            hideLoading();
        }
    } catch (error) {
        console.error('打开项目失败:', error);
        hideLoading();
        showToast('打开项目失败', 'error');
    }
}

async function loadProjectTasks(projectId) {
    try {
        const response = await fetch(`${API_BASE}/api/projects/${projectId}/tasks`);
        const result = await response.json();
        
        if (result.success) {
            renderFileList(result.data);
            return result.data; // 返回任务列表供后续使用
        }
        return [];
    } catch (error) {
        console.error('加载任务失败:', error);
        return [];
    }
}

function renderFileList(tasks) {
    const list = document.getElementById('file-list');
    
    if (!tasks || tasks.length === 0) {
        list.innerHTML = '<div class="empty-state" style="height: 200px;"><p>暂无文件，请上传</p></div>';
        return;
    }
    
    list.innerHTML = tasks.map(task => `
        <div class="file-item" data-task-id="${task.id}" onclick="openTask('${task.id}')">
            <div class="file-item-icon ${task.file_type}">
                <i class="fas fa-${task.file_type === 'image' ? 'image' : 'video'}"></i>
            </div>
            <div class="file-item-info">
                <div class="file-item-name">${task.file_name}</div>
                <div class="file-item-status">${task.status}</div>
            </div>
        </div>
    `).join('');
}

/**
 * 预刷任务轮询定时器，用于监听预刷任务完成情况
 * 预刷任务执行时不影响当前标注的显示状态
 */
let prefetchPollTimer = null;

/**
 * 启动预刷任务轮询
 * 当预刷任务完成时，只提示用户而不自动更新标注
 */
function startPrefetchPolling(taskId) {
    // 如果已有轮询，先停止
    stopPrefetchPolling();
    
    AppState.prefetchTaskId = taskId;
    
    // 每5秒检查一次预刷任务状态
    prefetchPollTimer = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE}/api/tasks/${taskId}`);
            const result = await response.json();
            
            if (result.success) {
                const task = result.data.task;
                const newInferenceAnnotations = (task.annotations || []).filter(ann => ann.source === 'inference');
                
                // 检查是否有新的预刷标注
                if (newInferenceAnnotations.length > AppState.inferenceAnnotations.length) {
                    // 只有当用户不在标注状态时才提示
                    if (!AppState.isUserAnnotating) {
                        // 显示提示但不自动更新
                        showToast(`检测到新的预刷结果 (${newInferenceAnnotations.length}个)，点击刷新加载`, 'info');
                    }
                }
            }
        } catch (error) {
            console.error('预刷任务轮询失败:', error);
        }
    }, 5000);
    
    AppState.prefetchRefreshInterval = prefetchPollTimer;
}

/**
 * 停止预刷任务轮询
 */
function stopPrefetchPolling() {
    if (prefetchPollTimer) {
        clearInterval(prefetchPollTimer);
        prefetchPollTimer = null;
    }
    AppState.prefetchTaskId = null;
    AppState.prefetchRefreshInterval = null;
}

/**
 * 手动刷新预刷标注
 * 当用户点击刷新按钮时调用此函数
 */
async function refreshPrefetchAnnotations() {
    if (!AppState.currentTask) return;
    
    try {
        const taskId = AppState.currentTask.id;
        const response = await fetch(`${API_BASE}/api/tasks/${taskId}`);
        const result = await response.json();
        
        if (result.success) {
            const task = result.data.task;
            const newInferenceAnnotations = (task.annotations || []).filter(ann => ann.source === 'inference');
            
            // 检查是否有新的预刷标注
            if (newInferenceAnnotations.length > AppState.inferenceAnnotations.length) {
                // 保存当前人工标注
                const currentManualAnnotations = [...AppState.manualAnnotations];
                
                // 更新预刷标注
                AppState.inferenceAnnotations = newInferenceAnnotations;
                
                // 重新合并（保留人工标注，更新预刷）
                AppState.annotations = mergeAnnotations(AppState.inferenceAnnotations, currentManualAnnotations);
                
                // 重新渲染
                renderAnnotations();
                redrawCanvas();
                
                // 处理空状态
                if (AppState.annotations.length === 0) {
                    showNoAnnotationState();
                } else {
                    hideNoAnnotationState();
                }
                
                showToast(`已刷新预刷标注，共 ${AppState.inferenceAnnotations.length} 个`, 'success');
            } else {
                showToast('暂无新的预刷结果', 'info');
            }
        }
    } catch (error) {
        console.error('刷新预刷标注失败:', error);
        showToast('刷新预刷标注失败', 'error');
    }
}

/**
 * 打开任务
 * @param {string} taskId - 任务ID
 */
async function openTask(taskId) {
    try {
        // 显示加载进度
        showLoading('正在加载图像和标注...');
        updateLoadingProgress(10, '加载任务数据...');
        
        // 停止之前的预刷轮询
        stopPrefetchPolling();
        
        // 重置用户标注状态
        AppState.isUserAnnotating = false;
        
        // 加载任务数据（包含标注）
        const taskResponse = await fetch(`${API_BASE}/api/tasks/${taskId}`);
        const taskResult = await taskResponse.json();
        
        updateLoadingProgress(50, '处理标注数据...');
        
        if (taskResult.success) {
            AppState.currentTask = taskResult.data.task;
            
            // 保存当前任务ID到localStorage
            saveCurrentTask(taskId);
            
            // 处理标注：区分预刷和人工标注
            const allAnnotations = taskResult.data.task.annotations || [];
            
            // 分离预刷标注和人工标注
            AppState.inferenceAnnotations = allAnnotations.filter(ann => ann.source === 'inference');
            AppState.manualAnnotations = allAnnotations.filter(ann => ann.source !== 'inference');
            
            // 合并展示（去重）- 人工标注优先
            AppState.annotations = mergeAnnotations(AppState.inferenceAnnotations, AppState.manualAnnotations);
            
            updateLoadingProgress(70, '渲染标注列表...');
            
            // 更新UI
            updateFileListSelection(taskId);
            renderAnnotations();
            
            // 不显示"暂无标注"覆盖层，允许用户直接开始标注
            // 只有在没有图像时才显示空状态
            hideNoAnnotationState();
            
            updateLoadingProgress(80, '加载图像...');
            
            // 恢复缩放级别
            restoreZoomLevel();
            
            // 加载图像
            await loadMediaAsync(AppState.currentTask);
            
            updateLoadingProgress(90, '定位图像...');
            
            // 图像加载完成后，中心定位
            centerImage();
            
            // 启动预刷任务轮询
            startPrefetchPolling(taskId);
            
            // 显示预刷提示
            if (AppState.inferenceAnnotations.length > 0) {
                showToast(`已加载 ${AppState.inferenceAnnotations.length} 个预刷标注，可手动补充`, 'info');
            }
            
            // 如果没有标注，自动选择矩形框工具并显示提示
            if (AppState.annotations.length === 0) {
                // 提示用户可以开始标注，但不阻止用户操作
                showToast('请选择标注工具开始创建标注', 'info');
            }
            
            // 隐藏加载指示器
            hideLoading();
        }
    } catch (error) {
        console.error('打开任务失败:', error);
        hideLoading();
        showToast('打开任务失败', 'error');
    }
}

/**
 * 合并预刷标注和人工标注，去除重复
 * @param {Array} inferenceAnnotations - 预刷标注
 * @param {Array} manualAnnotations - 人工标注
 * @returns {Array} 合并后的标注
 */
function mergeAnnotations(inferenceAnnotations, manualAnnotations) {
    // 如果没有预刷标注，直接返回人工标注
    if (inferenceAnnotations.length === 0) {
        return manualAnnotations;
    }
    
    // 如果没有人工标注，返回预刷标注
    if (manualAnnotations.length === 0) {
        return inferenceAnnotations;
    }
    
    // 合并并去重
    const merged = [...inferenceAnnotations];
    
    for (const manual of manualAnnotations) {
        // 检查是否与已有标注重复（基于位置和标签判断）
        const isDuplicate = inferenceAnnotations.some(inference => {
            return isAnnotationDuplicate(inference, manual);
        });
        
        if (!isDuplicate) {
            merged.push(manual);
        }
    }
    
    return merged;
}

/**
 * 判断两个标注是否重复
 */
function isAnnotationDuplicate(ann1, ann2) {
    // 必须是同一种类型
    if (ann1.type !== ann2.type) return false;
    
    // 标签必须相同
    if (ann1.label !== ann2.label) return false;
    
    // 对于bbox类型，检查位置是否相近
    if (ann1.type === 'bbox' && ann2.type === 'bbox') {
        const bbox1 = ann1.bbox;
        const bbox2 = ann2.bbox;
        
        // 计算重叠区域
        const x1 = Math.max(bbox1[0], bbox2[0]);
        const y1 = Math.max(bbox1[1], bbox2[1]);
        const x2 = Math.min(bbox1[0] + bbox1[2], bbox2[0] + bbox2[2]);
        const y2 = Math.min(bbox1[1] + bbox1[3], bbox2[1] + bbox2[3]);
        
        if (x2 < x1 || y2 < y1) return false;
        
        // 计算IoU
        const overlapArea = (x2 - x1) * (y2 - y1);
        const area1 = bbox1[2] * bbox1[3];
        const area2 = bbox2[2] * bbox2[3];
        const iou = overlapArea / (area1 + area2 - overlapArea);
        
        // IoU大于0.8认为重复
        return iou > 0.8;
    }
    
    return false;
}

/**
 * 保存标注时分离预刷和人工标注
 */
function saveAnnotationsWithMerge() {
    if (!AppState.currentTask) return Promise.resolve();
    
    // 分离预刷和人工标注
    const inferenceAnnotations = AppState.annotations.filter(ann => ann.source === 'inference');
    const manualAnnotations = AppState.annotations.filter(ann => ann.source !== 'inference');
    
    // 更新AppState中的标注（保留预刷，添加人工）
    AppState.manualAnnotations = manualAnnotations;
    
    return saveAnnotations();
}

function loadMedia(task) {
    const canvas = document.getElementById('main-canvas');
    const wrapper = document.getElementById('canvas-wrapper');
    
    // 使用API端点加载文件（支持外部目录）
    const mediaUrl = `/api/files/${task.id}`;
    
    // 只处理图像类型
    if (task.file_type === 'image') {
        canvas.style.display = 'block';
        
        const img = new Image();
        img.onload = function() {
            // 保存原始图像供重绘
            AppState.currentImage = img;
            AppState.canvasWidth = img.width;
            AppState.canvasHeight = img.height;
            
            // 重置缩放级别为1
            AppState.zoom = 1;
            
            // 调用resizeCanvas来正确计算显示比例和CSS尺寸
            if (typeof resizeCanvas === 'function') {
                resizeCanvas();
            } else {
                // 如果resizeCanvas不可用，手动设置
                const rect = wrapper.getBoundingClientRect();
                const scaleX = rect.width / img.width;
                const scaleY = rect.height / img.height;
                const displayScale = Math.min(scaleX, scaleY, 1);
                
                AppState.displayScale = displayScale;
                canvas.width = img.width;
                canvas.height = img.height;
                canvas.style.width = (img.width * displayScale) + 'px';
                canvas.style.height = (img.height * displayScale) + 'px';
            }
            
            // 使用setTimeout确保canvas尺寸设置完成后再重绘
            setTimeout(function() {
                redrawCanvas();
            }, 0);
        };
        img.onerror = function() {
            console.error('图片加载失败:', mediaUrl);
            showToast('图片加载失败', 'error');
        };
        img.src = mediaUrl;
    }
}

/**
 * 异步加载媒体（图像），返回Promise
 * @param {Object} task - 任务对象
 * @returns {Promise} 图像加载完成后resolve
 */
function loadMediaAsync(task) {
    return new Promise((resolve, reject) => {
        const canvas = document.getElementById('main-canvas');
        const wrapper = document.getElementById('canvas-wrapper');
        
        // 使用API端点加载文件（支持外部目录）
        const mediaUrl = `/api/files/${task.id}`;
        
        // 只处理图像类型
        if (task.file_type === 'image') {
            canvas.style.display = 'block';
            
            const img = new Image();
            
            img.onload = function() {
                // 保存原始图像供重绘
                AppState.currentImage = img;
                AppState.canvasWidth = img.width;
                AppState.canvasHeight = img.height;
                
                // 重置缩放级别为1
                AppState.zoom = 1;
                
                // 调用resizeCanvas来正确计算显示比例和CSS尺寸
                if (typeof resizeCanvas === 'function') {
                    resizeCanvas();
                } else {
                    // 如果resizeCanvas不可用，手动设置
                    const rect = wrapper.getBoundingClientRect();
                    const scaleX = rect.width / img.width;
                    const scaleY = rect.height / img.height;
                    const displayScale = Math.min(scaleX, scaleY, 1);
                    
                    AppState.displayScale = displayScale;
                    canvas.width = img.width;
                    canvas.height = img.height;
                    canvas.style.width = (img.width * displayScale) + 'px';
                    canvas.style.height = (img.height * displayScale) + 'px';
                }
                
                // 使用setTimeout确保canvas尺寸设置完成后再重绘
                setTimeout(function() {
                    redrawCanvas();
                    resolve(); // 图像加载完成
                }, 0);
            };
            
            img.onerror = function() {
                console.error('图片加载失败:', mediaUrl);
                showToast('图片加载失败', 'error');
                reject(new Error('图片加载失败'));
            };
            
            img.src = mediaUrl;
        } else {
            resolve(); // 非图像类型直接resolve
        }
    });
}

// ============================================
// 标签管理
// ============================================

function renderLabels() {
    // 标签体系已移除，此函数保留以兼容其他调用
    // 如果需要恢复标签功能，需要重新添加标签UI到index.html
}

function selectLabel(labelId) {
    // 标签体系已移除，保留函数签名以兼容
}

// ============================================
// 标注管理
// ============================================

function renderAnnotations() {
    const list = document.getElementById('annotation-list');
    
    if (!AppState.annotations || AppState.annotations.length === 0) {
        list.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">暂无标注</p>';
        return;
    }
    
    // 根据视图模式渲染
    if (AppState.annotationViewMode === 'timeline') {
        renderAnnotationTimeline();
    } else {
        renderAnnotationList();
    }
}

/**
 * 获取属性显示文本
 */
function getAttributeBadgeText(attr, type) {
    if (!attr) return '';
    const map = {
        occlusion: { '0': '0%', '25': '25%', '50': '50%', '75': '75%', '100': '100%' },
        truncation: { '0': '0%', '25': '25%', '50': '50%', '75': '75%', '100': '100%' },
        motion: { static: '静止', moving: '运动中', started: '开始运动', stopped: '停止运动' }
    };
    return map[type]?.[attr] || '';
}

/**
 * 渲染标注列表视图
 */
function renderAnnotationList() {
    const list = document.getElementById('annotation-list');
    
    list.innerHTML = AppState.annotations.map((ann, index) => {
        // 使用标注自己的颜色，如果没有则使用默认颜色
        const color = ann.color || '#00ffcc';
        const labelName = ann.label || '未分类';
        
        // 区分预刷和人工标注
        const isInference = ann.source === 'inference';
        const sourceBadge = isInference ? 
            '<span class="source-badge inference" title="AI预刷"><i class="fas fa-robot"></i></span>' : 
            '<span class="source-badge manual" title="人工标注"><i class="fas fa-user"></i></span>';
        
        // 获取属性标签
        const occlusionText = getAttributeBadgeText(ann.occlusion, 'occlusion');
        const truncationText = getAttributeBadgeText(ann.truncation, 'truncation');
        const motionText = getAttributeBadgeText(ann.motion, 'motion');
        const attrs = [occlusionText, truncationText, motionText].filter(Boolean);
        const attrBadges = attrs.length > 0 ? `<span class="attr-badges">${attrs.map(a => `<span class="attr-badge">${a}</span>`).join('')}</span>` : '';
        
        return `
            <div class="annotation-item ${AppState.selectedAnnotation === index ? 'selected' : ''} ${isInference ? 'inference-annotation' : ''}" 
                 data-index="${index}"
                 onclick="selectAnnotation(${index})"
                 onmouseenter="highlightAnnotation(${index})"
                 onmouseleave="unhighlightAnnotation(${index})">
                <div class="annotation-index" style="background: ${color}">${index + 1}</div>
                <div class="annotation-info">
                    <div class="annotation-label" style="color: ${color}">
                        ${labelName} ${sourceBadge}
                    </div>
                    <div class="annotation-coords">
                        ${ann.type === 'bbox' ? `x1:${Math.round(ann.bbox[0])} y1:${Math.round(ann.bbox[1])} x2:${Math.round(ann.bbox[2])} y2:${Math.round(ann.bbox[3])}` : (ann.type === 'polygon' ? '多边形' : '画笔')}
                        ${isInference && ann.confidence ? ` <span class="confidence">${Math.round(ann.confidence * 100)}%</span>` : ''}
                        ${attrBadges}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 渲染标注时间线视图
 */
function renderAnnotationTimeline() {
    const list = document.getElementById('annotation-list');
    
    // 按时间戳排序（如果存在）
    const sortedAnnotations = [...AppState.annotations].sort((a, b) => {
        const timeA = a.created_at || a.timestamp || '1970-01-01';
        const timeB = b.created_at || b.timestamp || '1970-01-01';
        return new Date(timeB) - new Date(timeA); // 最新的在前面
    });
    
    // 创建索引映射
    const indexMap = sortedAnnotations.map(ann => 
        AppState.annotations.indexOf(ann)
    );
    
    list.innerHTML = sortedAnnotations.map((ann, idx) => {
        const originalIndex = indexMap[idx];
        const color = ann.color || '#00ffcc';
        const labelName = ann.label || '未分类';
        
        const isInference = ann.source === 'inference';
        
        // 格式化时间戳
        const timeStr = formatTimestamp(ann.created_at || ann.timestamp);
        
        return `
            <div class="timeline-item ${AppState.selectedAnnotation === originalIndex ? 'selected' : ''} ${isInference ? 'inference' : ''}"
                 data-index="${originalIndex}"
                 onclick="selectAnnotation(${originalIndex})"
                 onmouseenter="highlightAnnotation(${originalIndex})"
                 onmouseleave="unhighlightAnnotation(${originalIndex})">
                <div class="timeline-marker"></div>
                <div class="timeline-content">
                    <div class="timeline-label">
                        <span style="color: ${color}">${labelName}</span>
                        ${isInference ? '<span class="source-badge inference" title="AI预刷"><i class="fas fa-robot"></i></span>' : '<span class="source-badge manual" title="人工标注"><i class="fas fa-user"></i></span>'}
                    </div>
                    <div class="timeline-time">${timeStr}</div>
                    <div class="timeline-info">
                        ${ann.type === 'bbox' ? '矩形框' : (ann.type === 'polygon' ? '多边形' : '画笔')}
                        ${isInference && ann.confidence ? ` · ${Math.round(ann.confidence * 100)}% 置信度` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 格式化时间戳
 */
function formatTimestamp(timestamp) {
    if (!timestamp) return '未知时间';
    
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        // 小于1分钟
        if (diff < 60000) {
            return '刚刚';
        }
        // 小于1小时
        if (diff < 3600000) {
            return Math.floor(diff / 60000) + '分钟前';
        }
        // 小于1天
        if (diff < 86400000) {
            return Math.floor(diff / 3600000) + '小时前';
        }
        // 小于7天
        if (diff < 604800000) {
            return Math.floor(diff / 86400000) + '天前';
        }
        // 超过7天显示具体日期
        return date.toLocaleDateString('zh-CN', { 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return '未知时间';
    }
}

/**
 * 切换标注视图
 */
function switchAnnotationView(mode) {
    AppState.annotationViewMode = mode;
    
    // 更新按钮状态
    document.getElementById('view-list-btn')?.classList.toggle('active', mode === 'list');
    document.getElementById('view-timeline-btn')?.classList.toggle('active', mode === 'timeline');
    
    // 重新渲染
    renderAnnotations();
}

function selectAnnotation(index) {
    // 如果之前有选中的标注，先自动保存当前修改的属性
    if (AppState.selectedAnnotation !== null && AppState.selectedAnnotation !== index) {
        // 自动保存之前选中标注的属性
        autoSaveCurrentAnnotation();
    }
    
    AppState.selectedAnnotation = index;
    renderAnnotations();
    redrawCanvas();
    
    // 显示标注详情
    showAnnotationDetails(index);
}

// 自动保存当前标注的属性（不显示提示）
function autoSaveCurrentAnnotation() {
    if (AppState.selectedAnnotation === null) return;
    
    const ann = AppState.annotations[AppState.selectedAnnotation];
    if (!ann) return;
    
    // 保存备注
    const noteInput = document.getElementById('attribute-note');
    if (noteInput && noteInput.value) {
        ann.note = noteInput.value;
    } else if (noteInput && !noteInput.value) {
        delete ann.note;
    }
    
    // 保存遮挡程度
    const occlusionSelect = document.getElementById('attribute-occlusion');
    if (occlusionSelect && occlusionSelect.value) {
        ann.occlusion = occlusionSelect.value;
    } else {
        delete ann.occlusion;
    }
    
    // 保存截断程度
    const truncationSelect = document.getElementById('attribute-truncation');
    if (truncationSelect && truncationSelect.value) {
        ann.truncation = truncationSelect.value;
    } else {
        delete ann.truncation;
    }
    
    // 保存运动状态
    const motionSelect = document.getElementById('attribute-motion');
    if (motionSelect && motionSelect.value) {
        ann.motion = motionSelect.value;
    } else {
        delete ann.motion;
    }
}

// 高亮标注（鼠标悬停时）
function highlightAnnotation(index) {
    AppState.hoveredAnnotation = index;
    redrawCanvas();
}

// 取消高亮
function unhighlightAnnotation(index) {
    AppState.hoveredAnnotation = null;
    redrawCanvas();
}

// ============================================
// 工具选择
// ============================================

function selectTool(tool) {
    AppState.currentTool = tool;
    
    // 如果切换到关键点工具，初始化工具实例
    if (tool === 'keypoint' && typeof KeypointTool !== 'undefined') {
        if (!AppState.keypointTool) {
            AppState.keypointTool = new KeypointTool();
            // 设置人体姿态模板
            AppState.keypointTool.setSkeleton([
                [0, 1], [1, 2], [2, 3], [3, 4], // 头到左手
                [0, 5], [5, 6], [6, 7], [7, 8], // 头到左臂
                [0, 9], [9, 10], [10, 11], [11, 12], // 头到左腿
                [5, 9], [9, 13], [13, 14], [14, 15]  // 躯干
            ]);
        }
    }
    
    // 如果切换到文本工具，初始化工具实例
    if (tool === 'text' && typeof TextTool !== 'undefined') {
        if (!AppState.textTool) {
            AppState.textTool = new TextTool();
        }
        AppState.textTool.activate();
    }
    
    // 如果切换到分类工具，显示分类面板
    if (tool === 'classification' && typeof ClassificationManager !== 'undefined') {
        if (!AppState.classificationManager) {
            AppState.classificationManager = new ClassificationManager();
        }
        AppState.classificationManager.showClassificationPanel();
        // 切换回选择工具
        tool = 'select';
        AppState.currentTool = 'select';
    }
    
    // 更新工具按钮状态
    const buttons = document.querySelectorAll('.tool-btn[data-tool]');
    if (buttons) {
        buttons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    }
    
    // 更新画布光标
    const canvas = document.getElementById('main-canvas');
    if (canvas) {
        try {
            switch(tool) {
                case 'select':
                    canvas.style.cursor = 'default';
                    break;
                case 'bbox':
                case 'polygon':
                case 'keypoint':
                case 'brush':
                case 'text':
                    canvas.style.cursor = 'crosshair';
                    break;
                case 'classification':
                    canvas.style.cursor = 'pointer';
                    break;
            }
        } catch (e) {
            console.error('设置光标失败:', e);
        }
    }
    
    // 发出工具切换事件
    if (typeof EventBus !== 'undefined') {
        EventBus.emit('tool:changed', tool);
    }
}

function handleAction(action) {
    if (!action) return;
    
    switch(action) {
        case 'zoom-in':
            AppState.zoom = Math.min(AppState.zoom * 1.2, 5);
            saveZoomLevel();
            redrawCanvas();
            break;
        case 'zoom-out':
            AppState.zoom = Math.max(AppState.zoom / 1.2, 0.2);
            saveZoomLevel();
            redrawCanvas();
            break;
        case 'fit':
            AppState.zoom = 1;
            saveZoomLevel();
            redrawCanvas();
            break;
        case 'undo':
            undoAnnotation();
            break;
        case 'redo':
            redoAnnotation();
            break;
        case 'visibility':
            toggleVisibilityPanel();
            break;
        case 'delete':
            if (AppState.selectedAnnotation !== null) {
                // 保存到历史记录
                if (AppState.history && AppState.history.push) {
                    AppState.history.push(AppState.annotations);
                }
                AppState.annotations.splice(AppState.selectedAnnotation, 1);
                AppState.selectedAnnotation = null;
                if (typeof renderAnnotations === 'function') renderAnnotations();
                if (typeof redrawCanvas === 'function') redrawCanvas();
                if (typeof saveAnnotations === 'function') saveAnnotations();
            }
            break;
        case 'refresh-inference':
            // 刷新预刷标注
            refreshPrefetchAnnotations();
            break;
        case 'copy':
            if (AppState.selectedAnnotation !== null && AppState.annotations[AppState.selectedAnnotation]) {
                // 保存到历史记录
                if (AppState.history && AppState.history.push) {
                    AppState.history.push(AppState.annotations);
                }
                const ann = {...AppState.annotations[AppState.selectedAnnotation]};
                if (ann.bbox) {
                    ann.bbox = [ann.bbox[0] + 10, ann.bbox[1] + 10, ann.bbox[2], ann.bbox[3]];
                }
                AppState.annotations.push(ann);
                if (typeof renderAnnotations === 'function') renderAnnotations();
                if (typeof redrawCanvas === 'function') redrawCanvas();
                if (typeof saveAnnotations === 'function') saveAnnotations();
            }
            break;
        case 'rotate':
            // 旋转90度
            if (typeof ViewControl !== 'undefined') {
                if (!AppState.viewControl) {
                    AppState.viewControl = new ViewControl();
                }
                AppState.viewControl.rotate(90);
            }
            break;
        case 'flip-h':
            // 水平翻转
            if (typeof ViewControl !== 'undefined') {
                if (!AppState.viewControl) {
                    AppState.viewControl = new ViewControl();
                }
                AppState.viewControl.flipHorizontal();
            }
            break;
        case 'flip-v':
            // 垂直翻转
            if (typeof ViewControl !== 'undefined') {
                if (!AppState.viewControl) {
                    AppState.viewControl = new ViewControl();
                }
                AppState.viewControl.flipVertical();
            }
            break;
        case 'comparison':
            // 对比模式
            if (typeof ComparisonMode !== 'undefined') {
                if (!AppState.comparisonMode) {
                    AppState.comparisonMode = new ComparisonMode();
                    AppState.comparisonMode.createPanel();
                }
                // 切换对比模式状态
                if (AppState.comparisonMode.isActive) {
                    AppState.comparisonMode.deactivate();
                } else {
                    AppState.comparisonMode.activate('overlay');
                }
            }
            break;
    }
}

// ============================================
// 快捷键处理
// ============================================

function handleKeydown(e) {
    // 如果在输入框中，不处理快捷键
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    switch(e.key.toLowerCase()) {
        case 'v':
            selectTool('select');
            break;
        case 'r':
            selectTool('bbox');
            break;
        case 'b':
            selectTool('brush');
            break;
        case 'k':
            selectTool('keypoint');
            break;
        case 't':
            selectTool('text');
            break;
        case 'c':
            selectTool('classification');
            break;
        case 'o':
            // 旋转90度
            if (typeof ViewControl !== 'undefined') {
                if (!AppState.viewControl) {
                    AppState.viewControl = new ViewControl();
                }
                AppState.viewControl.rotate(90);
            }
            break;
        // W/A/S/D 微调 bbox 位置
        case 'w':
            if (AppState.selectedAnnotation !== null) {
                const ann = AppState.annotations[AppState.selectedAnnotation];
                if (ann && ann.type === 'bbox') {
                    if (typeof BboxController !== 'undefined') {
                        if (!AppState.bboxController) {
                            AppState.bboxController = new BboxController();
                        }
                        AppState.bboxController.fineTune(ann, 'up', e.shiftKey);
                    }
                }
            }
            break;
        case 'a':
            if (AppState.selectedAnnotation !== null) {
                const ann = AppState.annotations[AppState.selectedAnnotation];
                if (ann && ann.type === 'bbox') {
                    if (typeof BboxController !== 'undefined') {
                        if (!AppState.bboxController) {
                            AppState.bboxController = new BboxController();
                        }
                        AppState.bboxController.fineTune(ann, 'left', e.shiftKey);
                    }
                }
            }
            break;
        case 's':
            if (AppState.selectedAnnotation !== null) {
                const ann = AppState.annotations[AppState.selectedAnnotation];
                if (ann && ann.type === 'bbox') {
                    if (typeof BboxController !== 'undefined') {
                        if (!AppState.bboxController) {
                            AppState.bboxController = new BboxController();
                        }
                        AppState.bboxController.fineTune(ann, 'down', e.shiftKey);
                    }
                }
            }
            break;
        case 'd':
            if (AppState.selectedAnnotation !== null) {
                const ann = AppState.annotations[AppState.selectedAnnotation];
                if (ann && ann.type === 'bbox') {
                    if (typeof BboxController !== 'undefined') {
                        if (!AppState.bboxController) {
                            AppState.bboxController = new BboxController();
                        }
                        AppState.bboxController.fineTune(ann, 'right', e.shiftKey);
                    }
                }
            }
            break;
        case 'delete':
        case 'backspace':
            if (AppState.selectedAnnotation !== null) {
                AppState.annotations.splice(AppState.selectedAnnotation, 1);
                AppState.selectedAnnotation = null;
                renderAnnotations();
                redrawCanvas();
                saveAnnotations();
            }
            break;
        case '=':
        case '+':
            AppState.zoom = Math.min(AppState.zoom * 1.2, 5);
            saveZoomLevel();
            redrawCanvas();
            break;
        case '-':
            AppState.zoom = Math.max(AppState.zoom / 1.2, 0.2);
            saveZoomLevel();
            redrawCanvas();
            break;
        case 'f':
            AppState.zoom = 1;
            saveZoomLevel();
            redrawCanvas();
            break;
        case 's':
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                saveAnnotations();
                showToast('保存成功', 'success');
            }
            break;
    }
}

// ============================================
// 保存标注
// ============================================

async function saveAnnotations() {
    if (!AppState.currentTask) return;
    
    try {
        await fetch(`${API_BASE}/api/tasks/${AppState.currentTask.id}/annotations`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                annotations: AppState.annotations,
                status: 'annotated'
            })
        });
    } catch (error) {
        console.error('保存标注失败:', error);
    }
}

function saveAnnotation() {
    if (AppState.selectedAnnotation !== null) {
        AppState.annotations[AppState.selectedAnnotation].label = AppState.currentLabel;
        
        const note = document.getElementById('attribute-note').value;
        if (note) {
            AppState.annotations[AppState.selectedAnnotation].note = note;
        } else {
            delete AppState.annotations[AppState.selectedAnnotation].note;
        }
        
        // 保存遮挡程度
        const occlusion = document.getElementById('attribute-occlusion').value;
        if (occlusion) {
            AppState.annotations[AppState.selectedAnnotation].occlusion = occlusion;
        } else {
            delete AppState.annotations[AppState.selectedAnnotation].occlusion;
        }
        
        // 保存截断程度
        const truncation = document.getElementById('attribute-truncation').value;
        if (truncation) {
            AppState.annotations[AppState.selectedAnnotation].truncation = truncation;
        } else {
            delete AppState.annotations[AppState.selectedAnnotation].truncation;
        }
        
        // 保存运动状态
        const motion = document.getElementById('attribute-motion').value;
        if (motion) {
            AppState.annotations[AppState.selectedAnnotation].motion = motion;
        } else {
            delete AppState.annotations[AppState.selectedAnnotation].motion;
        }
        
        renderAnnotations();
        redrawCanvas();
        saveAnnotations();
        showToast('标注已更新', 'success');
    } else {
        showToast('请先选择一个标注', 'warning');
    }
}

// ============================================
// 标签选择功能 - 用于新建标注时选择类型
// ============================================

// 待创建的标注数据（临时存储）
let pendingAnnotation = null;

// 打开标签选择模态框
async function openLabelSelectModal(annotationData) {
    pendingAnnotation = annotationData;
    
    const modal = document.getElementById('label-select-modal');
    const listContainer = document.getElementById('label-select-list');
    
    // 显示加载状态
    listContainer.innerHTML = '<div class="label-select-empty"><i class="fas fa-spinner fa-spin"></i><p>加载中...</p></div>';
    modal.classList.add('active');
    
    // 获取项目标签
    try {
        const projectId = AppState.currentProject?.id;
        if (!projectId) {
            listContainer.innerHTML = '<div class="label-select-empty"><i class="fas fa-exclamation-circle"></i><p>无法获取项目信息</p></div>';
            return;
        }
        
        const response = await fetch(`${API_BASE}/api/projects/${projectId}/labels`);
        const result = await response.json();
        
        const labels = result.data || [];
        
        // 保存标签数据到全局状态，供可见性控制使用
        AppState.labels = labels;
        
        if (labels.length === 0) {
            // 如果没有标签，显示提示
            listContainer.innerHTML = `
                <div class="label-select-empty">
                    <i class="fas fa-tags"></i>
                    <p>暂无标签</p>
                    <p style="font-size: 12px; margin-top: 8px;">请先在项目中添加标签</p>
                </div>
            `;
            return;
        }
        
        // 渲染标签列表
        listContainer.innerHTML = labels.map(label => `
            <div class="label-select-item" data-label-id="${label.id}" onclick="selectLabelForAnnotation('${label.id}', '${label.name}', '${label.color || '#00ffcc'}')">
                <div class="label-select-color" style="background: ${label.color || '#00ffcc'}"></div>
                <span class="label-select-name">${label.name}</span>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('加载标签失败:', error);
        listContainer.innerHTML = '<div class="label-select-empty"><i class="fas fa-exclamation-circle"></i><p>加载标签失败</p></div>';
    }
}

// 选择标签并创建标注
function selectLabelForAnnotation(labelId, labelName, labelColor) {
    if (!pendingAnnotation) return;
    
    // 保存到历史记录
    if (AppState.history) {
        AppState.history.push(AppState.annotations);
    }
    
    // 创建标注对象
    const annotation = {
        ...pendingAnnotation,
        label: labelName,
        labelId: labelId,
        color: labelColor,
        note: ''
    };
    
    // 添加到标注列表
    AppState.annotations.push(annotation);
    AppState.selectedAnnotation = AppState.annotations.length - 1;
    
    // 关闭模态框
    closeLabelSelectModal();
    
    // 更新UI
    renderAnnotations();
    redrawCanvas();
    saveAnnotations();
    
    // 发出标注变化事件
    EventBus.emit('annotation:changed', AppState.annotations);
    
    // 显示标注详情
    showAnnotationDetails(AppState.selectedAnnotation);
}

// 关闭标签选择模态框
function closeLabelSelectModal() {
    const modal = document.getElementById('label-select-modal');
    modal.classList.remove('active');
    pendingAnnotation = null;
}

// 显示标注详情（点击标注列表时）
function showAnnotationDetails(index) {
    if (index === null || index < 0) return;
    
    const annotation = AppState.annotations[index];
    if (!annotation) return;
    
    // 更新备注输入框
    const noteInput = document.getElementById('attribute-note');
    if (noteInput) {
        noteInput.value = annotation.note || '';
    }
    
    // 更新遮挡程度
    const occlusionSelect = document.getElementById('attribute-occlusion');
    if (occlusionSelect) {
        occlusionSelect.value = annotation.occlusion !== undefined ? annotation.occlusion : '';
    }
    
    // 更新截断程度
    const truncationSelect = document.getElementById('attribute-truncation');
    if (truncationSelect) {
        truncationSelect.value = annotation.truncation !== undefined ? annotation.truncation : '';
    }
    
    // 更新运动状态
    const motionSelect = document.getElementById('attribute-motion');
    if (motionSelect) {
        motionSelect.value = annotation.motion !== undefined ? annotation.motion : '';
    }
}

// ============================================
// 弹窗管理
// ============================================

function showCreateProjectModal() {
    // 重置表单
    document.getElementById('project-name').value = '';
    document.getElementById('project-description').value = '';
    document.getElementById('project-category').value = '';
    document.getElementById('project-data-dir').value = '';
    document.getElementById('project-data-type').value = 'all';
    
    // 重置文件输入
    const fileInput = document.getElementById('project-dir-input');
    if (fileInput) {
        fileInput.value = '';
    }
    
    // 加载分类列表
    loadProjectCategories();
    
    document.getElementById('create-project-modal').classList.add('active');
}

async function loadProjectCategories() {
    const select = document.getElementById('project-category');
    const editSelect = document.getElementById('edit-project-category');
    
    // 初始化下拉框
    if (select) select.innerHTML = '<option value="">请选择分类...</option>';
    if (editSelect) editSelect.innerHTML = '<option value="">请选择分类...</option>';
    
    try {
        const response = await fetch(`${API_BASE}/api/categories`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const categories = await response.json();
        
        if (categories && Array.isArray(categories)) {
            const populateSelect = (sel) => {
                if (!sel) return;
                categories.forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat.id;
                    option.textContent = cat.name;
                    sel.appendChild(option);
                });
            };
            
            populateSelect(select);
            populateSelect(editSelect);
        }
    } catch (error) {
        console.error('加载分类失败:', error);
    }
}

function showCreateLabelModal() {
    document.getElementById('create-label-modal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ============================================
// 创建项目
// ============================================

async function createProject() {
    const name = document.getElementById('project-name').value.trim();
    const description = document.getElementById('project-description').value.trim();
    const categoryId = document.getElementById('project-category').value;
    const dataDir = document.getElementById('project-data-dir').value.trim();
    const dataType = document.getElementById('project-data-type').value;
    
    // 预刷选项
    const enableInference = document.getElementById('project-enable-inference')?.checked || false;
    const targetLabels = enableInference ? getSelectedInferenceLabels() : [];
    
    if (!name) {
        showToast('请输入项目名称', 'warning');
        return;
    }
    
    if (!dataDir) {
        showToast('请选择数据目录', 'warning');
        return;
    }
    
    if (enableInference && targetLabels.length === 0) {
        showToast('请选择预刷目标分类', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/projects`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                name,
                description,
                category_id: categoryId || null,
                data_dir: dataDir,
                data_type: dataType,
                enable_inference: enableInference,
                target_labels: targetLabels
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            const imported = result.data.imported_count || 0;
            const projectId = result.data.id;
            
            if (result.data.inference_enabled) {
                showToast(`项目创建成功，已导入 ${imported} 个文件，AI预刷已启动`, 'success');
                
                // 自动启动预刷任务
                startInferenceForProject(projectId, targetLabels);
            } else {
                showToast(imported > 0 ? `项目创建成功，已导入 ${imported} 个文件` : '项目创建成功', 'success');
            }
            
            closeModal('create-project-modal');
            loadProjects();
            
            // 清空表单
            document.getElementById('project-name').value = '';
            document.getElementById('project-description').value = '';
            document.getElementById('project-data-dir').value = '';
            document.getElementById('project-enable-inference').checked = false;
            document.getElementById('inference-labels-group').style.display = 'none';
        }
    } catch (error) {
        console.error('创建项目失败:', error);
        showToast('创建项目失败', 'error');
    }
}

// 自动启动项目的预刷任务
async function startInferenceForProject(projectId, targetLabels) {
    try {
        const response = await fetch(`${API_BASE}/api/projects/${projectId}/inference/start`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                target_labels: targetLabels
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log(`预刷任务已启动: ${projectId}`, result.data);
            // 刷新项目列表以显示预刷状态
            loadProjects();
        } else {
            console.error('启动预刷任务失败:', result.error);
        }
    } catch (error) {
        console.error('启动预刷任务失败:', error);
    }
}

// 编辑项目 - 显示编辑弹窗
async function editProject(projectId) {
    // 先加载分类列表，等待完成后再设置选中值
    await loadProjectCategories();
    
    fetch(`${API_BASE}/api/projects/${projectId}`)
        .then(res => res.json())
        .then(result => {
            if (result.success) {
                const project = result.data.project;
                document.getElementById('edit-project-id').value = project.id;
                document.getElementById('edit-project-name').value = project.name;
                document.getElementById('edit-project-description').value = project.description || '';
                document.getElementById('edit-project-category').value = project.category_id || '';
                document.getElementById('edit-project-data-type').value = project.data_type || 'all';
                document.getElementById('edit-project-data-dir').value = project.data_dir || '';
                
                // AI预刷配置
                const inferenceEnabled = project.enable_inference === 1 || project.enable_inference === true;
                document.getElementById('edit-project-enable-inference').checked = inferenceEnabled;
                document.getElementById('edit-inference-labels-group').style.display = inferenceEnabled ? 'block' : 'none';
                
                // 加载目标标签
                if (inferenceEnabled && project.category_id) {
                    loadEditInferenceLabels(project.category_id, project.target_labels);
                }
                
                document.getElementById('edit-project-modal').classList.add('active');
            }
        })
        .catch(error => {
            console.error('获取项目信息失败:', error);
            showToast('获取项目信息失败', 'error');
        });
}

// 加载编辑项目的预刷标签
async function loadEditInferenceLabels(categoryId, targetLabelsJson) {
    const labelsContainer = document.getElementById('edit-project-inference-labels');
    if (!labelsContainer || !categoryId) return;
    
    try {
        const response = await fetch(`/api/categories/${categoryId}/labels`);
        const labels = await response.json();
        
        let targetLabels = [];
        try {
            targetLabels = targetLabelsJson ? JSON.parse(targetLabelsJson) : [];
        } catch (e) {
            targetLabels = [];
        }
        
        if (Array.isArray(labels) && labels.length > 0) {
            // 使用checkbox方式渲染，每个checkbox独立
            labelsContainer.innerHTML = labels.map(label => {
                const isSelected = targetLabels.includes(label.name);
                return `<label class="inference-label-item ${isSelected ? 'selected' : ''}">
                    <input type="checkbox" value="${label.name}" ${isSelected ? 'checked' : ''} style="display: none;">
                    <span class="label-text">${label.name}</span>
                </label>`;
            }).join('');
            
            // 为每个label添加点击事件来切换样式
            labelsContainer.querySelectorAll('.inference-label-item').forEach(item => {
                item.addEventListener('click', function(e) {
                    // 防止重复触发
                    e.stopPropagation();
                    const checkbox = this.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        this.classList.toggle('selected', checkbox.checked);
                    }
                });
            });
        } else {
            labelsContainer.innerHTML = '<p class="empty-hint">该分类下没有子分类</p>';
        }
    } catch (error) {
        console.error('加载标签失败:', error);
    }
}

// 获取编辑项目选中的标签
function getEditSelectedLabels() {
    const labelsContainer = document.getElementById('edit-project-inference-labels');
    if (!labelsContainer) return [];
    
    // 查找所有被选中的checkbox
    const checkboxes = labelsContainer.querySelectorAll('input[type="checkbox"]:checked');
    if (checkboxes.length > 0) {
        return Array.from(checkboxes).map(cb => cb.value);
    }
    
    // 查找所有带有selected类的元素（兼容旧方式）
    const selectedLabels = labelsContainer.querySelectorAll('.inference-label-item.selected');
    if (selectedLabels.length > 0) {
        return Array.from(selectedLabels).map(el => el.dataset.value || el.querySelector('.label-text')?.textContent);
    }
    
    return [];
}

// 更新项目
async function updateProject() {
    const projectId = document.getElementById('edit-project-id').value;
    const name = document.getElementById('edit-project-name').value.trim();
    const description = document.getElementById('edit-project-description').value.trim();
    const category = document.getElementById('edit-project-category').value;
    const dataType = document.getElementById('edit-project-data-type').value;
    const dataDir = document.getElementById('edit-project-data-dir').value.trim();
    
    // AI预刷配置
    const enableInference = document.getElementById('edit-project-enable-inference')?.checked || false;
    const targetLabels = enableInference ? getEditSelectedLabels() : [];
    
    if (!name) {
        showToast('请输入项目名称', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                name, 
                description, 
                category_id: category, 
                data_type: dataType, 
                data_dir: dataDir,
                enable_inference: enableInference,
                target_labels: targetLabels
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            const imported = result.data.imported_count || 0;
            showToast(imported > 0 ? `项目已更新，导入了 ${imported} 个新文件` : '项目已更新', 'success');
            closeModal('edit-project-modal');
            loadProjects();
        }
    } catch (error) {
        console.error('更新项目失败:', error);
        showToast('更新项目失败', 'error');
    }
}

// ============================================
// 创建标签
// ============================================

async function createLabel() {
    // 标签体系已移除，此功能已禁用
    showToast('标签功能已移除', 'warning');
}

async function deleteLabel(labelId) {
    // 标签体系已移除，此功能已禁用
}

// ============================================
// 工具函数
// ============================================

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN');
}

function updateFileListSelection(taskId) {
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.toggle('active', item.dataset.taskId === taskId);
    });
}

// ============================================
// 加载进度指示器
// ============================================

/**
 * 显示加载进度指示器
 * @param {string} text - 加载提示文本
 */
function showLoading(text = '加载中...') {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const progressBar = document.getElementById('progress-bar');
    
    if (overlay) {
        overlay.style.display = 'flex';
    }
    
    if (loadingText) {
        loadingText.textContent = text;
    }
    
    if (progressBar) {
        progressBar.style.width = '0%';
    }
    
    // 隐藏空状态
    hideEmptyCanvasState();
    hideNoAnnotationState();
}

/**
 * 更新加载进度
 * @param {number} percent - 进度百分比 (0-100)
 * @param {string} text - 加载提示文本
 */
function updateLoadingProgress(percent, text) {
    const loadingText = document.getElementById('loading-text');
    const progressBar = document.getElementById('progress-bar');
    
    if (loadingText && text) {
        loadingText.textContent = text;
    }
    
    if (progressBar) {
        progressBar.style.width = percent + '%';
    }
}

/**
 * 隐藏加载进度指示器
 */
function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

/**
 * 显示空画布状态（没有图像）
 */
function showEmptyCanvasState() {
    const emptyState = document.getElementById('empty-canvas-state');
    const noAnnotationState = document.getElementById('no-annotation-state');
    
    if (emptyState) {
        emptyState.style.display = 'flex';
    }
    
    if (noAnnotationState) {
        noAnnotationState.style.display = 'none';
    }
}

/**
 * 隐藏空画布状态
 */
function hideEmptyCanvasState() {
    const emptyState = document.getElementById('empty-canvas-state');
    if (emptyState) {
        emptyState.style.display = 'none';
    }
}

/**
 * 显示无标注状态
 */
function showNoAnnotationState() {
    const noAnnotationState = document.getElementById('no-annotation-state');
    if (noAnnotationState) {
        noAnnotationState.style.display = 'flex';
    }
}

/**
 * 隐藏无标注状态
 */
function hideNoAnnotationState() {
    const noAnnotationState = document.getElementById('no-annotation-state');
    if (noAnnotationState) {
        noAnnotationState.style.display = 'none';
    }
}

/**
 * 中心定位图像
 */
function centerImage() {
    const wrapper = document.getElementById('canvas-wrapper');
    const canvas = document.getElementById('main-canvas');
    
    if (!wrapper || !canvas) return;
    
    // 重置视图控制器的平移状态
    if (AppState.viewControl) {
        AppState.viewControl.panX = 0;
        AppState.viewControl.panY = 0;
        AppState.viewControl.applyTransform();
    }
    
    // 重新调整画布大小以确保居中
    if (typeof resizeCanvas === 'function') {
        resizeCanvas();
    }
    
    // 触发重绘
    setTimeout(function() {
        redrawCanvas();
    }, 10);
}

function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = {
        'success': 'fa-check-circle',
        'error': 'fa-times-circle',
        'warning': 'fa-exclamation-triangle'
    }[type] || 'fa-info-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// 分类管理
// ============================================

let categoriesData = [];
let selectedCategory = null;
let categoryToDelete = null;

async function loadCategories() {
    try {
        const response = await fetch(`${API_BASE}/api/categories`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const categories = await response.json();
        
        categoriesData = categories || [];
        renderCategoryTree(categoriesData);
    } catch (error) {
        console.error('加载分类失败:', error);
        showToast('加载分类失败', 'error');
        // 显示空状态
        const container = document.getElementById('category-tree');
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h3>加载失败</h3>
                    <p>无法加载分类数据，请刷新页面重试</p>
                </div>
            `;
        }
    }
}

function renderCategoryTree(categories, container = null) {
    if (!container) {
        container = document.getElementById('category-tree');
    }
    
    // 容器不存在则返回
    if (!container) {
        console.error('分类树容器不存在');
        return;
    }
    
    if (!categories || categories.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <i class="fas fa-folder-plus"></i>
                </div>
                <h3>暂无分类</h3>
                <p>点击上方按钮添加一级分类</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = categories.map(cat => renderCategoryNode(cat)).join('');
    
    // 绑定事件
    container.querySelectorAll('.tree-node-header').forEach(header => {
        header.addEventListener('click', function(e) {
            if (e.target.closest('.tree-node-actions')) return;
            const categoryId = this.dataset.id;
            selectCategory(categoryId);
        });
        
        header.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            const categoryId = this.dataset.id;
            showCategoryContextMenu(e, categoryId);
        });
    });
    
    // 绑定展开/折叠事件
    container.querySelectorAll('.tree-node-toggle').forEach(toggle => {
        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            const node = this.closest('.tree-node');
            const children = node.querySelector('.tree-children');
            if (children) {
                children.classList.toggle('collapsed');
                this.classList.toggle('expanded');
            }
        });
    });
}

function renderCategoryNode(category) {
    // 安全检查：确保分类数据有效
    if (!category || !category.id) {
        return '';
    }
    
    const hasChildren = category.children && category.children.length > 0;
    const iconClass = getIconClass(category.icon);
    const safeColor = category.color || '#3498db';
    const safeName = category.name || '未命名分类';
    const safeId = category.id;
    
    return `
        <div class="tree-node" data-id="${safeId}">
            <div class="tree-node-header" data-id="${safeId}">
                <span class="tree-node-toggle ${hasChildren ? 'expanded' : 'hidden'}">
                    <i class="fas fa-chevron-right"></i>
                </span>
                <span class="tree-node-color" style="background: ${safeColor}"></span>
                <span class="tree-node-icon"><i class="fas ${iconClass}"></i></span>
                <span class="tree-node-name">${safeName}</span>
                <div class="tree-node-actions">
                    <button class="tree-node-action" onclick="event.stopPropagation(); addSubCategory('${safeId}', '${safeName.replace(/'/g, "\\'")}')" title="添加子分类">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button class="tree-node-action" onclick="event.stopPropagation(); editCategory('${safeId}')" title="编辑分类">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="tree-node-action danger" onclick="event.stopPropagation(); showDeleteCategory('${safeId}', '${safeName.replace(/'/g, "\\'")}')" title="删除分类">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
            ${hasChildren ? `
                <div class="tree-children">
                    ${category.children.map(child => renderCategoryNode(child)).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

function getIconClass(iconName) {
    const iconMap = {
        'folder': 'fa-folder',
        'folder-open': 'fa-folder-open',
        'tag': 'fa-tag',
        'box': 'fa-box',
        'cube': 'fa-cube',
        'layer-group': 'fa-layer-group',
        'shapes': 'fa-shapes',
        'image': 'fa-image'
    };
    return iconMap[iconName] || 'fa-folder';
}

function selectCategory(categoryId) {
    // 取消之前的选择
    document.querySelectorAll('.tree-node-header').forEach(header => {
        header.classList.remove('selected');
    });
    
    // 选中当前分类
    const header = document.querySelector(`.tree-node-header[data-id="${categoryId}"]`);
    if (header) {
        header.classList.add('selected');
    }
    
    // 查找分类数据
    selectedCategory = findCategoryById(categoriesData, categoryId);
    showCategoryDetail(selectedCategory);
}

function findCategoryById(categories, id) {
    for (const cat of categories) {
        if (cat.id === id) return cat;
        if (cat.children && cat.children.length > 0) {
            const found = findCategoryById(cat.children, id);
            if (found) return found;
        }
    }
    return null;
}

function showCategoryDetail(category) {
    const panel = document.getElementById('category-detail-panel');
    
    if (!category) {
        panel.innerHTML = `
            <div class="detail-empty">
                <div class="empty-icon"><i class="fas fa-folder-tree"></i></div>
                <h3>选择分类查看详情</h3>
                <p>点击左侧分类树中的分类查看或编辑详情</p>
            </div>
        `;
        return;
    }
    
    const iconClass = getIconClass(category.icon);
    const childCount = category.children ? category.children.length : 0;
    
    panel.innerHTML = `
        <div class="category-detail">
            <div class="detail-header">
                <div class="detail-color" style="background: ${category.color}">
                    <i class="fas ${iconClass}"></i>
                </div>
                <div class="detail-info">
                    <h2>${category.name}</h2>
                    ${category.parent_id ? '<span class="parent-label">二级分类</span>' : '<span class="parent-label">一级分类</span>'}
                </div>
                <div class="detail-actions">
                    <button class="cyber-btn small" onclick="editCategory('${category.id}')">
                        <i class="fas fa-edit"></i> 编辑
                    </button>
                    <button class="cyber-btn small danger" onclick="showDeleteCategory('${category.id}', '${category.name}')">
                        <i class="fas fa-trash-alt"></i> 删除
                    </button>
                </div>
            </div>
            
            <div class="detail-section">
                <h4>描述</h4>
                <p>${category.description || '暂无描述'}</p>
            </div>
            
            <div class="detail-section">
                <h4>统计信息</h4>
                <div class="detail-stats">
                    <div class="detail-stat">
                        <div class="detail-stat-value">${childCount}</div>
                        <div class="detail-stat-label">子分类数量</div>
                    </div>
                    <div class="detail-stat">
                        <div class="detail-stat-value">${category.sort_order || 0}</div>
                        <div class="detail-stat-label">排序权重</div>
                    </div>
                </div>
            </div>
            
            <div class="detail-section">
                <h4>创建信息</h4>
                <p style="color: var(--text-muted); font-size: 13px;">
                    创建时间: ${formatDate(category.created_at)}<br>
                    更新时间: ${formatDate(category.updated_at)}
                </p>
            </div>
        </div>
    `;
}

function showCreateCategoryModal(parentId = null, parentName = null) {
    const modal = document.getElementById('category-modal');
    const title = document.getElementById('category-modal-title');
    const parentGroup = document.getElementById('parent-category-group');
    const parentNameInput = document.getElementById('category-parent-name');
    
    // 重置表单
    document.getElementById('category-id').value = '';
    document.getElementById('category-parent-id').value = parentId || '';
    document.getElementById('category-name').value = '';
    document.getElementById('category-description').value = '';
    document.getElementById('category-color').value = '#3498db';
    document.getElementById('category-icon').value = 'folder';
    
    // 更新标题和父级信息
    if (parentId) {
        title.innerHTML = '<i class="fas fa-plus"></i> 添加二级分类';
        parentGroup.style.display = 'block';
        parentNameInput.value = parentName;
    } else {
        title.innerHTML = '<i class="fas fa-plus"></i> 添加一级分类';
        parentGroup.style.display = 'none';
    }
    
    modal.classList.add('active');
}

function addSubCategory(parentId, parentName) {
    showCreateCategoryModal(parentId, parentName);
}

function editCategory(categoryId) {
    const category = findCategoryById(categoriesData, categoryId);
    if (!category) {
        showToast('找不到分类', 'error');
        return;
    }
    
    const modal = document.getElementById('category-modal');
    const title = document.getElementById('category-modal-title');
    const parentGroup = document.getElementById('parent-category-group');
    
    // 填充表单 - 添加安全检查
    document.getElementById('category-id').value = category.id || '';
    document.getElementById('category-parent-id').value = category.parent_id || '';
    document.getElementById('category-name').value = category.name || '';
    document.getElementById('category-description').value = category.description || '';
    document.getElementById('category-color').value = category.color || '#3498db';
    document.getElementById('category-icon').value = category.icon || 'folder';
    
    // 更新标题
    title.innerHTML = '<i class="fas fa-edit"></i> 编辑分类';
    parentGroup.style.display = 'none';
    
    modal.classList.add('active');
}

async function saveCategory() {
    const id = document.getElementById('category-id').value;
    const parentId = document.getElementById('category-parent-id').value;
    const name = document.getElementById('category-name').value.trim();
    const description = document.getElementById('category-description').value.trim();
    let color = document.getElementById('category-color').value;
    let icon = document.getElementById('category-icon').value.trim();
    
    // 确保颜色和图标有默认值
    if (!color) color = '#3498db';
    if (!icon) icon = 'folder';
    
    if (!name) {
        showToast('请输入分类名称', 'warning');
        return;
    }
    
    const data = {
        name,
        description,
        color,
        icon
    };
    
    if (parentId) {
        data.parent_id = parentId;
    }
    
    try {
        let url = `${API_BASE}/api/categories`;
        let method = 'POST';
        
        if (id) {
            url = `${API_BASE}/api/categories/${id}`;
            method = 'PUT';
        }
        
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast(id ? '分类更新成功' : '分类创建成功', 'success');
            closeModal('category-modal');
            loadCategories();
        } else {
            showToast(result.error || '操作失败', 'error');
        }
    } catch (error) {
        console.error('保存分类失败:', error);
        showToast('保存分类失败', 'error');
    }
}

function showDeleteCategory(categoryId, categoryName) {
    categoryToDelete = { id: categoryId, name: categoryName };
    
    document.getElementById('delete-category-name').textContent = categoryName;
    document.getElementById('delete-warning-text').textContent = '';
    
    document.getElementById('category-delete-modal').classList.add('active');
}

async function confirmDeleteCategory() {
    if (!categoryToDelete) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/categories/${categoryToDelete.id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast('分类删除成功', 'success');
            closeModal('category-delete-modal');
            categoryToDelete = null;
            selectedCategory = null;
            loadCategories();
            
            // 清空详情面板
            document.getElementById('category-detail-panel').innerHTML = `
                <div class="detail-empty">
                    <div class="empty-icon"><i class="fas fa-folder-tree"></i></div>
                    <h3>选择分类查看详情</h3>
                    <p>点击左侧分类树中的分类查看或编辑详情</p>
                </div>
            `;
        } else {
            showToast(result.error || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除分类失败:', error);
        showToast('删除分类失败', 'error');
    }
}

function searchCategories() {
    const searchText = document.getElementById('category-search').value.toLowerCase();
    
    if (!searchText) {
        renderCategoryTree(categoriesData);
        return;
    }
    
    // 过滤分类
    const filtered = categoriesData.filter(cat => {
        return cat.name.toLowerCase().includes(searchText) || 
               (cat.description && cat.description.toLowerCase().includes(searchText)) ||
               (cat.children && cat.children.some(child => 
                   child.name.toLowerCase().includes(searchText) ||
                   (child.description && child.description.toLowerCase().includes(searchText))
               ));
    });
    
    renderCategoryTree(filtered);
}

function showCategoryContextMenu(e, categoryId) {
    // 移除已存在的菜单
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) existingMenu.remove();
    
    const category = findCategoryById(categoriesData, categoryId);
    if (!category) return;
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;
    
    menu.innerHTML = `
        <div class="context-menu-item" onclick="addSubCategory('${category.id}', '${category.name}'); removeContextMenu()">
            <i class="fas fa-plus"></i>
            <span>添加子分类</span>
        </div>
        <div class="context-menu-item" onclick="editCategory('${category.id}'); removeContextMenu()">
            <i class="fas fa-edit"></i>
            <span>编辑分类</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item danger" onclick="showDeleteCategory('${category.id}', '${category.name}'); removeContextMenu()">
            <i class="fas fa-trash-alt"></i>
            <span>删除分类</span>
        </div>
    `;
    
    document.body.appendChild(menu);
    
    // 点击其他地方关闭菜单
    setTimeout(() => {
        document.addEventListener('click', removeContextMenu);
    }, 0);
}

function removeContextMenu() {
    const menu = document.querySelector('.context-menu');
    if (menu) menu.remove();
    document.removeEventListener('click', removeContextMenu);
}

// 颜色和图标选择器事件
document.addEventListener('DOMContentLoaded', function() {
    // 颜色预设点击事件
    document.querySelectorAll('.color-preset').forEach(preset => {
        preset.addEventListener('click', function() {
            const color = this.dataset.color;
            document.getElementById('category-color').value = color;
        });
    });
    
    // 图标预设点击事件
    document.querySelectorAll('.icon-preset').forEach(preset => {
        preset.addEventListener('click', function() {
            const icon = this.dataset.icon;
            document.getElementById('category-icon').value = icon;
            document.querySelectorAll('.icon-preset').forEach(p => p.classList.remove('selected'));
            this.classList.add('selected');
        });
    });
});

// 项目菜单 - 显示自定义删除确认弹窗
let projectToDelete = null;

function showProjectMenu(projectId, projectName) {
    projectToDelete = { id: projectId, name: projectName };
    
    // 更新弹窗内容
    document.querySelector('.delete-message').textContent = `确定要删除项目「${projectName}」吗？`;
    
    // 显示弹窗
    document.getElementById('delete-confirm-modal').classList.add('active');
}

// 确认删除项目
async function confirmDeleteProject() {
    if (!projectToDelete) return;
    
    try {
        const response = await fetch(`${API_BASE}/api/projects/${projectToDelete.id}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('项目已删除', 'success');
            closeModal('delete-confirm-modal');
            loadProjects();
        }
    } catch (error) {
        console.error('删除项目失败:', error);
        showToast('删除失败', 'error');
    }
    
    projectToDelete = null;
}

// 显示导出格式选择菜单
function showExportMenu(projectId, projectName) {
    // 创建导出格式选择弹窗
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'export-format-modal';
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3><i class="fas fa-download"></i> 导出数据</h3>
                <button class="modal-close" onclick="closeExportModal()"><span>&times;</span></button>
            </div>
            <div class="modal-body">
                <p>选择导出格式：</p>
                <div class="export-format-options">
                    <div class="export-format-option" onclick="exportProjectData('${projectId}', '${projectName}', 'json')">
                        <i class="fas fa-file-code"></i>
                        <span>JSON</span>
                        <small>通用JSON格式，保留完整标注信息</small>
                    </div>
                    <div class="export-format-option" onclick="exportProjectData('${projectId}', '${projectName}', 'coco')">
                        <i class="fas fa-database"></i>
                        <span>COCO</span>
                        <small>COCO数据集格式，适合目标检测</small>
                    </div>
                    <div class="export-format-option" onclick="exportProjectData('${projectId}', '${projectName}', 'voc')">
                        <i class="fas fa-file-alt"></i>
                        <span>VOC</span>
                        <small>Pascal VOC格式，XML文件</small>
                    </div>
                    <div class="export-format-option" onclick="exportProjectData('${projectId}', '${projectName}', 'csv')">
                        <i class="fas fa-table"></i>
                        <span>CSV</span>
                        <small>逗号分隔值表格格式</small>
                    </div>
                    <div class="export-format-option" onclick="exportProjectData('${projectId}', '${projectName}', 'yolo')">
                        <i class="fas fa-robot"></i>
                        <span>YOLO</span>
                        <small>YOLO目标检测训练格式</small>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// 关闭导出弹窗
function closeExportModal() {
    const modal = document.getElementById('export-format-modal');
    if (modal) {
        modal.remove();
    }
}

// 导出项目数据
async function exportProjectData(projectId, projectName, format) {
    try {
        showToast('正在导出数据...', 'info');
        
        const exportUrl = `${API_BASE}/api/export/${projectId}/${format}`;
        
        // 直接下载，不解析JSON响应
        const link = document.createElement('a');
        link.href = exportUrl;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        closeExportModal();
        showToast('导出成功', 'success');
        
    } catch (error) {
        console.error('导出失败:', error);
        showToast('导出失败: ' + error.message, 'error');
    }
}

// 扫描上传目录，导入已有文件
async function scanFiles(projectId) {
    try {
        const response = await fetch(`${API_BASE}/api/projects/${projectId}/tasks/scan`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (result.success) {
            const imported = result.data.imported_count || 0;
            const removed = result.data.removed_count || 0;
            if (imported > 0 || removed > 0) {
                showToast(`已同步: 新增 ${imported} 个, 删除 ${removed} 个文件`, 'success');
            }
            return true;
        }
        return false;
    } catch (error) {
        console.error('扫描文件失败:', error);
        return false;
    }
}

// 扫描并重新加载文件列表
async function scanAndReload() {
    if (!AppState.currentProject) return;
    
    await scanFiles(AppState.currentProject.id);
    await loadProjectTasks(AppState.currentProject.id);
}

// 选择数据目录（创建项目时）
function selectDataDirectory() {
    // 由于浏览器安全限制，无法直接访问本地文件系统
    // 使用prompt让用户输入目录路径
    const dirPath = prompt('请输入数据目录完整路径（如：C:\\Users\\86173\\Desktop\\images）:');
    if (dirPath) {
        document.getElementById('project-data-dir').value = dirPath.trim();
    }
}

// 初始化目录选择器事件
document.addEventListener('DOMContentLoaded', function() {
    // 为数据目录输入框添加拖拽支持
    const projectDataDir = document.getElementById('project-data-dir');
    if (projectDataDir) {
        projectDataDir.addEventListener('dragover', function(e) {
            e.preventDefault();
            this.style.borderColor = 'var(--primary)';
            this.style.background = 'rgba(0, 255, 204, 0.1)';
        });
        
        projectDataDir.addEventListener('dragleave', function(e) {
            e.preventDefault();
            this.style.borderColor = '';
            this.style.background = '';
        });
        
        projectDataDir.addEventListener('drop', function(e) {
            e.preventDefault();
            this.style.borderColor = '';
            this.style.background = '';
            
            const items = e.dataTransfer.items;
            if (items && items.length > 0) {
                const item = items[0];
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                    if (entry && entry.isDirectory) {
                        this.value = entry.name;
                    } else {
                        const file = e.dataTransfer.files[0];
                        if (file) {
                            this.value = file.name || '已选择文件';
                        }
                    }
                }
            }
        });
    }
    
    // 创建项目时的目录选择
    const projectDirInput = document.getElementById('project-dir-input');
    if (projectDirInput) {
        projectDirInput.addEventListener('change', function(e) {
            if (this.files && this.files.length > 0) {
                // 尝试获取文件路径
                let dirPath = '';
                const file = this.files[0];
                
                // 方法1: 使用 webkitRelativePath
                if (file.webkitRelativePath) {
                    const parts = file.webkitRelativePath.split('/');
                    if (parts.length > 1) {
                        dirPath = parts[0];
                    }
                }
                
                // 方法2: 尝试从文件路径中提取目录
                if (!dirPath && file.name) {
                    // 使用文件路径的父目录
                    try {
                        // 获取第一个文件的完整路径
                        if (file.webkitRelativePath) {
                            const fullPath = file.webkitRelativePath;
                            const pathParts = fullPath.split('/');
                            if (pathParts.length > 1) {
                                dirPath = pathParts[0];
                            }
                        }
                    } catch (err) {
                        console.log('无法获取目录路径', err);
                    }
                }
                
                // 如果还是无法获取，显示提示
                if (!dirPath) {
                    dirPath = '已选择目录 (' + this.files.length + ' 个文件)';
                }
                
                document.getElementById('project-data-dir').value = dirPath || '已选择目录';
            }
        });
    }
    
    // 编辑项目时的目录选择
    const editDirInput = document.getElementById('edit-dir-input');
    if (editDirInput) {
        editDirInput.addEventListener('change', function(e) {
            if (this.files && this.files.length > 0) {
                const dirPath = this.files[0].webkitRelativePath.split('/')[0];
                document.getElementById('edit-project-data-dir').value = dirPath || '已选择目录';
            }
        });
    }
});

// 选择数据目录（编辑项目时）
function selectEditDataDirectory() {
    const dirPath = prompt('请输入数据目录路径（如：D:\\Images\\data）:');
    if (dirPath) {
        document.getElementById('edit-project-data-dir').value = dirPath;
    }
}


// 颜色选择器
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        const color = this.dataset.color;
        document.getElementById('label-color').value = color;
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
    });
});

// 预刷功能模块
const InferenceModule = {
    // 当前日志数据
    currentLogs: [],
    currentProjectId: null,
    
    // 重试失败的预刷任务
    async retryInference(projectId) {
        try {
            showToast('正在重试预刷任务...', 'info');
            
            const response = await fetch(`${API_BASE}/api/inference/retry/${projectId}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'}
            });
            
            const result = await response.json();
            
            if (result.success) {
                showToast('重试任务已启动', 'success');
                // 刷新项目列表以显示新的状态
                loadProjects();
            } else {
                showToast('重试失败: ' + (result.error || '未知错误'), 'error');
            }
        } catch (error) {
            console.error('重试预刷任务失败:', error);
            showToast('重试失败，请重试', 'error');
        }
    },
    
    // 显示预刷日志面板
    async showInferenceLogs(projectId) {
        // 检查是否已经存在日志面板
        const existingModal = document.getElementById('inference-logs-modal');
        if (existingModal) {
            // 如果已经存在，直接关闭
            this.closeInferenceLogsModal();
            return;
        }
        
        // 创建日志面板模态框
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.id = 'inference-logs-modal';
        
        modal.innerHTML = `
            <div class="modal-content large">
                <div class="modal-header">
                    <h2><i class="fas fa-eye"></i> 预刷日志详情</h2>
                    <button class="close-btn" onclick="InferenceModule.closeInferenceLogsModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="logs-toolbar">
                        <div class="logs-search">
                            <i class="fas fa-search"></i>
                            <input type="text" id="logs-search-input" placeholder="搜索日志..." oninput="InferenceModule.filterLogs()">
                        </div>
                        <div class="logs-filter">
                            <select id="logs-level-filter" onchange="InferenceModule.filterLogs()">
                                <option value="">全部级别</option>
                                <option value="INFO">INFO</option>
                                <option value="WARN">WARN</option>
                                <option value="ERROR">ERROR</option>
                            </select>
                        </div>
                        <div class="logs-actions">
                            <button class="cyber-btn small" onclick="InferenceModule.copyAllLogs()">
                                <i class="fas fa-copy"></i> 复制全部
                            </button>
                        </div>
                    </div>
                    <div class="logs-container" id="logs-container">
                        <div class="logs-loading">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>加载日志中...</span>
                        </div>
                    </div>
                    <div class="logs-pagination" id="logs-pagination"></div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 加载日志数据
        await this.loadInferenceLogs(projectId);
    },
    
    // 加载预刷日志数据
    async loadInferenceLogs(projectId, page = 1, pageSize = 50) {
        try {
            const response = await fetch(`${API_BASE}/api/projects/${projectId}/inference/progress`);
            const result = await response.json();
            
            if (result.success && result.data && result.data.logs) {
                const logs = result.data.logs;
                const logEntries = this.parseLogs(logs);
                
                // 存储日志数据
                this.currentLogs = logEntries;
                this.currentProjectId = projectId;
                
                // 渲染日志
                this.renderLogs(logEntries, page, pageSize);
            } else {
                document.getElementById('logs-container').innerHTML = `
                    <div class="logs-empty">
                        <i class="fas fa-info-circle"></i>
                        <span>暂无日志数据</span>
                    </div>
                `;
            }
        } catch (error) {
            console.error('加载日志失败:', error);
            document.getElementById('logs-container').innerHTML = `
                <div class="logs-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <span>加载日志失败</span>
                </div>
            `;
        }
    },
    
    // 解析日志文本
    parseLogs(logsText) {
        if (!logsText) return [];
        
        const lines = logsText.split('\n');
        const entries = [];
        
        for (const line of lines) {
            if (!line.trim()) continue;
            
            // 尝试解析日志格式: [HH:MM:SS] LEVEL: message
            const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(INFO|WARN|ERROR)?:?\s*(.*)$/);
            
            if (match) {
                entries.push({
                    timestamp: match[1],
                    level: match[2] || 'INFO',
                    message: match[3]
                });
            } else {
                // 如果无法解析，作为普通文本处理
                entries.push({
                    timestamp: '',
                    level: 'INFO',
                    message: line
                });
            }
        }
        
        return entries;
    },
    
    // 渲染日志
    renderLogs(logEntries, page = 1, pageSize = 50) {
        const container = document.getElementById('logs-container');
        const pagination = document.getElementById('logs-pagination');
        
        // 过滤日志
        const searchTerm = document.getElementById('logs-search-input')?.value.toLowerCase() || '';
        const levelFilter = document.getElementById('logs-level-filter')?.value || '';
        
        let filteredLogs = logEntries;
        
        if (searchTerm) {
            filteredLogs = filteredLogs.filter(entry =>
                entry.message.toLowerCase().includes(searchTerm)
            );
        }
        
        if (levelFilter) {
            filteredLogs = filteredLogs.filter(entry => entry.level === levelFilter);
        }
        
        // 分页
        const totalPages = Math.ceil(filteredLogs.length / pageSize);
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pageLogs = filteredLogs.slice(startIndex, endIndex);
        
        // 渲染日志条目
        if (pageLogs.length === 0) {
            container.innerHTML = `
                <div class="logs-empty">
                    <i class="fas fa-search"></i>
                    <span>没有找到匹配的日志</span>
                </div>
            `;
        } else {
            container.innerHTML = pageLogs.map((entry, index) => `
                <div class="log-entry ${entry.level.toLowerCase()}">
                    <div class="log-timestamp">${entry.timestamp}</div>
                    <div class="log-level ${entry.level.toLowerCase()}">${entry.level}</div>
                    <div class="log-message">${this.escapeHtml(entry.message)}</div>
                    <button class="log-copy-btn" onclick="InferenceModule.copyLogEntry(${startIndex + index})" title="复制此条日志">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            `).join('');
        }
        
        // 渲染分页
        this.renderPagination(totalPages, page);
    },
    
    // 渲染分页
    renderPagination(totalPages, currentPage) {
        const pagination = document.getElementById('logs-pagination');
        
        if (totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }
        
        let paginationHtml = '';
        
        // 上一页
        if (currentPage > 1) {
            paginationHtml += `
                <button class="pagination-btn" onclick="InferenceModule.changePage(${currentPage - 1})">
                    <i class="fas fa-chevron-left"></i>
                </button>
            `;
        }
        
        // 页码
        const maxVisiblePages = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
        
        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }
        
        for (let i = startPage; i <= endPage; i++) {
            paginationHtml += `
                <button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="InferenceModule.changePage(${i})">
                    ${i}
                </button>
            `;
        }
        
        // 下一页
        if (currentPage < totalPages) {
            paginationHtml += `
                <button class="pagination-btn" onclick="InferenceModule.changePage(${currentPage + 1})">
                    <i class="fas fa-chevron-right"></i>
                </button>
            `;
        }
        
        pagination.innerHTML = paginationHtml;
    },
    
    // 切换页码
    changePage(page) {
        if (this.currentLogs && this.currentProjectId) {
            this.renderLogs(this.currentLogs, page);
        }
    },
    
    // 过滤日志
    filterLogs() {
        if (this.currentLogs) {
            this.renderLogs(this.currentLogs, 1);
        }
    },
    
    // 复制单条日志
    copyLogEntry(index) {
        if (this.currentLogs && this.currentLogs[index]) {
            const entry = this.currentLogs[index];
            const text = `[${entry.timestamp}] ${entry.level}: ${entry.message}`;
            
            navigator.clipboard.writeText(text).then(() => {
                showToast('日志已复制', 'success');
            }).catch(err => {
                console.error('复制失败:', err);
                showToast('复制失败', 'error');
            });
        }
    },
    
    // 复制全部日志
    copyAllLogs() {
        if (this.currentLogs) {
            const text = this.currentLogs.map(entry =>
                `[${entry.timestamp}] ${entry.level}: ${entry.message}`
            ).join('\n');
            
            navigator.clipboard.writeText(text).then(() => {
                showToast('全部日志已复制', 'success');
            }).catch(err => {
                console.error('复制失败:', err);
                showToast('复制失败', 'error');
            });
        }
    },
    
    // 关闭日志面板
    closeInferenceLogsModal() {
        const modal = document.getElementById('inference-logs-modal');
        if (modal) {
            modal.remove();
        }
    },
    
    // HTML转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// 兼容旧的函数调用
async function retryInference(projectId) {
    return InferenceModule.retryInference(projectId);
}

/**
 * 从项目列表页重新执行AI预刷任务
 */
async function refreshProjectFromProjectList(projectId) {
    const btn = document.getElementById(`project-refresh-btn-${projectId}`);
    if (!btn) return;
    
    // 保存原始按钮内容
    const originalContent = btn.innerHTML;
    const originalTitle = btn.title;
    
    // 设置加载状态
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.title = '正在重新执行...';
    
    try {
        showToastMessage('正在重新执行AI预刷...', 'info');
        
        // 获取项目信息以获取target_labels
        const projectResponse = await fetch(`/api/projects/${projectId}`);
        const projectData = await projectResponse.json();
        
        if (!projectData.success || !projectData.data) {
            throw new Error('获取项目信息失败');
        }
        
        const project = projectData.data.project || projectData.data;
        let targetLabels = [];
        
        if (project.target_labels) {
            try {
                targetLabels = typeof project.target_labels === 'string' 
                    ? JSON.parse(project.target_labels) 
                    : project.target_labels;
            } catch (e) {
                targetLabels = [];
            }
        }
        
        if (!targetLabels || targetLabels.length === 0) {
            throw new Error('请先在项目中配置目标分类');
        }
        
        // 调用重新执行API
        const response = await fetch(`/api/inference/retry/${projectId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target_labels: targetLabels
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToastMessage('AI预刷任务已重新执行', 'success');
            // 刷新项目列表
            loadProjects();
        } else {
            throw new Error(result.error || '重新执行失败');
        }
    } catch (error) {
        console.error('重新执行失败:', error);
        showToastMessage('重新执行失败: ' + error.message, 'error');
        
        // 恢复按钮状态但保持错误状态（用户可以点击重试）
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.classList.add('error');
        btn.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
        btn.title = '重试失败，点击重新执行';
        
        // 5秒后恢复正常状态
        setTimeout(() => {
            if (btn && btn.classList.contains('error')) {
                btn.classList.remove('error');
                btn.innerHTML = originalContent;
                btn.title = originalTitle;
            }
        }, 5000);
    }
}

async function showInferenceLogs(projectId) {
    return InferenceModule.showInferenceLogs(projectId);
}

function closeInferenceLogsModal() {
    return InferenceModule.closeInferenceLogsModal();
}

function filterLogs() {
    return InferenceModule.filterLogs();
}

function copyLogEntry(index) {
    return InferenceModule.copyLogEntry(index);
}

function copyAllLogs() {
    return InferenceModule.copyAllLogs();
}

function changePage(page) {
    return InferenceModule.changePage(page);
}

// 定时刷新项目列表（用于更新预刷进度）
let projectRefreshInterval = null;

function startProjectRefresh() {
    if (projectRefreshInterval) return;
    
    // 每5秒刷新一次项目列表
    projectRefreshInterval = setInterval(() => {
        const currentView = document.querySelector('.nav-btn.active');
        if (currentView && currentView.dataset.view === 'projects') {
            loadProjects();
        }
    }, 5000);
}

function stopProjectRefresh() {
    if (projectRefreshInterval) {
        clearInterval(projectRefreshInterval);
        projectRefreshInterval = null;
    }
}

// 页面加载时启动定时刷新
document.addEventListener('DOMContentLoaded', function() {
    startProjectRefresh();
});

