# -*- coding: utf-8 -*-
"""
数据库迁移脚本 - 为分类管理添加必要的表结构
"""

import sqlite3
import os

DATABASE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'database', 'novisight.db')
DATABASE_PATH = os.path.normpath(DATABASE_PATH)

def migrate():
    """执行数据库迁移"""
    print(f"正在连接数据库: {DATABASE_PATH}")
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    # 检查categories表是否存在
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'")
    if cursor.fetchone():
        print("categories 表已存在")
    else:
        print("创建 categories 表...")
        cursor.execute('''
            CREATE TABLE categories (
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
        print("categories 表创建成功")
    
    # 检查projects表是否有category_id列
    cursor.execute("PRAGMA table_info(projects)")
    columns = [col[1] for col in cursor.fetchall()]
    
    if 'category_id' in columns:
        print("category_id 列已存在")
    else:
        print("添加 category_id 列到 projects 表...")
        cursor.execute("ALTER TABLE projects ADD COLUMN category_id TEXT REFERENCES categories(id)")
        print("category_id 列添加成功")
    
    conn.commit()
    conn.close()
    print("迁移完成!")

if __name__ == '__main__':
    migrate()
