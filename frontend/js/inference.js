// ============================================
// Novisight Label - 推理服务前端
// 包含重试机制和预刷进度监控
// ============================================

// 重试配置
const RETRY_CONFIG = {
    maxRetries: 3,
    initialDelay: 1000,  // 1秒
    maxDelay: 10000,     // 10秒
    backoffFactor: 2
};

// ============================================
// 带有指数退避的重试机制
// ============================================

/**
 * 带有指数退避的重试函数
 * @param {Function} fetchFunc - 执行请求的函数
 * @param {Object} options - 重试配置
 * @returns {Promise} - 请求结果
 */
async function retryWithBackoff(fetchFunc, options = {}) {
    const config = { ...RETRY_CONFIG, ...options };
    let lastError = null;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            return await fetchFunc();
        } catch (error) {
            lastError = error;
            
            // 判断是否可重试
            const isRetryable = isErrorRetryable(error);
            
            if (isRetryable && attempt < config.maxRetries) {
                // 计算延迟时间
                const delay = Math.min(
                    config.initialDelay * Math.pow(config.backoffFactor, attempt),
                    config.maxDelay
                );
                
                console.log(`请求失败，${delay}ms后重试 (${attempt + 1}/${config.maxRetries}): ${error.message}`);
                await sleep(delay);
            } else {
                throw error;
            }
        }
    }
    
    throw lastError;
}

/**
 * 判断错误是否可重试
 */
function isErrorRetryable(error) {
    if (!error.response) {
        // 网络错误，重试
        return true;
    }
    
    const status = error.response.status;
    // 429: Rate limit, 5xx: 服务器错误
    return status === 429 || (status >= 500 && status < 600);
}

/**
 * 延迟函数
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// API调用封装
// ============================================

/**
 * 通用API调用（带重试）
 */
async function apiCallWithRetry(url, options = {}) {
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };
    
    return retryWithBackoff(async () => {
        const response = await fetch(url, mergedOptions);
        
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            error.response = { status: response.status };
            throw error;
        }
        
        return response.json();
    });
}

/**
 * 获取推理进度列表
 */
async function getInferenceProgressList() {
    return apiCallWithRetry('/api/inference/progress');
}

/**
 * 获取单个项目推理进度
 */
async function getInferenceProgress(projectId) {
    return apiCallWithRetry(`/api/inference/progress/${projectId}`);
}

/**
 * 触发重试
 */
async function retryInference(projectId) {
    return apiCallWithRetry(`/api/inference/retry/${projectId}`, {
        method: 'POST'
    });
}

// ============================================
// 预刷进度监控
// ============================================

/**
 * 加载推理监控视图
 */
async function loadInferenceView() {
    // 使用HTML中已有的inference-view作为容器
    let container = document.getElementById('inference-view-content');
    
    // 如果容器不存在，尝试使用HTML中的inference-view
    if (!container) {
        const inferenceView = document.getElementById('inference-view');
        if (inferenceView) {
            container = inferenceView;
        }
    }
    
    // 如果仍然没有容器，创建它
    if (!container) {
        console.error('找不到预刷视图容器');
        return;
    }
    
    // 设置导航按钮点击事件
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        if (btn.dataset.view === 'inference' && !btn.hasAttribute('data-inference-listener')) {
            btn.setAttribute('data-inference-listener', 'true');
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                loadInferenceView();
            });
        }
    });
    
    try {
        const result = await getInferenceProgressList();
        console.log('预刷列表结果:', result);
        
        if (result.success) {
            renderInferenceDashboard(result.data);
        } else {
            container.innerHTML = `<div class="error-message">加载失败: ${result.error}</div>`;
        }
    } catch (error) {
        console.error('加载预刷进度失败:', error);
        showToastMessage('加载预刷进度失败', 'error');
    }
}

/**
 * 渲染推理仪表板
 */
function renderInferenceDashboard(projects) {
    const container = document.getElementById('inference-projects-list');
    
    if (!container) return;
    
    // 计算统计数据
    const stats = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        totalTasks: 0,
        completedTasks: 0
    };
    
    if (projects && projects.length > 0) {
        projects.forEach(p => {
            const progress = p.progress || {};
            const status = progress.status || 'pending';
            
            if (status === 'pending') stats.pending++;
            else if (status === 'processing') stats.processing++;
            else if (status === 'completed') stats.completed++;
            else if (status === 'failed') stats.failed++;
            
            stats.totalTasks += progress.total_tasks || 0;
            stats.completedTasks += progress.completed_tasks || 0;
        });
    }
    
    // 更新统计卡片
    const statPending = document.getElementById('stat-pending');
    const statProcessing = document.getElementById('stat-processing');
    const statCompleted = document.getElementById('stat-completed');
    const statFailed = document.getElementById('stat-failed');
    
    if (statPending) statPending.textContent = stats.pending;
    if (statProcessing) statProcessing.textContent = stats.processing;
    if (statCompleted) statCompleted.textContent = stats.completed;
    if (statFailed) statFailed.textContent = stats.failed;
    
    if (!projects || projects.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-robot"></i>
                <p>暂无正在进行预刷的项目</p>
                <p class="hint">创建项目时启用"AI预刷"即可自动识别</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = projects.map(project => renderInferenceProjectCard(project)).join('');
}

/**
 * 渲染项目卡片
 */
function renderInferenceProjectCard(project) {
    const progress = project.progress || {};
    const status = progress.status || 'pending';
    
    // Generate the status badge HTML to match the projects view
    let statusBadgeHtml = '';
    let inferenceRetryHtml = '';
    let inferenceProgressHtml = '';
    let inferenceLogsHtml = '';
    
    switch (status) {
        case 'pending':
            statusBadgeHtml = '<span class="inference-badge pending"><i class="fas fa-clock"></i> 待处理</span>';
            break;
        case 'processing':
            statusBadgeHtml = '<span class="inference-badge processing"><i class="fas fa-spinner fa-spin"></i> 处理中</span>';
            break;
        case 'completed':
            statusBadgeHtml = '<span class="inference-badge completed"><i class="fas fa-check"></i> 已完成</span>';
            break;
        case 'failed':
            statusBadgeHtml = '<span class="inference-badge failed"><i class="fas fa-exclamation"></i> 失败</span>';
            // 添加重试按钮
            inferenceRetryHtml = `
                <button class="cyber-btn small retry-btn" onclick="retryProjectInference('${project.id}')" title="重试预刷任务">
                    <i class="fas fa-redo"></i> 重试
                </button>`;
            break;
        default:
            statusBadgeHtml = `<span class="inference-badge ${status}">${status}</span>`;
    }
    
    const total = progress.total_tasks || 0;
    const completed = progress.completed_tasks || 0;
    const failed = progress.failed_tasks || 0;
    
    // 计算进度百分比
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    // 获取目标标签 (假设项目对象有一个 target_labels 字段，是一个数组)
    const targetLabels = project.target_labels || [];
    
    // 进度条和日志查看按钮
    if (status === 'processing' || status === 'completed' || status === 'failed') {
        inferenceProgressHtml = `
            <div class="inference-progress-container">
                <div class="inference-progress-bar">
                    <div class="inference-progress-fill" style="width: ${progressPercent}%"></div>
                </div>
                <div class="inference-progress-stats">
                    <span>${completed}/${total} (${progressPercent}%)</span>
                    ${failed > 0 ? `<span class="failed-count">失败: ${failed}</span>` : ''}
                    ${progress.logs ? `
                    <button class="cyber-btn small log-view-btn" onclick="showInferenceLogs('${project.id}')" title="查看详细日志">
                        <i class="fas fa-eye"></i> 查看日志
                    </button>` : ''}
                </div>
            </div>`;
    }
    
    return `
        <div class="inference-project-card ${status === 'pending' ? 'status-pending' : status === 'processing' ? 'status-processing' : status === 'completed' ? 'status-completed' : status === 'failed' ? 'status-failed' : ''}" data-project-id="${project.id}" data-category-id="${project.category_id || ''}">
            <div class="inference-card-header">
                <h4>${project.name}</h4>
            </div>
            <div class="inference-card-body">
                <div class="inference-info-row">
                    <i class="fas fa-robot"></i>
                    <span>AI预刷:</span>
                    ${statusBadgeHtml}
                    ${inferenceRetryHtml}
                </div>
                <div class="inference-labels-row" id="inference-labels-display-${project.id}">
                    ${targetLabels.length > 0 ? `
                        <span class="inference-labels-list">
                            ${targetLabels.map(label => `<span class="inference-label-tag">${label}</span>`).join('')}
                        </span>
                        <button class="cyber-btn small" onclick="editInferenceLabels('${project.id}')" title="编辑目标分类">
                            <i class="fas fa-edit"></i>
                        </button>
                    ` : `
                        <button class="cyber-btn small" onclick="editInferenceLabels('${project.id}')" title="设置目标分类">
                            <i class="fas fa-plus"></i> 设置分类
                        </button>
                    `}
                </div>
                ${inferenceProgressHtml}
                ${progress.error_message && progress.error_message.length > 0 ? `
                    <div class="error-info">
                        <i class="fas fa-exclamation-triangle"></i>
                        <span>${progress.error_message.length}个错误</span>
                    </div>
                ` : ''}
            </div>
            <div class="inference-card-actions">
                <button class="cyber-btn small" onclick="openInferenceProject('${project.id}')" title="查看详情">
                    <i class="fas fa-eye"></i>
                </button>
                ${status === 'pending' ? `
                    <button class="cyber-btn small primary" onclick="startProjectInference('${project.id}')" title="开始预刷">
                        <i class="fas fa-play"></i>
                    </button>
                ` : ''}
                ${status === 'processing' ? `
                    <button class="cyber-btn small" onclick="refreshInferenceProgress('${project.id}')" title="刷新">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                ` : ''}
                ${(status === 'completed' || status === 'failed' || status === 'pending') ? `
                    <button class="cyber-btn small refresh-btn" id="refresh-btn-${project.id}" onclick="refreshProjectInference('${project.id}')" title="重新执行AI预刷">
                        <i class="fas fa-redo"></i>
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * 编辑推理目标分类
 */
async function editInferenceLabels(projectId) {
    const card = document.querySelector(`[data-project-id="${projectId}"]`);
    if (!card) return;
    
    const categoryId = card.dataset.categoryId;
    if (!categoryId) {
        showToastMessage('请先为项目设置分类', 'warning');
        return;
    }
    
    // 获取当前选中的标签
    const currentLabels = [];
    const labelTags = card.querySelectorAll('.inference-label-tag');
    labelTags.forEach(tag => {
        currentLabels.push(tag.textContent);
    });
    
    try {
        // 获取分类下的标签
        const response = await fetch(`/api/categories/${categoryId}/labels`);
        const labels = await response.json();
        
        if (!Array.isArray(labels) || labels.length === 0) {
            showToastMessage('该分类下没有标签', 'warning');
            return;
        }
        
        // 显示编辑弹窗
        showEditInferenceLabelsModal(projectId, labels, currentLabels);
    } catch (error) {
        console.error('加载标签失败:', error);
        showToastMessage('加载标签失败', 'error');
    }
}

/**
 * 显示编辑目标分类弹窗
 */
function showEditInferenceLabelsModal(projectId, availableLabels, currentLabels) {
    let modal = document.getElementById('edit-inference-labels-modal');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'edit-inference-labels-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2><i class="fas fa-crosshairs"></i> 编辑目标分类</h2>
                    <button class="close-btn" onclick="closeEditInferenceLabelsModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="inference-labels-container">
                        <div class="inference-labels-header">
                            <i class="fas fa-tags"></i>
                            <span>选择要识别的目标分类（可多选）</span>
                        </div>
                        <div class="inference-labels-grid" id="edit-inference-labels-grid">
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="cyber-btn" onclick="closeEditInferenceLabelsModal()">取消</button>
                    <button class="cyber-btn primary" id="save-inference-labels-btn" onclick="saveInferenceLabels('${projectId}')">
                        <i class="fas fa-save"></i> 保存
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    // 渲染标签选项（使用checkbox样式，与创建项目时一致）
    const labelsGrid = modal.querySelector('#edit-inference-labels-grid');
    labelsGrid.innerHTML = availableLabels.map(label => {
        const isSelected = currentLabels.includes(label.name);
        return `
            <label class="inference-label-item ${isSelected ? 'selected' : ''}">
                <input type="checkbox" value="${label.name}" ${isSelected ? 'checked' : ''}>
                <span class="label-text">${label.name}</span>
            </label>
        `;
    }).join('');
    
    // 为每个label添加点击事件来切换样式
    labelsGrid.querySelectorAll('.inference-label-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.stopPropagation();
            const checkbox = this.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                this.classList.toggle('selected', checkbox.checked);
            }
        });
    });
    
    // 保存项目ID
    modal.dataset.projectId = projectId;
    
    // 显示弹窗
    modal.style.display = 'flex';
}

/**
 * 关闭编辑目标分类弹窗
 */
function closeEditInferenceLabelsModal() {
    const modal = document.getElementById('edit-inference-labels-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * 保存推理目标分类
 */
async function saveInferenceLabels(projectId) {
    const modal = document.getElementById('edit-inference-labels-modal');
    if (!modal) return;
    
    // 获取选中的标签
    const checkboxes = modal.querySelectorAll('#edit-inference-labels-grid input[type="checkbox"]:checked');
    const selectedLabels = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedLabels.length === 0) {
        showToastMessage('请至少选择一个目标分类', 'warning');
        return;
    }
    
    try {
        // 更新项目的目标分类
        const response = await fetch(`/api/projects/${projectId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                target_labels: selectedLabels
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToastMessage('目标分类已更新', 'success');
            closeEditInferenceLabelsModal();
            
            // 刷新推理视图
            loadInferenceView();
        } else {
            showToastMessage(result.error || '保存失败', 'error');
        }
    } catch (error) {
        console.error('保存目标分类失败:', error);
        showToastMessage('保存失败', 'error');
    }
}

/**
 * 打开项目预刷详情
 */
async function openInferenceProject(projectId) {
    try {
        const response = await getInferenceProgress(projectId);
        
        if (response.success && response.data) {
            const progress = response.data;
            
            // 显示预刷详情弹窗
            showInferenceDetailModal(progress);
        }
    } catch (error) {
        console.error('获取预刷详情失败:', error);
        showToastMessage('获取预刷详情失败', 'error');
    }
}

/**
 * 显示预刷详情弹窗
 */
function showInferenceDetailModal(progress) {
    // 创建或更新弹窗
    let modal = document.getElementById('inference-detail-modal');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'inference-detail-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    
    const statusText = {
        'pending': '待处理',
        'processing': '处理中',
        'completed': '已完成',
        'failed': '失败'
    }[progress.status] || '未知';
    
    const errors = progress.error_message || [];
    
    modal.innerHTML = `
        <div class="modal-content large">
            <div class="modal-header">
                <h2><i class="fas fa-robot"></i> 预刷进度详情</h2>
                <button class="close-btn" onclick="closeInferenceModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="detail-info">
                    <div class="detail-row">
                        <span class="label">状态</span>
                        <span class="value status-badge status-${progress.status}">${statusText}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">总数:</span>
                        <span class="value">${progress.total_tasks}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">已完成:</span>
                        <span class="value">${progress.completed_tasks}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">失败:</span>
                        <span class="value">${progress.failed_tasks}</span>
                    </div>
                    <div class="detail-row">
                        <span class="label">目标分类:</span>
                        <span class="value">${(progress.target_labels || []).join(', ')}</span>
                    </div>
                    ${progress.started_at ? `
                        <div class="detail-row">
                            <span class="label">开始时间</span>
                            <span class="value">${new Date(progress.started_at).toLocaleString()}</span>
                        </div>
                    ` : ''}
                    ${progress.completed_at ? `
                        <div class="detail-row">
                            <span class="label">完成时间:</span>
                            <span class="value">${new Date(progress.completed_at).toLocaleString()}</span>
                        </div>
                    ` : ''}
                </div>
                
                ${progress.logs ? `
                    <div class="logs-section">
                        <h4><i class="fas fa-list"></i> 处理日志</h4>
                        <div class="logs-content">
                            <pre>${progress.logs}</pre>
                        </div>
                    </div>
                ` : ''}
                
                ${errors.length > 0 ? `
                    <div class="errors-section">
                        <h4><i class="fas fa-exclamation-triangle"></i> 错误详情</h4>
                        <div class="errors-list">
                            ${errors.map(err => `
                                <div class="error-item">
                                    <span class="error-path">${err.image_path || '未知'}</span>
                                    <span class="error-msg">${err.error || '未知错误'}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
            <div class="modal-footer">
                <button class="cyber-btn" onclick="closeInferenceModal()">关闭</button>
                ${progress.status === 'processing' ? `
                    <button class="cyber-btn" onclick="refreshInferenceProgress('${progress.project_id}')">
                        <i class="fas fa-sync-alt"></i> 刷新
                    </button>
                ` : ''}
                ${progress.status === 'failed' ? `
                    <button class="cyber-btn primary" onclick="retryCurrentInference()">
                        <i class="fas fa-redo"></i> 重试
                    </button>
                ` : ''}
            </div>
        </div>
    `;
    
    // 保存当前项目ID供重试用
    modal.dataset.projectId = progress.project_id;
    
    // 显示弹窗
    modal.style.display = 'flex';
}

/**
 * 关闭预刷详情弹窗
 */
function closeInferenceModal() {
    const modal = document.getElementById('inference-detail-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * 重试当前项目的预刷
 */
async function retryCurrentInference() {
    const modal = document.getElementById('inference-detail-modal');
    if (!modal) return;
    
    const projectId = modal.dataset.projectId;
    if (!projectId) return;
    
    closeInferenceModal();
    await retryProjectInference(projectId);
}

/**
 * 重新执行AI预刷任务（带加载状态）
 */
async function refreshProjectInference(projectId) {
    const btn = document.getElementById(`refresh-btn-${projectId}`);
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
            // 刷新视图
            loadInferenceView();
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
        
        // 5秒后恢复正常状态（但保留可点击状态）
        setTimeout(() => {
            if (btn && btn.classList.contains('error')) {
                btn.classList.remove('error');
                btn.innerHTML = originalContent;
                btn.title = originalTitle;
            }
        }, 5000);
    }
    
    // 成功情况下也会恢复按钮状态
    // 注意：成功后loadInferenceView()会重新渲染卡片，所以不需要手动恢复
}

/**
 * 重试项目预刷
 */
async function retryProjectInference(projectId) {
    try {
        showToastMessage('正在重试...', 'info');
        const response = await retryInference(projectId);
        
        if (response.success) {
            showToastMessage('重试任务已启动', 'success');
            // 刷新页面
            loadInferenceView();
        } else {
            showToastMessage(response.error || '重试失败', 'error');
        }
    } catch (error) {
        console.error('重试失败:', error);
        showToastMessage('重试失败: ' + error.message, 'error');
    }
}

/**
 * 开始项目预刷
 */
async function startProjectInference(projectId) {
    try {
        showToastMessage('正在启动预刷...', 'info');
        
        // 获取项目信息以获取target_labels
        const projectResponse = await fetch(`/api/projects/${projectId}`);
        const projectData = await projectResponse.json();
        
        console.log('项目数据:', projectData);
        
        if (!projectData.success || !projectData.data) {
            showToastMessage('获取项目信息失败', 'error');
            return;
        }
        
        // API返回的数据结构是 {success: true, data: {project: {...}, labels: [], ...}}
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
        
        console.log('目标标签:', targetLabels);
        
        if (!targetLabels || targetLabels.length === 0) {
            showToastMessage('请先在项目中配置目标分类', 'warning');
            return;
        }
        
        const response = await fetch(`/api/projects/${projectId}/inference/start`, {
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
            showToastMessage('预刷任务已启动', 'success');
            loadInferenceView();
        } else {
            showToastMessage(result.error || '启动失败', 'error');
        }
    } catch (error) {
        console.error('启动预刷失败:', error);
        showToastMessage('启动预刷失败: ' + error.message, 'error');
    }
}

/**
 * 刷新单个项目预刷进度
 */
async function refreshInferenceProgress(projectId) {
    try {
        const response = await getInferenceProgress(projectId);
        
        if (response.success && response.data) {
            showInferenceDetailModal(response.data);
            // 同时更新列表
            loadInferenceView();
        }
    } catch (error) {
        console.error('刷新进度失败:', error);
    }
}

// Socket.io 连接
let inferenceSocket = null;

/**
 * 初始化 WebSocket 连接
 */
function initInferenceSocket() {
    if (inferenceSocket) return;
    
    // 获取服务器地址
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const host = window.location.host;
    const socketUrl = protocol + '//' + host;
    
    try {
        inferenceSocket = io(socketUrl, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5
        });
        
        // 监听连接成功
        inferenceSocket.on('connect', function() {
            console.log('推理服务 WebSocket 连接成功');
        });
        
        // 监听推理进度更新
        inferenceSocket.on('inference_progress', function(data) {
            console.log('收到推理进度更新:', data);
            updateInferenceProgressUI(data);
        });
        
        // 监听推理日志
        inferenceSocket.on('inference_log', function(log) {
            console.log('收到推理日志:', log);
            appendInferenceLog(log);
        });
        
        // 监听断开连接
        inferenceSocket.on('disconnect', function() {
            console.log('推理服务 WebSocket 断开连接');
        });
        
        // 监听连接错误
        inferenceSocket.on('connect_error', function(error) {
            console.error('推理服务 WebSocket 连接错误:', error);
        });
        
    } catch (error) {
        console.error('初始化推理服务 WebSocket 失败:', error);
    }
}

/**
 * 更新推理进度 UI
 */
function updateInferenceProgressUI(data) {
    const { project_id, current, total, annotations_count } = data;
    
    // 查找对应的项目卡片
    const card = document.querySelector(`[data-project-id="${project_id}"]`);
    if (!card) return;
    
    // 更新进度条
    const progressFill = card.querySelector('.inference-progress-fill');
    const progressStats = card.querySelector('.inference-progress-stats');
    
    if (progressFill && total > 0) {
        const percent = Math.round((current / total) * 100);
        progressFill.style.width = `${percent}%`;
    }
    
    if (progressStats) {
        progressStats.innerHTML = `<span>${current}/${total}</span>`;
    }
}

/**
 * 追加推理日志
 */
let inferenceLogBuffer = [];

function appendInferenceLog(log) {
    // 将日志添加到缓冲区
    if (typeof log === 'string') {
        inferenceLogBuffer.push(log);
    } else if (log && log.message) {
        const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
        inferenceLogBuffer.push(`[${timestamp}] [${log.level}] ${log.message}`);
    }
    
    // 限制缓冲区大小
    if (inferenceLogBuffer.length > 500) {
        inferenceLogBuffer.shift();
    }
}

/**
 * 获取推理日志缓冲区
 */
function getInferenceLogs() {
    return inferenceLogBuffer;
}

// 定时刷新预刷进度
let inferenceRefreshInterval = null;

/**
 * 启动定时刷新预刷进度
 */
function startInferenceRefresh() {
    if (inferenceRefreshInterval) return;
    
    // 每5秒刷新一次
    inferenceRefreshInterval = setInterval(() => {
        const currentView = document.querySelector('.nav-btn.active');
        if (currentView && currentView.dataset.view === 'inference') {
            loadInferenceView();
        }
    }, 5000);
}

/**
 * 停止定时刷新
 */
function stopInferenceRefresh() {
    if (inferenceRefreshInterval) {
        clearInterval(inferenceRefreshInterval);
        inferenceRefreshInterval = null;
    }
}

// ============================================
// 创建项目时处理预刷选项
// ============================================

/**
 * 初始化预刷选项事件
 */
function initInferenceOptions() {
    const enableInferenceCheckbox = document.getElementById('project-enable-inference');
    const labelsGroup = document.getElementById('inference-labels-group');
    
    if (enableInferenceCheckbox && labelsGroup) {
        enableInferenceCheckbox.addEventListener('change', function() {
            labelsGroup.style.display = this.checked ? 'block' : 'none';
            
            if (this.checked) {
                // 加载分类标签
                loadCategoryLabelsForInference();
            }
        });
    }
    
    // 分类选择变化时更新标签选项
    const categorySelect = document.getElementById('project-category');
    if (categorySelect) {
        categorySelect.addEventListener('change', function() {
            const enableInference = document.getElementById('project-enable-inference');
            if (enableInference && enableInference.checked) {
                loadCategoryLabelsForInference();
            }
        });
    }
}

/**
 * 加载分类标签用于预刷
 */
async function loadCategoryLabelsForInference() {
    const categoryId = document.getElementById('project-category')?.value;
    const labelsSelect = document.getElementById('project-inference-labels');
    
    if (!labelsSelect || !categoryId) {
        if (labelsSelect) {
            labelsSelect.innerHTML = '<p class="empty-hint">请先选择分类...</p>';
        }
        return;
    }
    
    try {
        const response = await fetch(`/api/categories/${categoryId}/labels`);
        const labels = await response.json();
        
        if (Array.isArray(labels) && labels.length > 0) {
            // 使用checkbox方式渲染，每个checkbox独立
            labelsSelect.innerHTML = labels.map(label => 
                `<label class="inference-label-item">
                    <input type="checkbox" value="${label.name}" style="display: none;">
                    <span class="label-text">${label.name}</span>
                </label>`
            ).join('');
            
            // 为每个label添加点击事件来切换样式
            labelsSelect.querySelectorAll('.inference-label-item').forEach(item => {
                item.addEventListener('click', function(e) {
                    // 防止重复触发
                    e.stopPropagation();
                    const checkbox = this.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        this.classList.toggle('selected', checkbox.checked);
                    }
                });
                
                // 初始化时确保没有选中状态
                const checkbox = item.querySelector('input[type="checkbox"]');
                if (checkbox) {
                    checkbox.checked = false;
                }
                item.classList.remove('selected');
            });
        } else {
            labelsSelect.innerHTML = '<p class="empty-hint">该分类下没有子分类</p>';
        }
    } catch (error) {
        console.error('加载标签失败:', error);
        labelsSelect.innerHTML = '<p class="empty-hint">加载失败</p>';
    }
}

/**
 * 获取选中的预刷标签
 */
function getSelectedInferenceLabels() {
    // 首先尝试作为select元素获取
    const labelsSelect = document.getElementById('project-inference-labels');
    if (!labelsSelect) return [];
    
    // 如果是select元素
    if (labelsSelect.tagName === 'SELECT') {
        return Array.from(labelsSelect.selectedOptions).map(option => option.value);
    }
    
    // 查找所有被选中的checkbox
    const checkboxes = labelsSelect.querySelectorAll('input[type="checkbox"]:checked');
    if (checkboxes.length > 0) {
        return Array.from(checkboxes).map(cb => cb.value);
    }
    
    // 查找所有带有selected类的元素（兼容旧方式）
    const selectedLabels = labelsSelect.querySelectorAll('.inference-label-item.selected');
    if (selectedLabels.length > 0) {
        return Array.from(selectedLabels).map(el => el.dataset.value || el.querySelector('.label-text')?.textContent);
    }
    
    return [];
}


// ============================================
// Toast通知
// ============================================

// 保存全局showToast函数引用
let globalToastFn = null;

/**
 * 获取全局showToast函数（避免递归）
 */
function getGlobalToast() {
    if (globalToastFn === null) {
        // 直接查找app.js中定义的showToast
        if (typeof window.showToast === 'function') {
            // 检查是否是app.js中的函数
            globalToastFn = window.showToast;
        } else {
            globalToastFn = undefined;
        }
    }
    return globalToastFn;
}

/**
 * 显示Toast通知
 */
function showToastMessage(message, type = 'info') {
    const globalToast = getGlobalToast();
    if (globalToast) {
        globalToast(message, type);
        return;
    }
    
    // 创建简单的Toast
    let toast = document.querySelector('.toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            right: 24px;
            transform: translateY(-50%);
            padding: 15px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(toast);
    }
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    
    toast.style.backgroundColor = colors[type] || colors.info;
    toast.textContent = message;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

// ============================================
// 初始化
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    initInferenceOptions();
    initInferenceSocket();  // 初始化 WebSocket 连接
    startInferenceRefresh();
});

// 页面卸载时停止刷新
window.addEventListener('beforeunload', function() {
    stopInferenceRefresh();
});
