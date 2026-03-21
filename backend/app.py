# -*- coding: utf-8 -*-
"""
Novisight Label - 2D图像和视频流数据标注系统
科技感、时尚感、高互动性、魔幻体验的标注工具

作者: Novisight Team
版本: 1.0.0
"""

import os
import json
import sqlite3
import hashlib
import uuid
import threading
import time
import io
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, render_template, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename

# WebSocket连接管理
connected_clients = set()

def log_broadcast_handler(log_entry):
    """日志广播处理器 - 推送到所有连接的客户端"""
    if connected_clients:
        try:
            socketio.emit('inference_log', log_entry)
        except Exception as e:
            print(f"日志推送错误: {e}")

# ============================================
# 配置常量
# ============================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
UPLOAD_DIR = os.path.join(DATA_DIR, 'uploads')
DATABASE_PATH = os.path.join(DATA_DIR, 'database', 'novisight.db')

# 确保目录存在
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)

# 允许的文件类型
ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'}

# ============================================
# Flask应用配置
# ============================================

app = Flask(__name__, 
            template_folder=os.path.join(PROJECT_ROOT, 'frontend'),
            static_folder=os.path.join(PROJECT_ROOT, 'frontend'),
            static_url_path='')
app.config['SECRET_KEY'] = 'novisight-label-magic-key-2024'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max
app.config['UPLOAD_FOLDER'] = UPLOAD_DIR
app.config['DATABASE_PATH'] = DATABASE_PATH

CORS(app)

# ============================================
# SocketIO 配置
# ============================================
socketio = SocketIO(app, cors_allowed_origins="*")

# ============================================
# 数据库初始化
# ============================================

def get_db_connection(timeout=30):
    """获取数据库连接（带超时和重试机制）"""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            conn = sqlite3.connect(DATABASE_PATH, timeout=timeout)
            return conn
        except sqlite3.OperationalError as e:
            if attempt < max_retries - 1:
                time.sleep(0.5)
                continue
            raise e

def init_database():
    """初始化数据库表结构"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 项目表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            category_id TEXT,
            data_dir TEXT,
            data_type TEXT,
            enable_inference INTEGER DEFAULT 0,
            target_labels TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            FOREIGN KEY (category_id) REFERENCES categories(id)
        )
    ''')
    
    # 分类管理表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY,
            parent_id TEXT,
            name TEXT NOT NULL,
            description TEXT,
            color TEXT DEFAULT '#3498db',
            icon TEXT DEFAULT 'folder',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE
        )
    ''')
    
    # 标签体系表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS labels (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            color TEXT NOT NULL,
            parent_id TEXT,
            attributes TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')
    
    # 标注任务表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_type TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            annotations TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')
    
    # 标注员表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS annotators (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            email TEXT,
            role TEXT DEFAULT 'annotator',
            created_at TEXT NOT NULL
        )
    ''')
    
    # 标注历史记录表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS annotation_history (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            annotator_id TEXT NOT NULL,
            action TEXT NOT NULL,
            details TEXT,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks(id),
            FOREIGN KEY (annotator_id) REFERENCES annotators(id)
        )
    ''')
    
    # 预刷任务表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS inference_tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            task_id TEXT,
            status TEXT DEFAULT 'pending',
            target_labels TEXT,
            annotations TEXT DEFAULT '[]',
            error_message TEXT,
            retry_count INTEGER DEFAULT 0,
            started_at TEXT,
            completed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id),
            FOREIGN KEY (task_id) REFERENCES tasks(id)
        )
    ''')
    
    # 预刷进度表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS inference_progress (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL UNIQUE,
            status TEXT DEFAULT 'pending',
            total_tasks INTEGER DEFAULT 0,
            completed_tasks INTEGER DEFAULT 0,
            failed_tasks INTEGER DEFAULT 0,
            target_labels TEXT,
            error_message TEXT,
            logs TEXT,
            started_at TEXT,
            completed_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')
    
    # 预刷任务队列表（用于排队处理）
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS inference_queue (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            status TEXT DEFAULT 'queued',
            position INTEGER DEFAULT 0,
            target_labels TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        )
    ''')
    
    conn.commit()
    conn.close()
    print(f"数据库初始化完成: {DATABASE_PATH}")

# ============================================
# 工具函数
# ============================================

def resolve_data_dir(data_dir):
    """解析数据目录路径，支持绝对路径和相对路径"""
    if not data_dir:
        return None
    
    # 如果是绝对路径且存在，直接返回
    if os.path.isabs(data_dir) and os.path.isdir(data_dir):
        return data_dir
    
    # 尝试多个可能的根目录
    possible_roots = [
        PROJECT_ROOT,           # 项目根目录
        BASE_DIR,               # backend目录
        os.path.expanduser('~'),  # 用户主目录
        os.path.join(os.path.expanduser('~'), 'Desktop'),  # 桌面
    ]
    
    for root in possible_roots:
        full_path = os.path.join(root, data_dir)
        if os.path.isdir(full_path):
            return full_path
    
    return None

def scan_directory_files(data_dir, project_id, data_type='all'):
    """扫描目录中的文件并返回文件列表"""
    resolved_dir = resolve_data_dir(data_dir)
    if not resolved_dir:
        return [], 0
    
    imported_count = 0
    current_time = get_current_time()
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    for filename in os.listdir(resolved_dir):
        file_path = os.path.join(resolved_dir, filename)
        
        # 跳过目录
        if os.path.isdir(file_path):
            continue
        
        # 检查文件类型
        file_ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        file_type = None
        
        if file_ext in ALLOWED_IMAGE_EXTENSIONS:
            file_type = 'image'
        
        if not file_type:
            continue
        
        # 根据数据类型过滤
        if data_type != 'all' and file_type != data_type:
            continue
        
        # 检查是否已存在
        cursor.execute('SELECT id FROM tasks WHERE project_id = ? AND file_name = ?', 
                     (project_id, filename))
        if cursor.fetchone():
            continue
        
        # 创建任务记录
        task_id = generate_id()
        cursor.execute('''
            INSERT INTO tasks (id, project_id, file_name, file_path, file_type, status, annotations, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (task_id, project_id, filename, file_path, file_type, 'pending', '[]', current_time, current_time))
        
        imported_count += 1
    
    conn.commit()
    conn.close()
    
    return resolved_dir, imported_count

def allowed_file(filename, allowed_extensions):
    """检查文件类型是否允许"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions

def get_file_type(filename):
    """获取文件类型"""
    if allowed_file(filename, ALLOWED_IMAGE_EXTENSIONS):
        return 'image'
    return None

def generate_id():
    """生成唯一ID"""
    return uuid.uuid4().hex

def get_current_time():
    """获取当前时间"""
    return datetime.now().isoformat()

# ============================================
# API路由 - 分类管理
# ============================================

@app.route('/api/categories', methods=['GET'])
def get_categories():
    """获取所有分类列表（树形结构）"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 获取所有分类
    cursor.execute('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC')
    categories = [dict(row) for row in cursor.fetchall()]
    
    # 构建树形结构
    category_map = {}
    root_categories = []
    
    for cat in categories:
        cat['children'] = []
        category_map[cat['id']] = cat
    
    for cat in categories:
        if cat['parent_id'] is None:
            root_categories.append(cat)
        else:
            parent = category_map.get(cat['parent_id'])
            if parent:
                parent['children'].append(cat)
    
    conn.close()
    return jsonify(root_categories)

@app.route('/api/categories', methods=['POST'])
def create_category():
    """创建新分类（一级或二级）"""
    data = request.get_json()
    
    if not data or not data.get('name'):
        return jsonify({'error': '分类名称不能为空'}), 400
    
    category_id = generate_id()
    current_time = get_current_time()
    
    # 获取最大排序号
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    parent_id = data.get('parent_id')
    if parent_id:
        # 二级分类
        cursor.execute('SELECT MAX(sort_order) FROM categories WHERE parent_id = ?', (parent_id,))
    else:
        # 一级分类
        cursor.execute('SELECT MAX(sort_order) FROM categories WHERE parent_id IS NULL')
    
    max_order = cursor.fetchone()[0]
    sort_order = (max_order + 1) if max_order is not None else 0
    
    cursor.execute('''
        INSERT INTO categories (id, parent_id, name, description, color, icon, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        category_id,
        parent_id,
        data.get('name'),
        data.get('description', ''),
        data.get('color', '#3498db'),
        data.get('icon', 'folder'),
        sort_order,
        current_time,
        current_time
    ))
    
    conn.commit()
    conn.close()
    
    return jsonify({'id': category_id, 'message': '分类创建成功'}), 201

@app.route('/api/categories/<category_id>', methods=['PUT'])
def update_category(category_id):
    """更新分类信息"""
    data = request.get_json()
    
    if not data:
        return jsonify({'error': '无效的数据'}), 400
    
    current_time = get_current_time()
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    # 构建更新语句
    update_fields = []
    params = []
    
    if 'name' in data:
        update_fields.append('name = ?')
        params.append(data['name'])
    if 'description' in data:
        update_fields.append('description = ?')
        params.append(data['description'])
    if 'color' in data:
        update_fields.append('color = ?')
        params.append(data['color'])
    if 'icon' in data:
        update_fields.append('icon = ?')
        params.append(data['icon'])
    
    update_fields.append('updated_at = ?')
    params.append(current_time)
    params.append(category_id)
    
    cursor.execute(f'UPDATE categories SET {", ".join(update_fields)} WHERE id = ?', params)
    
    if cursor.rowcount == 0:
        conn.close()
        return jsonify({'error': '分类不存在'}), 404
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': '分类更新成功'})

@app.route('/api/categories/<category_id>', methods=['DELETE'])
def delete_category(category_id):
    """删除分类"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 检查是否有子分类
    cursor.execute('SELECT COUNT(*) FROM categories WHERE parent_id = ?', (category_id,))
    child_count = cursor.fetchone()[0]
    
    if child_count > 0:
        conn.close()
        return jsonify({'error': '该分类下存在子分类，请先删除子分类'}), 400
    
    # 检查是否有项目关联
    cursor.execute('SELECT COUNT(*) FROM projects WHERE category_id = ?', (category_id,))
    project_count = cursor.fetchone()[0]
    
    if project_count > 0:
        conn.close()
        return jsonify({'error': '该分类下存在关联项目，无法删除'}), 400
    
    cursor.execute('DELETE FROM categories WHERE id = ?', (category_id,))
    
    if cursor.rowcount == 0:
        conn.close()
        return jsonify({'error': '分类不存在'}), 404
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': '分类删除成功'})

@app.route('/api/categories/reorder', methods=['PUT'])
def reorder_categories():
    """批量更新分类顺序"""
    data = request.get_json()
    
    if not data or not isinstance(data.get('orders'), list):
        return jsonify({'error': '无效的数据格式'}), 400
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    current_time = get_current_time()
    
    for order_item in data.get('orders'):
        category_id = order_item.get('id')
        sort_order = order_item.get('sort_order', 0)
        
        cursor.execute(
            'UPDATE categories SET sort_order = ?, updated_at = ? WHERE id = ?',
            (sort_order, current_time, category_id)
        )
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': '分类排序更新成功'})

@app.route('/api/categories/<category_id>/labels', methods=['GET'])
def get_category_labels(category_id):
    """获取分类下的所有标签（二级分类）"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 获取该分类下的所有二级分类
    cursor.execute('''
        SELECT * FROM categories 
        WHERE parent_id = ? 
        ORDER BY sort_order ASC, created_at ASC
    ''', (category_id,))
    
    labels = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    return jsonify(labels)

# ============================================
# API路由 - 项目管理
# ============================================

@app.route('/')
def index():
    """主页"""
    return render_template('index.html')

@app.route('/api/projects', methods=['GET'])
def get_projects():
    """获取所有项目"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM projects ORDER BY created_at DESC')
    projects = [dict(row) for row in cursor.fetchall()]
    
    # 获取每个项目的任务统计和预刷进度
    for project in projects:
        cursor.execute('''
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
            FROM tasks WHERE project_id = ?
        ''', (project['id'],))
        stats = cursor.fetchone()
        project['task_stats'] = dict(stats) if stats else {'total': 0, 'completed': 0, 'pending': 0}
        
        # 获取预刷进度
        cursor.execute('''
            SELECT status, total_tasks, completed_tasks, failed_tasks,
                   error_message, logs, started_at, completed_at
            FROM inference_progress WHERE project_id = ?
        ''', (project['id'],))
        inference_progress = cursor.fetchone()
        if inference_progress:
            project['inference_progress'] = dict(inference_progress)
        else:
            project['inference_progress'] = None
        
        # 获取队列位置（重新计算实际位置）
        cursor.execute('''
            SELECT COUNT(*) as position FROM inference_queue
            WHERE status = 'queued'
            AND created_at < (
                SELECT created_at FROM inference_queue
                WHERE project_id = ? AND status = 'queued'
                LIMIT 1
            )
        ''', (project['id'],))
        queue_info = cursor.fetchone()
        if queue_info and queue_info['position'] is not None:
            # 位置是从0开始的，所以要加1
            project['queue_position'] = queue_info['position'] + 1
        else:
            # 检查项目是否在队列中
            cursor.execute('''
                SELECT 1 FROM inference_queue
                WHERE project_id = ? AND status = 'queued'
            ''', (project['id'],))
            if cursor.fetchone():
                project['queue_position'] = 1
            else:
                project['queue_position'] = None
    
    conn.close()
    return jsonify({'success': True, 'data': projects})

@app.route('/api/projects', methods=['POST'])
def create_project():
    """创建新项目"""
    data = request.json
    project_id = generate_id()
    current_time = get_current_time()
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    # 检查projects表是否有category_id列
    cursor.execute("PRAGMA table_info(projects)")
    columns = [col[1] for col in cursor.fetchall()]
    
    # 处理预刷选项
    enable_inference = data.get('enable_inference', False)
    target_labels = data.get('target_labels', [])
    
    if 'category_id' in columns:
        if 'enable_inference' in columns and 'target_labels' in columns:
            # 新表结构（包含预刷字段）
            cursor.execute('''
                INSERT INTO projects (id, name, description, category_id, data_dir, data_type, 
                                   enable_inference, target_labels, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, data['name'], data.get('description', ''), 
                  data.get('category_id'), data.get('data_dir', ''), data.get('data_type', 'all'),
                  1 if enable_inference else 0, 
                  json.dumps(target_labels) if target_labels else '',
                  current_time, current_time))
        else:
            # 旧表结构（向后兼容，没有预刷字段）
            cursor.execute('''
                INSERT INTO projects (id, name, description, category_id, data_dir, data_type, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (project_id, data['name'], data.get('description', ''), 
                  data.get('category_id'), data.get('data_dir', ''), data.get('data_type', 'all'), current_time, current_time))
    else:
        # 旧表结构（向后兼容）
        cursor.execute('''
            INSERT INTO projects (id, name, description, category, data_dir, data_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (project_id, data['name'], data.get('description', ''), 
              data.get('category_id', ''), data.get('data_dir', ''), data.get('data_type', 'all'), current_time, current_time))
    
    conn.commit()
    
    # 如果指定了分类，自动从分类创建标签体系
    category_id = data.get('category_id')
    if category_id:
        # 设置row_factory以支持字典访问
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # 获取分类下的所有二级分类作为标签
        cursor.execute('''
            SELECT * FROM categories 
            WHERE parent_id = ? 
            ORDER BY sort_order ASC, created_at ASC
        ''', (category_id,))
        sub_categories = cursor.fetchall()
        
        # 重置row_factory用于后续操作
        conn.row_factory = None
        cursor = conn.cursor()
        
        # 为每个二级分类创建标签
        for sub_cat in sub_categories:
            label_id = generate_id()
            cursor.execute('''
                INSERT INTO labels (id, project_id, name, color, parent_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (label_id, project_id, sub_cat['name'], sub_cat['color'], sub_cat['id'], current_time))
    
    conn.commit()
    
    # 如果指定了数据目录，自动扫描导入文件
    data_dir = data.get('data_dir', '')
    data_type = data.get('data_type', 'all')
    imported_count = 0
    resolved_dir = None
    
    if data_dir:
        resolved_dir, imported_count = scan_directory_files(data_dir, project_id, data_type)
        
        # 如果成功解析路径，更新数据库中的路径为解析后的绝对路径
        if resolved_dir and resolved_dir != data_dir:
            cursor.execute('UPDATE projects SET data_dir = ? WHERE id = ?', (resolved_dir, project_id))
            conn.commit()
    
    # 处理预刷选项
    enable_inference = data.get('enable_inference', False)
    target_labels = data.get('target_labels', [])
    
    # 如果启用了预刷，创建预刷进度记录
    inference_progress_id = None
    if enable_inference and target_labels and imported_count > 0:
        cursor.execute('''
            INSERT INTO inference_progress 
            (id, project_id, status, total_tasks, target_labels, started_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            generate_id(),
            project_id,
            'pending',
            imported_count,
            json.dumps(target_labels),
            current_time,
            current_time,
            current_time
        ))
        conn.commit()
    
    conn.commit()
    conn.close()
    
    response_data = {
        'success': True, 
        'data': {'id': project_id, 'imported_count': imported_count}
    }
    
    # 如果启用了预刷，在响应中返回相关信息
    if enable_inference and target_labels and imported_count > 0:
        response_data['data']['inference_enabled'] = True
        response_data['data']['target_labels'] = target_labels
    
    return jsonify(response_data)

@app.route('/api/projects/<project_id>', methods=['PUT'])
def update_project(project_id):
    """更新项目信息"""
    data = request.json
    current_time = get_current_time()
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    # 获取现有项目信息
    cursor.execute('SELECT data_dir FROM projects WHERE id = ?', (project_id,))
    old_project = cursor.fetchone()
    old_data_dir = old_project[0] if old_project else ''
    
    # 如果数据目录变化，扫描新目录
    new_data_dir = data.get('data_dir', '')
    new_data_type = data.get('data_type', 'all')
    imported_count = 0
    resolved_dir = None
    
    # 获取旧的数据类型
    cursor.execute('SELECT data_type FROM projects WHERE id = ?', (project_id,))
    old_result = cursor.fetchone()
    old_data_type = old_result[0] if old_result else 'all'
    
    # 如果数据目录或数据类型变化，扫描新目录
    if new_data_dir and (new_data_dir != old_data_dir or new_data_type != old_data_type):
        resolved_dir, imported_count = scan_directory_files(new_data_dir, project_id, new_data_type)
        # 如果成功解析路径，使用解析后的路径更新
        if resolved_dir:
            data['data_dir'] = resolved_dir
    
    # 更新项目信息
    cursor.execute("PRAGMA table_info(projects)")
    columns = [col[1] for col in cursor.fetchall()]
    
    # 处理预刷配置
    enable_inference = data.get('enable_inference', 0)
    target_labels = data.get('target_labels', [])
    if isinstance(target_labels, list):
        target_labels = json.dumps(target_labels)
    
    if 'category_id' in columns:
        if 'enable_inference' in columns and 'target_labels' in columns:
            # 新表结构
            cursor.execute('''
                UPDATE projects 
                SET name = ?, description = ?, category_id = ?, data_dir = ?, data_type = ?, 
                    enable_inference = ?, target_labels = ?, updated_at = ?
                WHERE id = ?
            ''', (data.get('name'), data.get('description', ''), 
                  data.get('category_id'), data.get('data_dir', ''), data.get('data_type', 'all'),
                  enable_inference, target_labels,
                  current_time, project_id))
        else:
            cursor.execute('''
                UPDATE projects 
                SET name = ?, description = ?, category_id = ?, data_dir = ?, data_type = ?, updated_at = ?
                WHERE id = ?
            ''', (data.get('name'), data.get('description', ''), 
                  data.get('category_id'), data.get('data_dir', ''), data.get('data_type', 'all'),
                  current_time, project_id))
    else:
        cursor.execute('''
            UPDATE projects 
            SET name = ?, description = ?, category = ?, data_dir = ?, data_type = ?, updated_at = ?
            WHERE id = ?
        ''', (data.get('name'), data.get('description', ''), 
              data.get('category_id', ''), data.get('data_dir', ''), data.get('data_type', 'all'),
              current_time, project_id))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'success': True,
        'data': {'imported_count': imported_count}
    })

@app.route('/api/projects/<project_id>', methods=['GET'])
def get_project(project_id):
    """获取单个项目详情"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    project = cursor.fetchone()
    
    # 获取项目标签
    cursor.execute('SELECT * FROM labels WHERE project_id = ?', (project_id,))
    labels = [dict(row) for row in cursor.fetchall()]
    
    # 获取项目任务数量
    cursor.execute('SELECT COUNT(*) as total, SUM(CASE WHEN status = "completed" THEN 1 ELSE 0 END) as completed FROM tasks WHERE project_id = ?', (project_id,))
    task_stats = dict(cursor.fetchone())
    
    conn.close()
    
    if project:
        return jsonify({
            'success': True,
            'data': {
                'project': dict(project),
                'labels': labels,
                'task_stats': task_stats
            }
        })
    return jsonify({'success': False, 'error': 'Project not found'}), 404

@app.route('/api/projects/<project_id>', methods=['DELETE'])
def delete_project(project_id):
    """删除项目"""
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    cursor.execute('DELETE FROM labels WHERE project_id = ?', (project_id,))
    cursor.execute('DELETE FROM tasks WHERE project_id = ?', (project_id,))
    cursor.execute('DELETE FROM projects WHERE id = ?', (project_id,))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

# ============================================
# API路由 - 标签管理
# ============================================

@app.route('/api/projects/<project_id>/labels', methods=['GET'])
def get_labels(project_id):
    """获取项目标签"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM labels WHERE project_id = ?', (project_id,))
    labels = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    return jsonify({'success': True, 'data': labels})

@app.route('/api/projects/<project_id>/labels', methods=['POST'])
def create_label(project_id):
    """创建标签"""
    data = request.json
    label_id = generate_id()
    current_time = get_current_time()
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO labels (id, project_id, name, color, parent_id, attributes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (label_id, project_id, data['name'], data.get('color', '#00ffcc'),
          data.get('parent_id'), json.dumps(data.get('attributes', {})), current_time))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'success': True,
        'data': {'id': label_id, 'name': data['name']}
    })

@app.route('/api/projects/<project_id>/labels/<label_id>', methods=['DELETE'])
def delete_label(project_id, label_id):
    """删除标签"""
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    cursor.execute('DELETE FROM labels WHERE id = ?', (label_id,))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

# ============================================
# API路由 - 任务管理
# ============================================

@app.route('/api/projects/<project_id>/tasks', methods=['GET'])
def get_tasks(project_id):
    """获取项目任务列表"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC', (project_id,))
    tasks = [dict(row) for row in cursor.fetchall()]
    
    # 解析annotations JSON
    for task in tasks:
        task['annotations'] = json.loads(task['annotations']) if task['annotations'] else []
    
    conn.close()
    return jsonify({'success': True, 'data': tasks})

@app.route('/api/projects/<project_id>/tasks', methods=['POST'])
def upload_task(project_id):
    """上传任务文件"""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400
    
    filename = secure_filename(file.filename)
    file_type = get_file_type(filename)
    
    if not file_type:
        return jsonify({'success': False, 'error': 'Unsupported file type'}), 400
    
    # 生成唯一文件名
    file_id = generate_id()
    ext = filename.rsplit('.', 1)[1].lower()
    saved_filename = f"{file_id}.{ext}"
    file_path = os.path.join(UPLOAD_DIR, saved_filename)
    
    # 保存文件
    file.save(file_path)
    
    # 创建任务记录
    task_id = generate_id()
    current_time = get_current_time()
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO tasks (id, project_id, file_name, file_path, file_type, status, annotations, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (task_id, project_id, filename, saved_filename, file_type, 'pending', '[]', current_time, current_time))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'success': True,
        'data': {
            'id': task_id,
            'file_name': filename,
            'file_type': file_type,
            'file_path': f"/data/uploads/{saved_filename}"
        }
    })

@app.route('/api/tasks/<task_id>', methods=['GET'])
def get_task(task_id):
    """获取任务详情"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM tasks WHERE id = ?', (task_id,))
    task = cursor.fetchone()
    
    if task:
        task_dict = dict(task)
        task_dict['annotations'] = json.loads(task['annotations']) if task['annotations'] else []
        
        # 获取项目标签
        cursor.execute('SELECT * FROM labels WHERE project_id = ?', (task['project_id'],))
        labels = [dict(row) for row in cursor.fetchall()]
        
        conn.close()
        return jsonify({
            'success': True,
            'data': {
                'task': task_dict,
                'labels': labels
            }
        })
    
    conn.close()
    return jsonify({'success': False, 'error': 'Task not found'}), 404

@app.route('/api/tasks/<task_id>/annotations', methods=['PUT'])
def update_annotations(task_id):
    """更新标注数据"""
    data = request.json
    current_time = get_current_time()
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        UPDATE tasks 
        SET annotations = ?, status = ?, updated_at = ?
        WHERE id = ?
    ''', (json.dumps(data.get('annotations', [])), 
          data.get('status', 'pending'),
          current_time, task_id))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/tasks/<task_id>', methods=['DELETE'])
def delete_task(task_id):
    """删除任务"""
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    # 获取文件路径
    cursor.execute('SELECT file_path FROM tasks WHERE id = ?', (task_id,))
    result = cursor.fetchone()
    
    if result:
        file_path = os.path.join(UPLOAD_DIR, result[0])
        if os.path.exists(file_path):
            os.remove(file_path)
    
    cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
    
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

# ============================================
# API路由 - 数据导出
# ============================================

@app.route('/api/export/<project_id>/json', methods=['GET'])
def export_json(project_id):
    """导出为JSON格式"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM tasks WHERE project_id = ?', (project_id,))
    tasks = [dict(row) for row in cursor.fetchall()]
    
    for task in tasks:
        task['annotations'] = json.loads(task['annotations']) if task['annotations'] else []
    
    cursor.execute('SELECT * FROM labels WHERE project_id = ?', (project_id,))
    labels = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    project = dict(cursor.fetchone())
    
    conn.close()
    
    export_data = {
        'project': project,
        'labels': labels,
        'tasks': tasks,
        'export_time': get_current_time()
    }
    
    # 直接返回数据，不保存到文件
    json_str = json.dumps(export_data, ensure_ascii=False, indent=2)
    json_bytes = json_str.encode('utf-8')
    
    return send_file(
        io.BytesIO(json_bytes),
        mimetype='application/json',
        as_attachment=True,
        download_name=f'export_{project_id}_{get_current_time().replace(":", "-")}.json'
    )

@app.route('/api/export/<project_id>/coco', methods=['GET'])
def export_coco(project_id):
    """导出为COCO格式"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM labels WHERE project_id = ?', (project_id,))
    labels = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute('SELECT id, file_name, annotations FROM tasks WHERE project_id = ?', (project_id,))
    tasks = cursor.fetchall()
    
    conn.close()
    
    # COCO格式转换
    coco_images = []
    coco_annotations = []
    coco_categories = []
    
    annotation_id = 1
    
    for label in labels:
        coco_categories.append({
            'id': len(coco_categories) + 1,
            'name': label['name'],
            'color': label['color']
        })
    
    for idx, task in enumerate(tasks):
        annotations = json.loads(task['annotations']) if task['annotations'] else []
        
        if annotations:
            coco_images.append({
                'id': idx + 1,
                'file_name': task['file_name'],
                'width': 1920,
                'height': 1080
            })
            
            for ann in annotations:
                if ann.get('type') == 'bbox':
                    bbox = ann.get('bbox', [0, 0, 0, 0])
                    # 检测 bbox 格式: xyxy 或 xywh
                    if len(bbox) == 4 and bbox[2] > bbox[0] and bbox[3] > bbox[1]:
                        # xyxy 格式，转换为 xywh
                        x, y, x2, y2 = bbox
                        w = x2 - x
                        h = y2 - y
                    else:
                        # xywh 格式
                        x, y, w, h = bbox
                    coco_annotations.append({
                        'id': annotation_id,
                        'image_id': idx + 1,
                        'category_id': next((c['id'] for c in coco_categories if c['name'] == ann.get('label')), 1),
                        'bbox': [x, y, w, h],
                        'area': w * h,
                        'iscrowd': 0
                    })
                    annotation_id += 1
    
    coco_data = {
        'images': coco_images,
        'annotations': coco_annotations,
        'categories': coco_categories
    }
    
    # 直接返回数据，不保存到文件
    json_str = json.dumps(coco_data, ensure_ascii=False, indent=2)
    json_bytes = json_str.encode('utf-8')
    
    return send_file(
        io.BytesIO(json_bytes),
        mimetype='application/json',
        as_attachment=True,
        download_name=f'coco_{project_id}_{get_current_time().replace(":", "-")}.json'
    )

@app.route('/api/export/<project_id>/yolo', methods=['GET'])
def export_yolo(project_id):
    """导出为YOLO格式"""
    import zipfile
    import io
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM labels WHERE project_id = ?', (project_id,))
    labels = [dict(row) for row in cursor.fetchall()]
    
    cursor.execute('SELECT id, file_name, annotations FROM tasks WHERE project_id = ?', (project_id,))
    tasks = cursor.fetchall()
    
    conn.close()
    
    # 创建ZIP文件
    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        # 写入类别文件
        class_names = [label['name'] for label in labels]
        zf.writestr('classes.txt', '\n'.join(class_names))
        
        # 写入每个任务的标注文件
        for idx, task in enumerate(tasks):
            annotations = json.loads(task['annotations']) if task['annotations'] else []
            
            label_lines = []
            for ann in annotations:
                if ann.get('type') == 'bbox':
                    bbox = ann.get('bbox', [0, 0, 0, 0])
                    # 检测 bbox 格式: xyxy 或 xywh
                    if len(bbox) == 4 and bbox[2] > bbox[0] and bbox[3] > bbox[1]:
                        # xyxy 格式，转换为 xywh
                        x, y, x2, y2 = bbox
                        w = x2 - x
                        h = y2 - y
                    else:
                        # xywh 格式
                        x, y, w, h = bbox
                    # YOLO格式: class_id x_center y_center width height (normalized)
                    label_id = next((i for i, l in enumerate(labels) if l['name'] == ann.get('label')), 0)
                    x_center = (x + w / 2) / 1920
                    y_center = (y + h / 2) / 1080
                    width = w / 1920
                    height = h / 1080
                    label_lines.append(f"{label_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}")
            
            if label_lines:
                txt_filename = os.path.splitext(task['file_name'])[0] + '.txt'
                zf.writestr(f'labels/{txt_filename}', '\n'.join(label_lines))
    
    zip_buffer.seek(0)
    
    # 直接返回数据，不保存到文件
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'yolo_{project_id}_{get_current_time().replace(":", "-")}.zip'
    )

@app.route('/api/export/<project_id>/voc', methods=['GET'])
def export_voc(project_id):
    """导出为Pascal VOC格式"""
    import zipfile
    import io
    from xml.etree.ElementTree import Element, SubElement, ElementTree
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, file_name, annotations FROM tasks WHERE project_id = ?', (project_id,))
    tasks = cursor.fetchall()
    
    conn.close()
    
    # 创建ZIP文件
    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for idx, task in enumerate(tasks):
            annotations = json.loads(task['annotations']) if task['annotations'] else []
            
            # 创建VOC XML
            annotation = Element('annotation')
            
            folder = SubElement(annotation, 'folder')
            folder.text = 'images'
            
            filename = SubElement(annotation, 'filename')
            filename.text = task['file_name']
            
            size = SubElement(annotation, 'size')
            width = SubElement(size, 'width')
            width.text = '1920'
            height = SubElement(size, 'height')
            height.text = '1080'
            depth = SubElement(size, 'depth')
            depth.text = '3'
            
            for ann in annotations:
                if ann.get('type') == 'bbox':
                    bbox = ann.get('bbox', [0, 0, 0, 0])
                    # 检测 bbox 格式: xyxy 或 xywh
                    if len(bbox) == 4 and bbox[2] > bbox[0] and bbox[3] > bbox[1]:
                        # xyxy 格式
                        x, y, x2, y2 = bbox
                    else:
                        # xywh 格式，转换为 xyxy
                        x, y, w, h = bbox
                        x2 = x + w
                        y2 = y + h
                    
                    obj = SubElement(annotation, 'object')
                    name = SubElement(obj, 'name')
                    name.text = ann.get('label', 'object')
                    
                    bndbox = SubElement(obj, 'bndbox')
                    xmin = SubElement(bndbox, 'xmin')
                    xmin.text = str(int(x))
                    ymin = SubElement(bndbox, 'ymin')
                    ymin.text = str(int(y))
                    xmax = SubElement(bndbox, 'xmax')
                    xmax.text = str(int(x2))
                    ymax = SubElement(bndbox, 'ymax')
                    ymax.text = str(int(y2))
            
            xml_filename = os.path.splitext(task['file_name'])[0] + '.xml'
            xml_str = ElementTree.tostring(annotation, encoding='unicode')
            zf.writestr(f'Annotations/{xml_filename}', xml_str)
    
    zip_buffer.seek(0)
    
    # 直接返回数据，不保存到文件
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'voc_{project_id}_{get_current_time().replace(":", "-")}.zip'
    )

@app.route('/api/export/<project_id>/csv', methods=['GET'])
def export_csv(project_id):
    """导出为CSV格式"""
    import csv
    import io
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT id, file_name, annotations FROM tasks WHERE project_id = ?', (project_id,))
    tasks = cursor.fetchall()
    
    conn.close()
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # 写入表头
    writer.writerow(['filename', 'label', 'x', 'y', 'width', 'height', 'type'])
    
    # 写入数据
    for task in tasks:
        annotations = json.loads(task['annotations']) if task['annotations'] else []
        
        if annotations:
            for ann in annotations:
                if ann.get('type') == 'bbox':
                    bbox = ann.get('bbox', [0, 0, 0, 0])
                    # 检测 bbox 格式: xyxy 或 xywh
                    if len(bbox) == 4 and bbox[2] > bbox[0] and bbox[3] > bbox[1]:
                        # xyxy 格式，转换为 xywh
                        x, y, x2, y2 = bbox
                        w = x2 - x
                        h = y2 - y
                    else:
                        # xywh 格式
                        x, y, w, h = bbox
                    writer.writerow([
                        task['file_name'],
                        ann.get('label', ''),
                        x, y, w, h,
                        ann.get('type', 'bbox')
                    ])
    
    # 直接返回数据，不保存到文件
    csv_bytes = output.getvalue().encode('utf-8')
    
    return send_file(
        io.BytesIO(csv_bytes),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'export_{project_id}_{get_current_time().replace(":", "-")}.csv'
    )

# ============================================
# API路由 - 扫描文件
# ============================================

@app.route('/api/projects/<project_id>/tasks/scan', methods=['POST'])
def scan_uploaded_files(project_id):
    """扫描绑定目录，同步文件列表"""
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    # 获取项目绑定的数据目录和数据类型
    cursor.execute('SELECT data_dir, data_type FROM projects WHERE id = ?', (project_id,))
    project = cursor.fetchone()
    data_dir = project[0] if project and project[0] else ''
    data_type = project[1] if project and len(project) > 1 else 'all'
    
    imported_count = 0
    removed_count = 0
    current_time = get_current_time()
    
    # 扫描目录中的文件
    existing_files = set()
    resolved_dir = None
    
    # 解析数据目录路径
    resolved_dir = resolve_data_dir(data_dir)
    
    if resolved_dir and os.path.isdir(resolved_dir):
        for filename in os.listdir(resolved_dir):
            file_path = os.path.join(resolved_dir, filename)
            
            # 跳过目录
            if os.path.isdir(file_path):
                continue
            
            existing_files.add(filename)
            
            # 检查文件类型
            file_ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
            file_type = None
            
            if file_ext in ALLOWED_IMAGE_EXTENSIONS:
                file_type = 'image'
            
            if not file_type:
                continue
            
            # 根据数据类型过滤
            if data_type != 'all' and file_type != data_type:
                continue
            
            # 检查是否已存在
            cursor.execute('SELECT id FROM tasks WHERE project_id = ? AND file_name = ?', 
                         (project_id, filename))
            if cursor.fetchone():
                continue
            
            # 创建任务记录
            task_id = generate_id()
            cursor.execute('''
                INSERT INTO tasks (id, project_id, file_name, file_path, file_type, status, annotations, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (task_id, project_id, filename, file_path, file_type, 'pending', '[]', current_time, current_time))
            
            imported_count += 1
    
    # 如果data_dir被解析为新的路径，更新数据库
    if resolved_dir and resolved_dir != data_dir:
        cursor.execute('UPDATE projects SET data_dir = ? WHERE id = ?', (resolved_dir, project_id))
    
    # 检查并删除不存在的文件记录
    cursor.execute('SELECT id, file_name FROM tasks WHERE project_id = ?', (project_id,))
    tasks = cursor.fetchall()
    for task_id, filename in tasks:
        if filename not in existing_files:
            cursor.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
            removed_count += 1
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'success': True,
        'data': {'imported_count': imported_count, 'removed_count': removed_count}
    })

# ============================================
# 静态文件服务
# ============================================

@app.route('/data/uploads/<path:filename>')
def serve_upload(filename):
    """提供上传文件服务"""
    return send_from_directory(UPLOAD_DIR, filename)

@app.route('/api/files/<task_id>')
def serve_task_file(task_id):
    """提供任务文件服务（支持外部目录）"""
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    cursor.execute('SELECT file_path, file_type FROM tasks WHERE id = ?', (task_id,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return jsonify({'success': False, 'error': 'Task not found'}), 404
    
    file_path, file_type = result
    
    # 如果是绝对路径且文件存在，直接服务
    if os.path.isabs(file_path) and os.path.exists(file_path):
        directory = os.path.dirname(file_path)
        filename = os.path.basename(file_path)
        return send_from_directory(directory, filename)
    
    # 否则尝试作为相对路径处理
    return send_from_directory(UPLOAD_DIR, file_path)

# ============================================
# WebSocket事件处理
# ============================================

@socketio.on('connect')
def handle_connect():
    """客户端连接"""
    connected_clients.add(request.sid)
    print(f"WebSocket客户端连接: {request.sid}, 当前连接数: {len(connected_clients)}")
    
    # 发送欢迎消息和当前服务状态
    from infer_service import get_service_status, get_device_info, get_logs, add_log_handler
    
    # 添加日志处理器
    add_log_handler(log_broadcast_handler)
    
    emit('connected', {
        'status': 'connected',
        'service_status': get_service_status(),
        'device_info': get_device_info()
    })

@socketio.on('disconnect')
def handle_disconnect():
    """客户端断开连接"""
    connected_clients.discard(request.sid)
    print(f"WebSocket客户端断开: {request.sid}, 当前连接数: {len(connected_clients)}")

@socketio.on('request_logs')
def handle_request_logs(data):
    """请求日志历史"""
    from infer_service import get_logs
    level = data.get('level') if data else None
    limit = data.get('limit', 100) if data else 100
    logs = get_logs(level, limit)
    emit('log_history', {'logs': logs})

@socketio.on('set_log_level')
def handle_set_log_level(data):
    """设置日志级别"""
    from infer_service import inference_service
    level = data.get('level', 'INFO')
    inference_service.set_log_level(level)
    emit('log_level_changed', {'level': level})

@socketio.on('get_service_status')
def handle_get_status():
    """获取服务状态"""
    from infer_service import get_service_status, get_device_info
    emit('service_status', {
        'status': get_service_status(),
        'device': get_device_info()
    })

# ============================================
# API路由 - 推理服务
# ============================================

# 服务启动时初始化推理引擎
def init_inference_service():
    """初始化推理服务"""
    from infer_service import initialize_service, add_log_handler
    
    # 添加日志处理器
    add_log_handler(log_broadcast_handler)
    
    # 初始化服务
    success = initialize_service()
    
    if success:
        print("YOLOv8 world推理服务初始化成功!")
    else:
        print("YOLOv8 world推理服务初始化失败!")
    
    return success

# 在后台线程初始化（避免阻塞主应用启动）
def start_inference_service_async():
    """异步启动推理服务"""
    import threading
    thread = threading.Thread(target=init_inference_service, daemon=True)
    thread.start()

# 应用启动时自动初始化
start_inference_service_async()

@app.route('/api/inference/infer', methods=['POST'])
def inference_single_image():
    """
    单张图像推理API - 使用YOLOv8本地模型
    
    请求体:
    {
        "image_path": "图像文件路径",
        "target_labels": ["标签1", "标签2", ...],
        "confidence": 0.25 (可选，置信度阈值)
    }
    """
    from infer_service import inference_service, log_manager
    
    data = request.json
    
    if not data:
        return jsonify({'success': False, 'error': '无效的请求数据'}), 400
    
    image_path = data.get('image_path')
    target_labels = data.get('target_labels', [])
    confidence = data.get('confidence')
    
    if not image_path:
        return jsonify({'success': False, 'error': '图像路径不能为空'}), 400
    
    if not target_labels:
        return jsonify({'success': False, 'error': '目标分类不能为空'}), 400
    
    # 处理路径
    if not os.path.isabs(image_path):
        image_path = os.path.join(UPLOAD_DIR, image_path)
    
    if not os.path.exists(image_path):
        return jsonify({'success': False, 'error': '图像文件不存在'}), 404
    
    try:
        log_manager.info(f"收到推理请求: {image_path}")
        log_manager.debug(f"目标标签: {target_labels}, 置信度: {confidence}")
        
        # 执行推理
        result = inference_service.infer(
            image_path=image_path,
            target_labels=target_labels,
            confidence=confidence
        )
        
        if result.get('success'):
            return jsonify({
                'success': True,
                'data': {
                    'image_path': result['image_path'],
                    'annotations': result['annotations'],
                    'count': result['count'],
                    'stats': result['stats']
                }
            })
        else:
            return jsonify({
                'success': False,
                'error': result.get('error', '推理失败')
            }), 500
            
    except Exception as e:
        log_manager.error(f"推理失败: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'推理失败: {str(e)}'
        }), 500


@app.route('/api/inference/task/<task_id>', methods=['POST'])
def inference_single_task(task_id):
    """
    对单个任务进行推理 - 使用YOLOv8本地模型
    
    请求体:
    {
        "target_labels": ["标签1", "标签2", ...],
        "confidence": 0.25 (可选)
    }
    """
    from infer_service import inference_service, log_manager
    
    data = request.json or {}
    target_labels = data.get('target_labels', [])
    confidence = data.get('confidence')
    
    if not target_labels:
        return jsonify({'success': False, 'error': '目标分类不能为空'}), 400
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 获取任务信息
    cursor.execute('SELECT * FROM tasks WHERE id = ?', (task_id,))
    task = cursor.fetchone()
    
    if not task:
        conn.close()
        return jsonify({'success': False, 'error': '任务不存在'}), 404
    
    task_dict = dict(task)
    conn.close()
    
    image_path = task_dict['file_path']
    
    if not os.path.exists(image_path):
        return jsonify({'success': False, 'error': '图像文件不存在'}), 404
    
    try:
        log_manager.info(f"收到任务推理请求: task_id={task_id}")
        
        # 执行推理
        result = inference_service.infer(
            image_path=image_path,
            target_labels=target_labels,
            confidence=confidence
        )
        
        if result.get('success'):
            annotations = result.get('annotations', [])
            
            # 更新任务标注
            current_time = get_current_time()
            conn = sqlite3.connect(DATABASE_PATH)
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE tasks 
                SET annotations = ?, updated_at = ?
                WHERE id = ?
            ''', (json.dumps(annotations), current_time, task_id))
            conn.commit()
            conn.close()
            
            log_manager.info(f"任务推理完成: task_id={task_id}, 检测到 {len(annotations)} 个目标")
            
            return jsonify({
                'success': True,
                'data': {
                    'task_id': task_id,
                    'annotations': annotations,
                    'count': len(annotations)
                }
            })
        else:
            return jsonify({
                'success': False,
                'error': result.get('error', '推理失败')
            }), 500
            
    except Exception as e:
        log_manager.error(f"任务推理失败: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'推理失败: {str(e)}'
        }), 500


# ============================================
# API路由 - 设备与日志
# ============================================

@app.route('/api/inference/device', methods=['GET'])
def get_device_info_api():
    """
    获取推理设备信息
    """
    from infer_service import get_device_info
    
    try:
        info = get_device_info()
        return jsonify({
            'success': True,
            'data': info
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/inference/status', methods=['GET'])
def get_inference_status_api():
    """
    获取推理服务状态
    """
    from infer_service import get_service_status
    
    try:
        status = get_service_status()
        return jsonify({
            'success': True,
            'data': status
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/inference/logs', methods=['GET'])
def get_inference_logs_api():
    """
    获取推理日志
    
    Query Params:
        level: 日志级别 (DEBUG/INFO/WARNING/ERROR)
        limit: 返回数量限制 (默认100)
    """
    from infer_service import get_logs
    
    try:
        level = request.args.get('level')
        limit = int(request.args.get('limit', 100))
        
        logs = get_logs(level, limit)
        
        return jsonify({
            'success': True,
            'data': {
                'logs': logs,
                'count': len(logs)
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/inference/logs/clear', methods=['POST'])
def clear_inference_logs_api():
    """
    清空推理日志
    """
    from infer_service import clear_logs
    
    try:
        clear_logs()
        return jsonify({
            'success': True,
            'message': '日志已清空'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/inference/log-level', methods=['POST'])
def set_log_level_api():
    """
    设置日志级别
    
    请求体:
    {
        "level": "DEBUG" | "INFO" | "WARNING" | "ERROR"
    }
    """
    from infer_service import inference_service
    
    try:
        data = request.json
        level = data.get('level', 'INFO')
        
        inference_service.set_log_level(level)
        
        return jsonify({
            'success': True,
            'data': {'level': level}
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


def process_next_in_queue():
    """处理队列中的下一个预刷任务"""
    from infer_service import inference_service
    import threading
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 检查是否有正在运行的任务
    cursor.execute('''
        SELECT COUNT(*) as running_count
        FROM inference_progress
        WHERE status = 'processing'
    ''')
    running_count = cursor.fetchone()['running_count']
    
    if running_count > 0:
        conn.close()
        return
    
    # 获取队列中的下一个任务
    cursor.execute('''
        SELECT iq.*, ip.total_tasks, ip.target_labels
        FROM inference_queue iq
        JOIN inference_progress ip ON iq.project_id = ip.project_id
        WHERE iq.status = 'queued'
        ORDER BY iq.position ASC
        LIMIT 1
    ''')
    next_task = cursor.fetchone()
    
    if not next_task:
        conn.close()
        return
    
    queue_id = next_task['id']
    project_id = next_task['project_id']
    target_labels = json.loads(next_task['target_labels'])
    
    # 更新队列状态为处理中
    cursor.execute('''
        UPDATE inference_queue
        SET status = 'processing', updated_at = ?
        WHERE id = ?
    ''', (get_current_time(), queue_id))
    
    # 更新进度状态为处理中
    cursor.execute('''
        UPDATE inference_progress
        SET status = 'processing', started_at = ?, updated_at = ?
        WHERE project_id = ?
    ''', (get_current_time(), get_current_time(), project_id))
    
    conn.commit()
    conn.close()
    
    print(f"[预刷队列] 开始处理队列任务: {project_id}")
    
    # 获取项目任务
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT id, file_path, file_type
        FROM tasks
        WHERE project_id = ? AND file_type = 'image'
    ''', (project_id,))
    tasks = cursor.fetchall()
    
    conn.close()
    
    # 在后台线程中执行推理
    def run_inference():
        from infer_service import inference_service, log_manager
        
        print(f"[预刷队列] 后台线程启动，任务数: {len(tasks)}")
        image_paths = [dict(t)['file_path'] for t in tasks]
        
        # 收集日志
        logs_list = []
        
        def add_log(message):
            """添加日志"""
            import datetime
            timestamp = datetime.datetime.now().strftime('%H:%M:%S')
            log_entry = f"[{timestamp}] {message}"
            logs_list.append(log_entry)
            print(log_entry)
            # 同时写入推理服务日志
            log_manager.info(message)
        
        def progress_callback(current, total, result):
            conn = sqlite3.connect(DATABASE_PATH)
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE inference_progress
                SET completed_tasks = ?, updated_at = ?
                WHERE project_id = ?
            ''', (current, get_current_time(), project_id))
            conn.commit()
            conn.close()
            
            # 通过WebSocket推送进度
            if result and isinstance(result, dict):
                socketio.emit('inference_progress', {
                    'project_id': project_id,
                    'current': current,
                    'total': total,
                    'annotations_count': result.get('count', 0)
                })
        
        try:
            add_log(f"========== 开始批量推理 ==========")
            add_log(f"处理图片数量: {len(image_paths)}")
            add_log(f"目标分类: {target_labels}")
            add_log(f"使用设备: {inference_service.engine.loader.model_info.get('device', 'unknown')}")
            
            result = inference_service.batch_infer(
                image_paths,
                target_labels,
                progress_callback=progress_callback
            )
            
            add_log(f"处理完成: 成功 {result['success']}, 失败 {result['failed']}")
            
            conn = sqlite3.connect(DATABASE_PATH)
            cursor = conn.cursor()
            
            for task in tasks:
                task_dict = dict(task)
                task_id = task_dict['id']
                file_path = task_dict['file_path']
                
                annotations = result['results'].get(file_path, [])
                
                if annotations:
                    add_log(f"{file_path}: 检测到 {len(annotations)} 个目标")
                else:
                    add_log(f"{file_path}: 未检测到目标")
                
                cursor.execute('''
                    UPDATE tasks
                    SET annotations = ?, updated_at = ?
                    WHERE id = ?
                ''', (json.dumps(annotations), get_current_time(), task_id))
            
            current_time = get_current_time()
            logs_text = '\n'.join(logs_list)
            cursor.execute('''
                UPDATE inference_progress
                SET status = ?, completed_tasks = ?, failed_tasks = ?,
                    error_message = ?, logs = ?, completed_at = ?, updated_at = ?
                WHERE project_id = ?
            ''', (
                'completed' if result['failed'] == 0 else 'failed',
                result['success'],
                result['failed'],
                json.dumps(result['errors']) if result['errors'] else None,
                logs_text,
                current_time,
                current_time,
                project_id
            ))
            
            # 从队列中移除
            cursor.execute('DELETE FROM inference_queue WHERE id = ?', (queue_id,))
            
            add_log(f"任务完成，状态: {'completed' if result['failed'] == 0 else 'failed'}")
            
            conn.commit()
            conn.close()
            
            # 处理队列中的下一个任务
            process_next_in_queue()
            
        except Exception as e:
            error_log = '\n'.join(logs_list) if 'logs_list' in dir() else ''
            error_log += f"\n[错误] {str(e)}"
            print(f"[预刷队列] 任务失败: {str(e)}")
            
            conn = sqlite3.connect(DATABASE_PATH)
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE inference_progress
                SET status = ?, error_message = ?, logs = ?, completed_at = ?, updated_at = ?
                WHERE project_id = ?
            ''', ('failed', str(e), error_log, get_current_time(), get_current_time(), project_id))
            
            # 从队列中移除
            cursor.execute('DELETE FROM inference_queue WHERE id = ?', (queue_id,))
            
            conn.commit()
            conn.close()
            
            # 即使失败也处理队列中的下一个任务
            process_next_in_queue()
    
    thread = threading.Thread(target=run_inference)
    thread.daemon = True
    thread.start()


@app.route('/api/projects/<project_id>/inference/start', methods=['POST'])
def start_project_inference(project_id):
    """
    启动项目预刷（支持队列）
    
    请求体:
    {
        "target_labels": ["标签1", "标签2", ...],
        "confidence": 0.25 (可选)
    }
    """
    from infer_service import inference_service, log_manager
    import threading
    
    data = request.json
    
    if not data:
        return jsonify({'success': False, 'error': '无效的请求数据'}), 400
    
    target_labels = data.get('target_labels', [])
    prompt_template = data.get('prompt_template')
    
    if not target_labels:
        return jsonify({'success': False, 'error': '目标分类不能为空'}), 400
    
    print(f"[预刷] 开始处理项目 {project_id}, 目标标签: {target_labels}")
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 检查项目是否存在
    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    project = cursor.fetchone()
    
    if not project:
        conn.close()
        print(f"[预刷] 项目不存在: {project_id}")
        return jsonify({'success': False, 'error': '项目不存在'}), 404
    
    print(f"[预刷] 项目名称: {project['name']}")
    
    # 获取项目所有图像任务
    cursor.execute('''
        SELECT id, file_path, file_type
        FROM tasks
        WHERE project_id = ? AND file_type = 'image'
    ''', (project_id,))
    tasks = cursor.fetchall()
    
    print(f"[预刷] 找到 {len(tasks)} 个图像任务")
    
    if not tasks:
        conn.close()
        print(f"[预刷] 项目中没有图像任务")
        return jsonify({'success': False, 'error': '项目中没有图像任务'}), 400
    
    # 检查是否有正在运行的任务
    cursor.execute('''
        SELECT COUNT(*) as running_count
        FROM inference_progress
        WHERE status = 'processing'
    ''')
    running_count = cursor.fetchone()['running_count']
    
    # 检查该项目是否已在队列中或正在处理
    cursor.execute('''
        SELECT status FROM inference_progress
        WHERE project_id = ?
    ''', (project_id,))
    existing_progress = cursor.fetchone()
    
    if existing_progress and existing_progress['status'] == 'processing':
        conn.close()
        return jsonify({'success': False, 'error': '该项目预刷任务正在处理中'}), 400
    
    # 创建预刷进度记录
    progress_id = generate_id()
    current_time = get_current_time()
    
    # 删除旧的进度记录（如果存在）
    cursor.execute('DELETE FROM inference_progress WHERE project_id = ?', (project_id,))
    
    # 如果有任务正在运行，加入队列
    if running_count > 0:
        # 获取当前队列位置
        cursor.execute('''
            SELECT MAX(position) as max_pos FROM inference_queue
        ''')
        max_pos = cursor.fetchone()['max_pos'] or 0
        
        # 加入队列
        queue_id = generate_id()
        cursor.execute('''
            INSERT INTO inference_queue
            (id, project_id, status, position, target_labels, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            queue_id,
            project_id,
            'queued',
            max_pos + 1,
            json.dumps(target_labels),
            current_time,
            current_time
        ))
        
        # 创建进度记录（状态为queued）
        cursor.execute('''
            INSERT INTO inference_progress
            (id, project_id, status, total_tasks, target_labels, started_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            progress_id,
            project_id,
            'queued',
            len(tasks),
            json.dumps(target_labels),
            current_time,
            current_time,
            current_time
        ))
        
        conn.commit()
        conn.close()
        
        print(f"[预刷] 项目 {project_id} 已加入队列，位置: {max_pos + 1}")
        
        return jsonify({
            'success': True,
            'data': {
                'progress_id': progress_id,
                'total_tasks': len(tasks),
                'message': '预刷任务已加入队列',
                'queue_position': max_pos + 1
            }
        })
    
    # 没有正在运行的任务，直接启动
    cursor.execute('''
        INSERT INTO inference_progress
        (id, project_id, status, total_tasks, target_labels, started_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        progress_id,
        project_id,
        'processing',
        len(tasks),
        json.dumps(target_labels),
        current_time,
        current_time,
        current_time
    ))
    
    conn.commit()
    conn.close()
    
    # 在后台线程中执行推理
    def run_inference():
        print(f"[预刷] 后台线程启动，任务数: {len(tasks)}")
        image_paths = [dict(t)['file_path'] for t in tasks]
        
        # 收集日志
        logs_list = []
        
        def add_log(message):
            """添加日志"""
            import datetime
            timestamp = datetime.datetime.now().strftime('%H:%M:%S')
            log_entry = f"[{timestamp}] {message}"
            logs_list.append(log_entry)
            # 打印到控制台
            print(log_entry)
        
        def progress_callback(current, total, annotations):
            # 更新进度
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE inference_progress
                SET completed_tasks = ?, updated_at = ?
                WHERE project_id = ?
            ''', (current, get_current_time(), project_id))
            conn.commit()
            conn.close()
        
        def error_callback(error, image_path):
            error_msg = f"推理错误: {error} - {image_path}"
            add_log(error_msg)
        
        try:
            # 添加开始日志
            add_log(f"开始处理 {len(image_paths)} 张图片")
            add_log(f"目标分类: {target_labels}")
            
            result = inference_service.batch_infer(
                image_paths,
                target_labels,
                progress_callback=progress_callback
            )
            
            # 添加结果日志
            add_log(f"处理完成: 成功 {result['success']}, 失败 {result['failed']}")
            
            # 更新任务标注
            conn = get_db_connection()
            cursor = conn.cursor()
            
            for task in tasks:
                task_dict = dict(task)
                task_id = task_dict['id']
                file_path = task_dict['file_path']
                
                annotations = result['results'].get(file_path, [])
                
                # 添加标注日志
                if annotations:
                    add_log(f"{file_path}: 检测到 {len(annotations)} 个目标")
                else:
                    add_log(f"{file_path}: 未检测到目标")
                
                cursor.execute('''
                    UPDATE tasks
                    SET annotations = ?, updated_at = ?
                    WHERE id = ?
                ''', (json.dumps(annotations), get_current_time(), task_id))
            
            # 更新进度状态和日志
            current_time = get_current_time()
            logs_text = '\n'.join(logs_list)
            cursor.execute('''
                UPDATE inference_progress
                SET status = ?, completed_tasks = ?, failed_tasks = ?,
                    error_message = ?, logs = ?, completed_at = ?, updated_at = ?
                WHERE project_id = ?
            ''', (
                'completed' if result['failed'] == 0 else 'failed',
                result['success'],
                result['failed'],
                json.dumps(result['errors']) if result['errors'] else None,
                logs_text,
                current_time,
                current_time,
                project_id
            ))
            
            add_log(f"任务完成，状态: {'completed' if result['failed'] == 0 else 'failed'}")
            
            conn.commit()
            conn.close()
            
            # 处理队列中的下一个任务
            process_next_in_queue()
            
        except Exception as e:
            # 保存错误日志
            error_log = '\n'.join(logs_list) if 'logs_list' in dir() else ''
            error_log += f"\n[错误] {str(e)}"
            print(f"[预刷] 任务失败: {str(e)}")
            
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE inference_progress
                SET status = ?, error_message = ?, logs = ?, completed_at = ?, updated_at = ?
                WHERE project_id = ?
            ''', ('failed', str(e), error_log, get_current_time(), get_current_time(), project_id))
            conn.commit()
            conn.close()
            
            # 即使失败也处理队列中的下一个任务
            process_next_in_queue()
    
    thread = threading.Thread(target=run_inference)
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'success': True,
        'data': {
            'progress_id': progress_id,
            'total_tasks': len(tasks),
            'message': '预刷任务已启动'
        }
    })


@app.route('/api/projects/<project_id>/inference/progress', methods=['GET'])
def get_inference_progress(project_id):
    """
    获取项目预刷进度
    """
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT * FROM inference_progress 
        WHERE project_id = ?
    ''', (project_id,))
    progress = cursor.fetchone()
    
    conn.close()
    
    if not progress:
        return jsonify({
            'success': True,
            'data': None
        })
    
    progress_dict = dict(progress)
    progress_dict['target_labels'] = json.loads(progress_dict['target_labels']) if progress_dict['target_labels'] else []
    progress_dict['error_message'] = json.loads(progress_dict['error_message']) if progress_dict['error_message'] else []
    # 返回日志
    progress_dict['logs'] = progress_dict.get('logs', '') or ''
    
    return jsonify({
        'success': True,
        'data': progress_dict
    })


@app.route('/api/projects/<project_id>/inference/retry', methods=['POST'])
def retry_inference(project_id):
    """
    重试失败的预刷任务
    """
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 获取失败的任务
    cursor.execute('''
        SELECT ip.*, t.file_path 
        FROM inference_progress ip
        JOIN tasks t ON t.project_id = ip.project_id
        WHERE ip.project_id = ? AND ip.status = 'failed'
    ''', (project_id,))
    progress = cursor.fetchone()
    
    if not progress:
        conn.close()
        return jsonify({'success': False, 'error': '没有可重试的任务'}), 400
    
    target_labels = json.loads(progress['target_labels']) if progress['target_labels'] else []
    
    conn.close()


# ============================================
# 前端API需要的额外推理接口
# ============================================

@app.route('/api/inference/progress', methods=['GET'])
def get_inference_progress_list():
    """
    获取所有项目的预刷进度列表
    """
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 检测并处理卡住的预刷任务（超过30分钟仍为processing状态）
    cursor.execute('''
        UPDATE inference_progress 
        SET status = 'failed', 
            error_message = '[]',
            logs = COALESCE(logs, '') || '\n[系统] 任务超时自动标记为失败',
            completed_at = updated_at
        WHERE status = 'processing' 
        AND datetime(started_at) < datetime('now', '-30 minutes')
    ''')
    if cursor.rowcount > 0:
        print(f"[预刷] 检测到 {cursor.rowcount} 个卡住的任务，已标记为失败")
    
    conn.commit()
    
    # 先修复：确保有预刷进度的项目enable_inference=1
    cursor.execute('''
        UPDATE projects 
        SET enable_inference = 1 
        WHERE id IN (SELECT DISTINCT project_id FROM inference_progress)
        AND enable_inference = 0
    ''')
    conn.commit()
    
    # 获取所有有预刷进度的项目
    cursor.execute('''
        SELECT p.id, p.name, p.enable_inference, p.category_id, ip.*
        FROM projects p
        INNER JOIN inference_progress ip ON p.id = ip.project_id
        ORDER BY p.created_at DESC
    ''')
    rows = cursor.fetchall()
    
    if len(rows) == 0:
        # 如果没有结果，尝试获取所有启用了推理的项目
        cursor.execute('''
            SELECT p.id, p.name, p.enable_inference, p.category_id
            FROM projects p
            WHERE p.enable_inference = 1
            ORDER BY p.created_at DESC
        ''')
        rows = cursor.fetchall()
        print(f"[预刷列表] 备用查询找到 {len(rows)} 个项目")
    
    conn.close()
    
    projects = []
    for row in rows:
        if row['id']:
            project_data = {
                'id': row['id'],
                'name': row['name'],
                'category_id': row['category_id'] if 'category_id' in row.keys() else None,
                'progress': None
            }
            
            if row['status']:
                progress_dict = {
                    'project_id': row['project_id'],
                    'status': row['status'],
                    'total_tasks': row['total_tasks'],
                    'completed_tasks': row['completed_tasks'],
                    'failed_tasks': row['failed_tasks'],
                    'target_labels': json.loads(row['target_labels']) if row['target_labels'] else [],
                    'error_message': json.loads(row['error_message']) if row['error_message'] else [],
                    'logs': row['logs'] if row['logs'] else '',
                    'started_at': row['started_at'],
                    'completed_at': row['completed_at']
                }
                project_data['progress'] = progress_dict
            
            projects.append(project_data)
    
    return jsonify({
        'success': True,
        'data': projects
    })


@app.route('/api/inference/progress/<project_id>', methods=['GET'])
def get_inference_progress_by_id(project_id):
    """
    根据项目ID获取预刷进度
    """
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT * FROM inference_progress 
        WHERE project_id = ?
    ''', (project_id,))
    progress = cursor.fetchone()
    
    conn.close()
    
    if not progress:
        return jsonify({
            'success': True,
            'data': None
        })
    
    progress_dict = dict(progress)
    progress_dict['target_labels'] = json.loads(progress_dict['target_labels']) if progress_dict['target_labels'] else []
    progress_dict['error_message'] = json.loads(progress_dict['error_message']) if progress_dict['error_message'] else []
    progress_dict['logs'] = progress_dict.get('logs', '') or ''
    
    return jsonify({
        'success': True,
        'data': progress_dict
    })


@app.route('/api/inference/retry/<project_id>', methods=['POST'])
def retry_inference_by_project(project_id):
    """
    根据项目ID重新执行预刷任务（支持在任何状态下重新执行）
    """
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 获取项目信息
    cursor.execute('SELECT * FROM projects WHERE id = ?', (project_id,))
    project = cursor.fetchone()
    
    if not project:
        conn.close()
        return jsonify({'success': False, 'error': '项目不存在'}), 404
    
    if not project['enable_inference']:
        conn.close()
        return jsonify({'success': False, 'error': '该项目未启用推理'}), 400
    
    # 获取当前进度
    cursor.execute('''
        SELECT * FROM inference_progress
        WHERE project_id = ?
    ''', (project_id,))
    progress = cursor.fetchone()
    
    # 如果没有预刷任务，先创建一个
    if not progress:
        # 获取项目关联的分类和标签
        cursor.execute('SELECT category_id FROM projects WHERE id = ?', (project_id,))
        project_row = cursor.fetchone()
        category_id = project_row['category_id'] if project_row else None
        
        # 获取分类下的标签
        labels = []
        if category_id:
            cursor.execute('SELECT name FROM labels WHERE category_id = ?', (category_id,))
            labels = [row['name'] for row in cursor.fetchall()]
        
        # 创建新的预刷进度记录
        current_time = get_current_time()
        cursor.execute('''
            INSERT INTO inference_progress 
            (project_id, status, target_labels, total_tasks, completed_tasks, failed_tasks, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (project_id, 'pending', json.dumps(labels), 0, 0, 0, current_time, current_time))
        conn.commit()
        
        # 重新获取进度记录
        cursor.execute('SELECT * FROM inference_progress WHERE project_id = ?', (project_id,))
        progress = cursor.fetchone()
    
    # 从请求中获取目标标签（如果有）
    target_labels = []
    try:
        request_data = request.get_json()
        if request_data and 'target_labels' in request_data:
            target_labels = request_data['target_labels']
    except:
        pass
    
    # 如果没有从请求中获取到标签，则从数据库中获取
    if not target_labels and progress and progress['target_labels']:
        try:
            target_labels = json.loads(progress['target_labels']) if progress['target_labels'] else []
        except:
            target_labels = []
    
    if not target_labels:
        conn.close()
        return jsonify({'success': False, 'error': '请先设置目标分类'}), 400
    
    # 先将状态更新为pending，以便可以重新启动
    current_time = get_current_time()
    cursor.execute('''
        UPDATE inference_progress
        SET status = 'pending', updated_at = ?, error_message = NULL
        WHERE project_id = ?
    ''', (current_time, project_id))
    conn.commit()
    conn.close()
    
    # 重新启动推理（通过start_project_inference函数）
    from flask import request as flask_request
    from werkzeug.test import EnvironBuilder
    
    # 创建一个模拟的请求上下文
    builder = EnvironBuilder(
        method='POST',
        data=json.dumps({'target_labels': target_labels}),
        content_type='application/json'
    )
    env = builder.get_environ()
    
    # 在应用上下文中执行
    with app.request_context(env):
        return start_project_inference(project_id)


# ============================================
# 主程序入口
# ============================================

if __name__ == '__main__':
    print("=" * 60)
    print("Novisight Label 标注系统启动中...")
    print("=" * 60)
    print("YOLOv8本地模型推理服务已集成")
    print("=" * 60)
    
    # 初始化数据库
    init_database()
    
    # 启动服务器（使用SocketIO）
    print("\n服务地址: http://localhost:5000")
    print("WebSocket: 已启用")
    print("上传目录:", UPLOAD_DIR)
    print("\n系统就绪! 点击上方链接开始使用\n")
    
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
