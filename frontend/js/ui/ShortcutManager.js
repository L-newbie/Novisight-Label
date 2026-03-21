// ============================================
// Novisight Label - 快捷键管理模块
// ============================================

/**
 * 快捷键管理器
 */
class ShortcutManager {
    constructor() {
        this.shortcuts = {};
        this.enabled = true;
        this.helpDialog = null;
    }

    /**
     * 注册快捷键
     * @param {string} key - 快捷键（如 'Ctrl+Z'）
     * @param {Function} handler - 处理函数
     * @param {string} description - 描述
     */
    register(key, handler, description = '') {
        const normalizedKey = this.normalizeKey(key);
        this.shortcuts[normalizedKey] = {
            handler,
            description,
            key
        };
        
        // 更新帮助面板
        this.updateHelpDialog();
    }

    /**
     * 注销快捷键
     * @param {string} key - 快捷键
     */
    unregister(key) {
        const normalizedKey = this.normalizeKey(key);
        delete this.shortcuts[normalizedKey];
        this.updateHelpDialog();
    }

    /**
     * 标准化快捷键字符串
     */
    normalizeKey(key) {
        return key.toLowerCase().replace(/\s+/g, '');
    }

    /**
     * 处理键盘事件
     */
    handleKeydown(e) {
        if (!this.enabled) return;
        
        // 不在输入框中时触发快捷键
        const target = e.target;
        const isInput = target.tagName === 'INPUT' || 
                       target.tagName === 'TEXTAREA' || 
                       target.contentEditable === 'true';
        
        // 构建快捷键字符串
        const parts = [];
        if (e.ctrlKey || e.metaKey) parts.push('ctrl');
        if (e.shiftKey) parts.push('shift');
        if (e.altKey) parts.push('alt');
        
        const key = (e.key || '').toLowerCase();
        if (key && !['control', 'shift', 'alt', 'meta'].includes(key)) {
            parts.push(key);
        }
        
        const shortcut = parts.join('+');
        
        // 查找匹配的快捷键
        const matched = this.findMatchingShortcut(shortcut);
        
        if (matched) {
            // 如果在输入框中，只允许特定快捷键
            if (isInput && !this.isInputAllowedShortcut(shortcut)) {
                return;
            }
            
            e.preventDefault();
            try {
                matched.handler();
            } catch (error) {
                console.error('Shortcut handler error:', error);
            }
        }
    }

    /**
     * 查找匹配的快捷键
     */
    findMatchingShortcut(shortcut) {
        // 精确匹配
        if (this.shortcuts[shortcut]) {
            return this.shortcuts[shortcut];
        }
        
        // 部分匹配（如 'ctrl+z' 匹配 'Ctrl+Z'）
        for (const key in this.shortcuts) {
            if (key.includes(shortcut) || shortcut.includes(key)) {
                return this.shortcuts[key];
            }
        }
        
        return null;
    }

    /**
     * 检查输入框中是否允许该快捷键
     */
    isInputAllowedShortcut(shortcut) {
        const allowed = ['ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z', 'ctrl+y'];
        return allowed.includes(shortcut);
    }

    /**
     * 显示快捷键帮助
     */
    showHelp() {
        if (!this.helpDialog) {
            this.createHelpDialog();
        }
        
        this.helpDialog.style.display = 'flex';
        this.updateHelpContent();
    }

    /**
     * 隐藏快捷键帮助
     */
    hideHelp() {
        if (this.helpDialog) {
            this.helpDialog.style.display = 'none';
        }
    }

    /**
     * 创建帮助对话框
     */
    createHelpDialog() {
        const dialog = document.createElement('div');
        dialog.id = 'shortcut-help-dialog';
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="shortcut-help-content">
                <div class="shortcut-help-header">
                    <h2><i class="fas fa-keyboard"></i> 快捷键</h2>
                    <button class="close-btn" onclick="ShortcutManager.hideHelp()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="shortcut-help-body" id="shortcut-list"></div>
            </div>
        `;
        
        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            .shortcut-help-content {
                background: var(--bg-primary, #1a1a2e);
                border-radius: 12px;
                padding: 20px;
                max-width: 600px;
                max-height: 80vh;
                overflow-y: auto;
                border: 1px solid var(--border-color, #333);
            }
            .shortcut-help-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding-bottom: 10px;
                border-bottom: 1px solid var(--border-color, #333);
            }
            .shortcut-help-header h2 {
                margin: 0;
                color: var(--text-primary, #fff);
            }
            .shortcut-item {
                display: flex;
                justify-content: space-between;
                padding: 8px 12px;
                margin: 4px 0;
                background: var(--bg-secondary, #16213e);
                border-radius: 6px;
            }
            .shortcut-key {
                font-family: monospace;
                background: var(--bg-tertiary, #0f3460);
                padding: 4px 8px;
                border-radius: 4px;
                color: var(--accent-color, #00ffcc);
            }
            .shortcut-desc {
                color: var(--text-secondary, #aaa);
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(dialog);
        
        // 点击遮罩关闭
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                this.hideHelp();
            }
        });
        
        this.helpDialog = dialog;
    }

    /**
     * 更新帮助对话框内容
     */
    updateHelpContent() {
        const list = document.getElementById('shortcut-list');
        if (!list) return;
        
        const categories = {
            '工具': ['v', 'r', 'p', 'b', 'k', 's'],
            '编辑': ['ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z', 'ctrl+y', 'delete'],
            '视图': ['+', '-', '=','f', 'h'],
            '其他': ['?']
        };
        
        let html = '';
        
        // 工具类
        html += '<h3>工具</h3>';
        html += this.renderShortcutItem('V', '选择工具');
        html += this.renderShortcutItem('R', '矩形框标注');
        html += this.renderShortcutItem('P', '多边形标注');
        html += this.renderShortcutItem('B', '画笔标注');
        html += this.renderShortcutItem('K', '关键点标注');
        
        // 编辑类
        html += '<h3>编辑</h3>';
        html += this.renderShortcutItem('Ctrl + C', '复制标注');
        html += this.renderShortcutItem('Ctrl + V', '粘贴标注');
        html += this.renderShortcutItem('Ctrl + X', '剪切标注');
        html += this.renderShortcutItem('Ctrl + Z', '撤销');
        html += this.renderShortcutItem('Ctrl + Y', '重做');
        html += this.renderShortcutItem('Delete', '删除选中');
        
        // 视图类
        html += '<h3>视图</h3>';
        html += this.renderShortcutItem('+ / =', '放大');
        html += this.renderShortcutItem('-', '缩小');
        html += this.renderShortcutItem('F', '适应窗口');
        
        // 其他
        html += '<h3>其他</h3>';
        html += this.renderShortcutItem('?', '显示快捷键帮助');
        
        list.innerHTML = html;
    }

    /**
     * 渲染单个快捷键项
     */
    renderShortcutItem(key, desc) {
        return `
            <div class="shortcut-item">
                <span class="shortcut-desc">${desc}</span>
                <span class="shortcut-key">${key}</span>
            </div>
        `;
    }

    /**
     * 更新帮助对话框（注册时调用）
     */
    updateHelpDialog() {
        if (this.helpDialog) {
            this.updateHelpContent();
        }
    }

    /**
     * 启用快捷键
     */
    enable() {
        this.enabled = true;
    }

    /**
     * 禁用快捷键
     */
    disable() {
        this.enabled = false;
    }
}

// 全局快捷键管理器实例
window.ShortcutManager = new ShortcutManager();

// 兼容静态方法调用（ShortcutManager.register()）
ShortcutManager.register = function(key, handler, description) {
    return window.ShortcutManager.register(key, handler, description);
};

ShortcutManager.unregister = function(key) {
    return window.ShortcutManager.unregister(key);
};

ShortcutManager.handleKeydown = function(e) {
    return window.ShortcutManager.handleKeydown(e);
};

ShortcutManager.showHelp = function() {
    return window.ShortcutManager.showHelp();
};

ShortcutManager.hideHelp = function() {
    return window.ShortcutManager.hideHelp();
};
