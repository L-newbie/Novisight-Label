// ============================================
// Novisight Label - 历史记录管理模块
// ============================================

/**
 * 历史记录管理类 - 支持撤销/重做
 */
class HistoryManager {
    constructor(maxSize = 50) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxSize = maxSize;
        this.isUndoing = false;
    }

    /**
     * 保存当前状态到历史记录
     * @param {Array} annotations - 标注数组
     */
    push(annotations) {
        if (this.isUndoing) return;
        
        // 深拷贝状态
        const snapshot = JSON.parse(JSON.stringify(annotations));
        this.undoStack.push(snapshot);
        
        // 限制栈大小
        if (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }
        
        // 新的操作清除redo栈
        this.redoStack = [];
        
        // 发出状态更新事件
        EventBus.emit('history:changed', {
            canUndo: this.canUndo(),
            canRedo: this.canRedo()
        });
    }

    /**
     * 撤销操作
     * @param {Function} applyCallback - 应用状态的回调函数
     * @returns {boolean} 是否成功撤销
     */
    undo(applyCallback) {
        if (!this.canUndo()) return false;
        
        // 保存当前状态到redo栈
        const current = JSON.parse(JSON.stringify(AppState.annotations));
        this.redoStack.push(current);
        
        // 恢复到之前的状态
        const previous = this.undoStack.pop();
        
        this.isUndoing = true;
        applyCallback(previous);
        this.isUndoing = false;
        
        EventBus.emit('history:changed', {
            canUndo: this.canUndo(),
            canRedo: this.canRedo()
        });
        
        return true;
    }

    /**
     * 重做操作
     * @param {Function} applyCallback - 应用状态的回调函数
     * @returns {boolean} 是否成功重做
     */
    redo(applyCallback) {
        if (!this.canRedo()) return false;
        
        // 保存当前状态到undo栈
        const current = JSON.parse(JSON.stringify(AppState.annotations));
        this.undoStack.push(current);
        
        // 恢复到未来的状态
        const next = this.redoStack.pop();
        
        this.isUndoing = true;
        applyCallback(next);
        this.isUndoing = false;
        
        EventBus.emit('history:changed', {
            canUndo: this.canUndo(),
            canRedo: this.canRedo()
        });
        
        return true;
    }

    /**
     * 是否可以撤销
     * @returns {boolean}
     */
    canUndo() {
        return this.undoStack.length > 0;
    }

    /**
     * 是否可以重做
     * @returns {boolean}
     */
    canRedo() {
        return this.redoStack.length > 0;
    }

    /**
     * 清空历史记录
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        EventBus.emit('history:changed', {
            canUndo: false,
            canRedo: false
        });
    }

    /**
     * 获取历史记录状态
     * @returns {Object}
     */
    getState() {
        return {
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            undoCount: this.undoStack.length,
            redoCount: this.redoStack.length
        };
    }
}

// 全局历史管理器实例
window.HistoryManager = HistoryManager;
