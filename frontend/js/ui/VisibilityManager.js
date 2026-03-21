// ============================================
// Novisight Label - 标注可见性控制模块
// ============================================

/**
 * 标注可见性管理器
 */
class VisibilityManager {
    constructor() {
        this.categoryVisibility = {}; // 类别可见性状态
        this.labelVisibility = {};     // 标签可见性状态
    }

    /**
     * 初始化可见性状态
     * @param {Array} labels - 标签数组
     */
    init(labels) {
        if (!labels || !Array.isArray(labels)) return;
        
        labels.forEach(label => {
            // 使用category_id或默认值
            const catId = label.category_id || label.category || 'default';
            
            if (!this.labelVisibility.hasOwnProperty(label.id)) {
                this.labelVisibility[label.id] = true;
            }
            if (!this.categoryVisibility.hasOwnProperty(catId)) {
                this.categoryVisibility[catId] = true;
            }
        });
    }

    /**
     * 切换标签可见性
     * @param {string} labelId - 标签ID
     */
    toggleLabel(labelId) {
        this.labelVisibility[labelId] = !this.labelVisibility[labelId];
        this.applyToAnnotations();
        EventBus.emit('visibility:changed', this.getState());
    }

    /**
     * 切换类别可见性
     * @param {string} categoryId - 类别ID
     */
    toggleCategory(categoryId) {
        this.categoryVisibility[categoryId] = !this.categoryVisibility[categoryId];
        
        // 同步更新该类别下所有标签的可见性
        if (AppState.labels) {
            AppState.labels.forEach(label => {
                const catId = label.category_id || label.category || 'default';
                if (catId === categoryId) {
                    this.labelVisibility[label.id] = this.categoryVisibility[categoryId];
                }
            });
        }
        
        this.applyToAnnotations();
        EventBus.emit('visibility:changed', this.getState());
    }

    /**
     * 设置标签可见性
     * @param {string} labelId - 标签ID
     * @param {boolean} visible - 是否可见
     */
    setLabelVisibility(labelId, visible) {
        this.labelVisibility[labelId] = visible;
        
        // 检查类别状态
        if (AppState.labels) {
            const label = AppState.labels.find(l => l.id === labelId);
            if (label) {
                const catId = label.category_id || label.category || 'default';
                this.categoryVisibility[catId] = visible;
            }
        }
        
        this.applyToAnnotations();
        EventBus.emit('visibility:changed', this.getState());
    }

    /**
     * 设置类别可见性
     * @param {string} categoryId - 类别ID
     * @param {boolean} visible - 是否可见
     */
    setCategoryVisibility(categoryId, visible) {
        this.categoryVisibility[categoryId] = visible;
        
        // 同步更新该类别下所有标签
        if (AppState.labels) {
            AppState.labels.forEach(label => {
                const catId = label.category_id || label.category || 'default';
                if (catId === categoryId) {
                    this.labelVisibility[label.id] = visible;
                }
            });
        }
        
        this.applyToAnnotations();
        EventBus.emit('visibility:changed', this.getState());
    }

    /**
     * 应用可见性到标注
     */
    applyToAnnotations() {
        if (!AppState.annotations) return;
        
        AppState.annotations.forEach(ann => {
            if (ann.label) {
                ann.visible = this.labelVisibility[ann.label] !== false;
            }
        });
    }

    /**
     * 获取当前可见性状态
     * @returns {Object}
     */
    getState() {
        return {
            labelVisibility: { ...this.labelVisibility },
            categoryVisibility: { ...this.categoryVisibility }
        };
    }

    /**
     * 获取标签可见性
     * @param {string} labelId - 标签ID
     * @returns {boolean}
     */
    isLabelVisible(labelId) {
        return this.labelVisibility[labelId] !== false;
    }

    /**
     * 获取类别可见性
     * @param {string} categoryId - 类别ID
     * @returns {boolean}
     */
    isCategoryVisible(categoryId) {
        return this.categoryVisibility[categoryId] !== false;
    }

    /**
     * 显示所有标注
     */
    showAll() {
        Object.keys(this.labelVisibility).forEach(id => {
            this.labelVisibility[id] = true;
        });
        Object.keys(this.categoryVisibility).forEach(id => {
            this.categoryVisibility[id] = true;
        });
        
        this.applyToAnnotations();
        EventBus.emit('visibility:changed', this.getState());
    }

    /**
     * 隐藏所有标注
     */
    hideAll() {
        Object.keys(this.labelVisibility).forEach(id => {
            this.labelVisibility[id] = false;
        });
        Object.keys(this.categoryVisibility).forEach(id => {
            this.categoryVisibility[id] = false;
        });
        
        this.applyToAnnotations();
        EventBus.emit('visibility:changed', this.getState());
    }

    /**
     * 反转所有可见性
     */
    invertAll() {
        Object.keys(this.labelVisibility).forEach(id => {
            this.labelVisibility[id] = !this.labelVisibility[id];
        });
        Object.keys(this.categoryVisibility).forEach(id => {
            this.categoryVisibility[id] = !this.categoryVisibility[id];
        });
        
        this.applyToAnnotations();
        EventBus.emit('visibility:changed', this.getState());
    }

    /**
     * 获取可见标注数量
     * @returns {number}
     */
    getVisibleCount() {
        if (!AppState.annotations) return 0;
        return AppState.annotations.filter(ann => ann.visible !== false).length;
    }

    /**
     * 渲染可见性控制面板HTML
     * @returns {string}
     */
    renderControlPanel() {
        // 按类别分组
        const categories = this.getCategoriesWithLabels();
        
        let html = `
            <div class="visibility-panel">
                <div class="visibility-header">
                    <h4><i class="fas fa-eye"></i> 可见性控制</h4>
                    <div class="visibility-actions">
                        <button class="cyber-btn tiny" onclick="VisibilityManager.showAll()" title="显示全部">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="cyber-btn tiny" onclick="VisibilityManager.hideAll()" title="隐藏全部">
                            <i class="fas fa-eye-slash"></i>
                        </button>
                    </div>
                </div>
                <div class="visibility-content">
        `;
        
        categories.forEach(cat => {
            const catVisible = this.isCategoryVisible(cat.id);
            html += `
                <div class="visibility-category">
                    <label class="category-toggle">
                        <input type="checkbox" 
                            ${catVisible ? 'checked' : ''}
                            onchange="VisibilityManager.toggleCategory('${cat.id}')">
                        <span class="category-color" style="background: ${cat.color}"></span>
                        <span class="category-name">${cat.name}</span>
                    </label>
            `;
            
            if (cat.labels && cat.labels.length > 0) {
                html += '<ul class="label-list">';
                cat.labels.forEach(label => {
                    const labelVisible = this.isLabelVisible(label.id);
                    html += `
                        <li class="label-item">
                            <label>
                                <input type="checkbox"
                                    ${labelVisible ? 'checked' : ''}
                                    onchange="VisibilityManager.toggleLabel('${label.id}')">
                                <span style="color: ${label.color}">${label.name}</span>
                                <span class="annotation-count">(${this.getAnnotationCount(label.id)})</span>
                            </label>
                        </li>
                    `;
                });
                html += '</ul>';
            }
            
            html += '</div>';
        });
        
        html += `
                </div>
                <div class="visibility-footer">
                    <span>可见: ${this.getVisibleCount()} / ${AppState.annotations?.length || 0}</span>
                </div>
            </div>
        `;
        
        return html;
    }

    /**
     * 获取带标签的类别列表
     * @returns {Array}
     */
    getCategoriesWithLabels() {
        // 从AppState.labels中提取类别
        if (!AppState.labels || !Array.isArray(AppState.labels)) {
            return [];
        }
        
        const categoryMap = new Map();
        
        AppState.labels.forEach(label => {
            const catId = label.category_id || label.category || 'default';
            if (!categoryMap.has(catId)) {
                categoryMap.set(catId, {
                    id: catId,
                    name: label.category_name || label.category || '未分类',
                    color: label.color || '#00ffcc',
                    labels: []
                });
            }
            categoryMap.get(catId).labels.push(label);
        });
        
        return Array.from(categoryMap.values());
    }

    /**
     * 获取指定标签的标注数量
     * @param {string} labelId - 标签ID
     * @returns {number}
     */
    getAnnotationCount(labelId) {
        if (!AppState.annotations) return 0;
        return AppState.annotations.filter(ann => ann.label === labelId).length;
    }
}

// 全局可见性管理器实例
window.VisibilityManager = new VisibilityManager();
