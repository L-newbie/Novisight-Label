// ============================================
// Novisight Label - 导出功能
// ============================================

// 导出数据
async function exportData(format) {
    if (!AppState.currentProject) {
        showToast('请先选择一个项目', 'warning');
        return;
    }
    
    showToast(`正在导出 ${format.toUpperCase()} 格式...`, 'success');
    
    try {
        let exportUrl = '';
        
        switch(format) {
            case 'json':
                exportUrl = `${API_BASE}/api/export/${AppState.currentProject.id}/json`;
                break;
            case 'coco':
                exportUrl = `${API_BASE}/api/export/${AppState.currentProject.id}/coco`;
                break;
            case 'yolo':
                exportUrl = `${API_BASE}/api/export/${AppState.currentProject.id}/yolo`;
                break;
            case 'voc':
                exportUrl = `${API_BASE}/api/export/${AppState.currentProject.id}/voc`;
                break;
            case 'csv':
                exportUrl = `${API_BASE}/api/export/${AppState.currentProject.id}/csv`;
                break;
            default:
                showToast('不支持的导出格式', 'error');
                return;
        }
        
        // 直接下载，不解析JSON响应
        const link = document.createElement('a');
        link.href = exportUrl;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast(`${format.toUpperCase()} 导出成功！`, 'success');
    } catch (error) {
        console.error('导出失败:', error);
        showToast('导出失败，请重试', 'error');
    }
}

// 批量导出
async function batchExport(formats) {
    if (!AppState.currentProject) {
        showToast('请先选择一个项目', 'warning');
        return;
    }
    
    showToast('正在批量导出...', 'success');
    
    for (const format of formats) {
        await exportData(format);
        // 添加延迟避免并发问题
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    showToast('批量导出完成！', 'success');
}

// 预览导出数据
async function previewExport(format) {
    if (!AppState.currentProject) {
        showToast('请先选择一个项目', 'warning');
        return;
    }
    
    try {
        let exportUrl = '';
        
        switch(format) {
            case 'json':
                exportUrl = `${API_BASE}/api/export/${AppState.currentProject.id}/json`;
                break;
            default:
                showToast('仅支持JSON格式预览', 'warning');
                return;
        }
        
        // 直接打开导出URL
        window.open(exportUrl, '_blank');
    } catch (error) {
        console.error('预览失败:', error);
        showToast('预览失败', 'error');
    }
}

// 复制到剪贴板
async function copyToClipboard(format) {
    if (!AppState.currentProject) {
        showToast('请先选择一个项目', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/export/${AppState.currentProject.id}/json`);
        const data = await response.json();
        
        await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
        showToast('已复制到剪贴板', 'success');
    } catch (error) {
        console.error('复制失败:', error);
        showToast('复制失败', 'error');
    }
}

// 生成导出报告
function generateExportReport() {
    if (!AppState.currentProject) return null;
    
    const report = {
        project: AppState.currentProject,
        exportTime: new Date().toISOString(),
        summary: {
            totalTasks: 0,
            annotatedTasks: 0,
            totalAnnotations: 0,
            labels: AppState.labels.length
        }
    };
    
    return report;
}



// 格式化导出选项显示
const ExportFormats = {
    json: {
        name: 'JSON',
        description: '通用JSON格式，保留完整标注信息',
        icon: 'fa-file-code',
        extension: '.json'
    },
    coco: {
        name: 'COCO',
        description: 'Microsoft COCO数据集标准格式',
        icon: 'fa-database',
        extension: '.json'
    },
    yolo: {
        name: 'YOLO',
        description: 'YOLO目标检测训练格式',
        icon: 'fa-robot',
        extension: '.txt/.zip'
    },
    voc: {
        name: 'Pascal VOC',
        description: 'VOC标准XML标注格式',
        icon: 'fa-file-alt',
        extension: '.xml/.zip'
    },
    csv: {
        name: 'CSV',
        description: '逗号分隔值表格格式',
        icon: 'fa-table',
        extension: '.csv'
    }
};

// 导出函数挂载到全局
window.exportData = exportData;
window.batchExport = batchExport;
window.previewExport = previewExport;
window.copyToClipboard = copyToClipboard;
window.ExportFormats = ExportFormats;
