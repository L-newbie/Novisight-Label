// ============================================
// Novisight Label - 事件总线模块
// ============================================

/**
 * 统一事件管理类
 */
class EventBus {
    constructor() {
        this.listeners = {};
    }

    /**
     * 订阅事件
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    /**
     * 取消订阅
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    off(event, callback) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event]
            .filter(cb => cb !== callback);
    }

    /**
     * 发布事件
     * @param {string} event - 事件名称
     * @param {*} data - 事件数据
     */
    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(cb => {
            try {
                cb(data);
            } catch (error) {
                console.error(`Event handler error for ${event}:`, error);
            }
        });
    }

    /**
     * 一次性事件订阅
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     */
    once(event, callback) {
        const wrapper = (data) => {
            callback(data);
            this.off(event, wrapper);
        };
        this.on(event, wrapper);
    }
}

// 全局事件总线实例
window.EventBus = new EventBus();

// 兼容静态方法调用（EventBus.on() / EventBus.emit()）
EventBus.on = function(event, callback) {
    return window.EventBus.on(event, callback);
};

EventBus.off = function(event, callback) {
    return window.EventBus.off(event, callback);
};

EventBus.emit = function(event, data) {
    return window.EventBus.emit(event, data);
};

EventBus.once = function(event, callback) {
    return window.EventBus.once(event, callback);
};
