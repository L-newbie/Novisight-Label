# -*- coding: utf-8 -*-
"""
YOLO-World模型推理服务模块
提供图像标注的AI预刷功能，基于YOLO-World2本地模型完成推理
支持文本描述检测任意类别目标，包括锥桶等非COCO类别
支持CUDA GPU加速，自动降级到CPU模式
"""

import os
import sys
import time
import json
import logging
import threading
import traceback
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime
from enum import Enum

# 第三方库
import numpy as np
from PIL import Image

from ultralytics import YOLO
import subprocess

# ============================================
# 配置常量
# ============================================

# YOLO-World模型配置
MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models", "yolov8x-worldv2.pt")
# CLIP 模型路径（手动下载的ViT-B-32.pt）
CLIP_MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models", "ViT-B-32.pt")
# 默认参数 - 已优化以提高检测召回率
DEFAULT_CONFIDENCE_THRESHOLD = 0.15  # 降低阈值以检测更多目标
DEFAULT_IOU_THRESHOLD = 0.35  # 略微降低IOU阈值，允许更多重叠检测
DEFAULT_IMAGE_SIZE = 1280  # 增加图像尺寸以提高小目标检测效果

# 日志格式
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# ============================================
# 日志级别枚举
# ============================================

class LogLevel(Enum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"


# ============================================
# 日志管理器
# ============================================

class LogManager:
    """日志管理器 - 支持分级输出和WebSocket推送"""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self._initialized = True
        self._log_handlers: List[Callable] = []
        self._min_level = LogLevel.DEBUG
        
        # 设置Python日志记录器
        self.logger = logging.getLogger("YOLOWorldInfer")
        self.logger.setLevel(logging.DEBUG)
        
        # 控制台处理器
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.DEBUG)
        console_formatter = logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT)
        console_handler.setFormatter(console_formatter)
        self.logger.addHandler(console_handler)
        
        # 内存日志缓冲区
        self._log_buffer: List[Dict] = []
        self._max_buffer_size = 1000
    
    def set_min_level(self, level: LogLevel):
        """设置最小日志级别"""
        self._min_level = level
    
    def add_handler(self, handler: Callable):
        """添加日志处理器"""
        if handler not in self._log_handlers:
            self._log_handlers.append(handler)
    
    def remove_handler(self, handler: Callable):
        """移除日志处理器"""
        if handler in self._log_handlers:
            self._log_handlers.remove(handler)
    
    def _should_log(self, level: LogLevel) -> bool:
        """判断是否应该记录该级别日志"""
        levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARNING, LogLevel.ERROR]
        return levels.index(level) >= levels.index(self._min_level)
    
    def _format_log(self, level: LogLevel, message: str, extra: Dict = None) -> Dict:
        """格式化日志为字典"""
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "level": level.value,
            "message": message,
            "extra": extra or {}
        }
        
        self._log_buffer.append(log_entry)
        if len(self._log_buffer) > self._max_buffer_size:
            self._log_buffer.pop(0)
        
        return log_entry
    
    def _dispatch(self, level: LogLevel, message: str, extra: Dict = None):
        """分发日志到所有处理器"""
        if not self._should_log(level):
            return
        
        log_entry = self._format_log(level, message, extra)
        
        for handler in self._log_handlers:
            try:
                handler(log_entry)
            except Exception as e:
                print(f"日志处理器错误: {e}")
        
        log_func = getattr(self.logger, level.value.lower())
        log_func(message)
    
    def debug(self, message: str, extra: Dict = None):
        self._dispatch(LogLevel.DEBUG, message, extra)
    
    def info(self, message: str, extra: Dict = None):
        self._dispatch(LogLevel.INFO, message, extra)
    
    def warning(self, message: str, extra: Dict = None):
        self._dispatch(LogLevel.WARNING, message, extra)
    
    def error(self, message: str, extra: Dict = None):
        self._dispatch(LogLevel.ERROR, message, extra)
    
    def get_buffer(self, level: LogLevel = None, limit: int = 100) -> List[Dict]:
        if level is None:
            return self._log_buffer[-limit:]
        
        filtered = [log for log in self._log_buffer if log["level"] == level.value]
        return filtered[-limit:]
    
    def clear_buffer(self):
        self._log_buffer.clear()


log_manager = LogManager()


# ============================================
# 设备检测与管理
# ============================================

class DeviceManager:
    """设备管理器 - 自动检测CUDA可用性"""
    
    def __init__(self):
        self.device = "cpu"
        self.device_name = "CPU"
        self.cuda_available = False
        self.cuda_device_count = 0
        self.cuda_version = None
        self._detect_device()
    
    def _detect_device(self):
        """检测可用计算设备"""
        log_manager.info("=" * 50)
        log_manager.info("开始检测计算设备...")
        log_manager.debug("检查CUDA可用性")
        
        try:
            import torch
            
            self.cuda_available = torch.cuda.is_available()
            log_manager.debug(f"torch.cuda.is_available() = {self.cuda_available}")
            
            if self.cuda_available:
                self.cuda_device_count = torch.cuda.device_count()
                self.cuda_version = torch.version.cuda
                self.device = "cuda"
                self.device_name = f"CUDA:{torch.cuda.current_device()}"
                
                gpu_name = torch.cuda.get_device_name(0)
                gpu_memory = torch.cuda.get_device_properties(0).total_memory / (1024**3)
                
                log_manager.info(f"检测到CUDA设备: {gpu_name}")
                log_manager.info(f"CUDA版本: {self.cuda_version}")
                log_manager.info(f"GPU数量: {self.cuda_device_count}")
                log_manager.info(f"GPU总内存: {gpu_memory:.2f} GB")
                log_manager.info(f"将使用设备: {self.device_name}")
            else:
                log_manager.warning("CUDA不可用，将使用CPU进行推理")
                log_manager.info("检测到计算设备: CPU (Intel/AMD Processor)")
                log_manager.info("将使用设备: CPU")
            
            log_manager.info("=" * 50)
            
        except ImportError:
            log_manager.warning("PyTorch未安装，将使用CPU模式")
            log_manager.info("检测到计算设备: CPU (PyTorch未安装)")
            log_manager.info("将使用设备: CPU")
            log_manager.info("=" * 50)
    
    def get_memory_info(self) -> Dict:
        info = {
            "device": self.device_name,
            "cuda_available": self.cuda_available
        }
        
        try:
            import torch
            if self.cuda_available and torch.cuda.is_available():
                info["gpu_memory_allocated"] = torch.cuda.memory_allocated() / (1024**3)
                info["gpu_memory_reserved"] = torch.cuda.memory_reserved() / (1024**3)
                info["gpu_memory_free"] = (torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated()) / (1024**3)
        except Exception as e:
            print(f"获取GPU内存信息失败: {e}")
        
        return info
    
    def log_memory_info(self, context: str = ""):
        info = self.get_memory_info()
        prefix = f"[{context}] " if context else ""
        
        if info.get("cuda_available"):
            log_manager.debug(
                f"{prefix}GPU内存 - 已分配: {info.get('gpu_memory_allocated', 0):.2f}GB, "
                f"已保留: {info.get('gpu_memory_reserved', 0):.2f}GB, "
                f"空闲: {info.get('gpu_memory_free', 0):.2f}GB",
                extra={"memory_info": info}
            )
        else:
            log_manager.debug(f"{prefix}运行在CPU模式")


device_manager = DeviceManager()


# ============================================
# YOLO-World模型加载器
# ============================================

class YOLOWorldModelLoader:
    """YOLO-World模型加载器"""
    
    def __init__(self, model_path: str = MODEL_PATH):
        self.model_path = model_path
        self.model = None
        self.model_loaded = False
        self.load_time = None
        self.model_info = {}
    
    def load_model(self) -> bool:
        """加载YOLO-World模型"""
        log_manager.info("=" * 50)
        log_manager.info("开始加载YOLO-World模型...")
        
        # 检查模型文件是否存在
        if not os.path.exists(self.model_path):
            log_manager.error(f"模型文件不存在: {self.model_path}")
            log_manager.info("尝试下载YOLO-World模型...")
            return self._download_and_load_model()
        
        log_manager.info(f"模型文件路径: {self.model_path}")
        
        # 检查 CLIP 模型文件是否存在
        if os.path.exists(CLIP_MODEL_PATH):
            clip_size = os.path.getsize(CLIP_MODEL_PATH)
            log_manager.info(f"CLIP模型文件大小: {clip_size} bytes")
            if clip_size < 1000000:  # 小于1MB说明文件可能不完整
                log_manager.warning(f"CLIP模型文件可能不完整: {CLIP_MODEL_PATH}")
        else:
            log_manager.warning(f"CLIP模型文件不存在: {CLIP_MODEL_PATH}")
        
        try:
            log_manager.debug("正在导入ultralytics库...")
            import torch
            log_manager.debug(f"PyTorch版本: {torch.__version__}")
            
            log_manager.info("正在初始化YOLO-World模型...")
            self.model = YOLO(self.model_path)
            
            self.model_info = {
                "model_path": self.model_path,
                "model_type": "yolov8s-world",
                "device": device_manager.device
            }
            
            log_manager.debug(f"模型任务类型: open-vocabulary detection (开集检测)")
            
            # 将模型移动到目标设备
            if device_manager.cuda_available:
                log_manager.debug(f"将模型移动到设备: {device_manager.device}")
                self.model.to(device_manager.device)
            
            self.load_time = time.time()
            self.model_loaded = True  # 标记模型已加载
            
            log_manager.info(f"YOLO-World模型加载成功!")
            log_manager.info(f"模型加载耗时: {self.load_time:.2f}秒")
            log_manager.info(f"运行设备: {device_manager.device_name}")
            log_manager.info("=" * 50)
            
            log_manager.info("YOLO-World支持文本描述检测，可检测任意类别目标!")
            log_manager.info("示例类别: 锥桶、交通锥、车辆、行人、交通标志等")
            
            return True
            
        except ImportError as e:
            log_manager.error(f"缺少必要的依赖库: {e}")
            raise ImportError(f"缺少必要的依赖库: {e}")  # 重新抛出错误，不要隐藏
            
        except Exception as e:
            log_manager.error(f"模型加载失败: {str(e)}")
            log_manager.error(traceback.format_exc())
            raise e  # 重新抛出错误，不要隐藏
    
    def _download_and_load_model(self) -> bool:
        """下载并加载模型"""
        try:
            
            log_manager.info("从Ultralytics服务器下载YOLO-World模型...")
            log_manager.debug("这可能需要几分钟时间，取决于网络状况...")
            
            start_time = time.time()
            
            # YOLO-World模型 - s版本比n版本精度更高
            self.model = YOLO("yolov8s-world.pt")
            
            download_time = time.time() - start_time
            log_manager.info(f"模型下载完成，耗时: {download_time:.2f}秒")
            
            # 保存模型到本地
            try:
                self.model.save(self.model_path)
                log_manager.info(f"模型已保存到: {self.model_path}")
            except Exception as e:
                log_manager.warning(f"无法保存模型到文件: {e}")
            
            return self.load_model()
            
        except Exception as e:
            log_manager.error(f"模型下载失败: {str(e)}")
            log_manager.error(traceback.format_exc())
            raise e  # 重新抛出错误，不要隐藏
    
    def _install_and_load_model(self) -> bool:
        """安装依赖并加载模型"""
        try:
            log_manager.info("正在安装ultralytics库...")
            
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", "ultralytics", "-i", "https://pypi.tuna.tsinghua.edu.cn/simple"],
                capture_output=True,
                text=True,
                timeout=300
            )
            
            if result.returncode == 0:
                log_manager.info("ultralytics安装成功")
                return self.load_model()
            else:
                log_manager.error(f"ultralytics安装失败: {result.stderr}")
                return False
                
        except Exception as e:
            log_manager.error(f"安装失败: {str(e)}")
            log_manager.error(traceback.format_exc())
            raise e  # 重新抛出错误，不要隐藏
    
    def get_model(self):
        return self.model
    
    def set_classes(self, classes: List[str]):
        """设置检测类别 - YOLO-World的核心功能"""
        if self.model is None:
            log_manager.error("模型未加载，无法设置类别")
            return False
        
        try:
            # YOLO-World使用set_classes方法来设置文本提示类别
            self.model.set_classes(classes)
            log_manager.info(f"已设置检测类别: {classes}")
            # 打印模型当前设置的类别
            if hasattr(self.model, 'model') and hasattr(self.model.model, 'set_classes'):
                log_manager.debug("模型已更新文本提示")
            return True
        except Exception as e:
            log_manager.error(f"设置类别失败: {e}")
            log_manager.error(traceback.format_exc())
            raise e


# ============================================
# YOLO-World推理引擎
# ============================================

class YOLOWorldInferEngine:
    """YOLO-World推理引擎"""
    
    def __init__(self, model_path: str = MODEL_PATH):
        self.loader = YOLOWorldModelLoader(model_path)
        self.confidence_threshold = DEFAULT_CONFIDENCE_THRESHOLD
        self.iou_threshold = DEFAULT_IOU_THRESHOLD
        self.image_size = DEFAULT_IMAGE_SIZE
        self.inference_count = 0
        self.total_inference_time = 0
        self.current_classes = []
        self._warmup_done = False
    
    def initialize(self) -> bool:
        """初始化推理引擎"""
        log_manager.info("=" * 50)
        log_manager.info("初始化YOLO-World推理引擎...")
        
        success = self.loader.load_model()
        
        if success:
            log_manager.info("推理引擎初始化成功!")
            self._warmup()
        else:
            log_manager.error("推理引擎初始化失败!")
        
        log_manager.info("=" * 50)
        return success
    
    def _warmup(self):
        """预热模型"""
        if self._warmup_done:
            return
        
        log_manager.info("开始预热模型...")
        
        try:
            dummy_image = np.zeros((640, 640, 3), dtype=np.uint8)
            
            warmup_start = time.time()
            
            if self.loader.model:
                # 预热时使用优化后的参数
                self.loader.model(
                    dummy_image, 
                    conf=0.15,
                    imgsz=1280,
                    verbose=False,
                    device=device_manager.device
                )
            
            warmup_time = time.time() - warmup_start
            
            self._warmup_done = True
            
            log_manager.info(f"模型预热完成，耗时: {warmup_time:.3f}秒")
            log_manager.debug("模型已准备就绪，可以开始推理")
            
        except Exception as e:
            log_manager.warning(f"模型预热失败: {e}")
    
    def set_detection_classes(self, classes: List[str]) -> bool:
        """设置检测类别 - 增强版本，支持多提示词"""
        # 扩展提示词以提高检测效果
        expanded_classes = []
        for cls in classes:
            expanded_classes.append(cls)
            # 为中文添加常见变体
            if any('\u4e00' <= c <= '\u9fff' for c in cls):  # 检测是否包含中文
                if '锥' in cls or '桶' in cls:
                    expanded_classes.extend(['cone', 'traffic cone', 'road cone'])
                elif '车' in cls or '汽车' in cls:
                    expanded_classes.extend(['car', 'vehicle', 'automobile'])
                elif '人' in cls or '行人' in cls:
                    expanded_classes.extend(['person', 'pedestrian', 'human'])
        
        # 去重
        expanded_classes = list(dict.fromkeys(expanded_classes))
        
        log_manager.info(f"扩展后的检测类别: {expanded_classes}")
        
        self.current_classes = expanded_classes
        log_manager.debug(f"准备设置检测类别: {expanded_classes}")
        result = self.loader.set_classes(expanded_classes)
        log_manager.debug(f"set_detection_classes 返回: {result}")
        return result
    
    def infer(
        self, 
        image_path: str, 
        target_labels: List[str] = None,
        confidence: float = None,
        image_size: int = None
    ) -> List[Dict[str, Any]]:
        """
        对图像进行推理
        
        Args:
            image_path: 图像文件路径
            target_labels: 目标标签列表（用于YOLO-World文本提示）
            confidence: 置信度阈值
            image_size: 输入图像尺寸
        
        Returns:
            标注结果列表
        """
        if not self.loader.model_loaded:
            log_manager.error("模型未加载，无法进行推理")
            return []
        
        conf = confidence or self.confidence_threshold
        imgsz = image_size or self.image_size
        
        # 如果提供了目标标签，设置检测类别
        if target_labels:
            self.set_detection_classes(target_labels)
        
        log_manager.info("=" * 50)
        log_manager.info(f"开始推理: {os.path.basename(image_path)}")
        log_manager.debug(f"输入参数 - 置信度阈值: {conf}, 图像尺寸: {imgsz}")
        log_manager.debug(f"检测类别: {target_labels or self.current_classes or '未设置 (检测所有类别)'}")
        
        device_manager.log_memory_info("推理前")
        
        inference_start = time.time()
        
        try:
            load_start = time.time()
            log_manager.debug("加载图像...")
            
            image = Image.open(image_path)
            image_array = np.array(image)
            original_shape = image_array.shape[:2]
            
            load_time = time.time() - load_start
            log_manager.info(f"图像加载完成 - 尺寸: {image.size}, 耗时: {load_time:.3f}秒")
            log_manager.info(f"输入尺寸: {imgsz}x{imgsz}")
            
            predict_start = time.time()
            log_manager.info("开始模型推理...")
            
            results = self.loader.model(
                image_array,
                conf=conf,
                iou=self.iou_threshold,
                imgsz=imgsz,
                verbose=False,
                device=device_manager.device
            )
            
            # 打印调试信息
            log_manager.debug(f"原始推理结果类型: {type(results)}")
            log_manager.debug(f"原始推理结果长度: {len(results) if results else 0}")
            if results and len(results) > 0:
                result = results[0]
                log_manager.debug(f"result.names: {result.names if hasattr(result, 'names') else 'N/A'}")
                if hasattr(result, 'boxes') and result.boxes is not None:
                    log_manager.debug(f"boxes.xyxy: {result.boxes.xyxy}")
                    log_manager.debug(f"boxes.cls: {result.boxes.cls}")
                    log_manager.debug(f"boxes.conf: {result.boxes.conf}")
            
            predict_time = time.time() - predict_start
            log_manager.info(f"模型推理完成，耗时: {predict_time:.3f}秒")
            
            parse_start = time.time()
            log_manager.debug("解析推理结果...")
            
            annotations = self._parse_results(results, original_shape)
            
            parse_time = time.time() - parse_start
            log_manager.debug(f"结果解析完成，耗时: {parse_time:.3f}秒")
            
            total_time = time.time() - inference_start
            self.inference_count += 1
            self.total_inference_time += total_time
            
            avg_time = self.total_inference_time / self.inference_count
            
            device_manager.log_memory_info("推理后")
            
            log_manager.info(f"检测到 {len(annotations)} 个目标")
            log_manager.info(f"本次推理总耗时: {total_time:.3f}秒")
            log_manager.debug(f"平均推理耗时: {avg_time:.3f}秒 (共推理 {self.inference_count} 次)")
            
            if annotations:
                log_manager.info("检测结果详情:")
                for i, ann in enumerate(annotations):
                    log_manager.info(
                        f"  [{i+1}] {ann['label']} - 置信度: {ann['confidence']:.3f}, "
                        f"BBox: [{ann['bbox'][0]}, {ann['bbox'][1]}, {ann['bbox'][2]}, {ann['bbox'][3]}]"
                    )
            
            log_manager.info("=" * 50)
            
            return annotations
            
        except Exception as e:
            log_manager.error(f"推理过程出错: {str(e)}")
            log_manager.error(traceback.format_exc())
            raise e  # 重新抛出错误，不要隐藏
    
    def _parse_results(self, results, original_shape: tuple) -> List[Dict[str, Any]]:
        """解析YOLO-World推理结果"""
        annotations = []
        
        if results is None or len(results) == 0:
            log_manager.warning("推理结果为空")
            return annotations
        
        result = results[0]
        
        if hasattr(result, 'boxes') and result.boxes is not None:
            boxes = result.boxes
            
            if boxes.xyxy is not None:
                xyxy = boxes.xyxy.cpu().numpy()
                
                if boxes.conf is not None:
                    confidences = boxes.conf.cpu().numpy()
                else:
                    confidences = np.zeros(len(xyxy))
                
                if boxes.cls is not None:
                    classes = boxes.cls.cpu().numpy()
                else:
                    classes = np.zeros(len(xyxy))
                
                # YOLO-World使用文本类别名称
                class_names = result.names if hasattr(result, 'names') else {}
                
                log_manager.debug(f"原始检测框数量: {len(xyxy)}, 输出tensor形状: {xyxy.shape}")
                
                original_height, original_width = original_shape
                
                for i, (box, conf, cls) in enumerate(zip(xyxy, confidences, classes)):
                    x1, y1, x2, y2 = box
                    
                    x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
                    
                    cls_int = int(cls)
                    
                    # 根据 class_names 类型选择正确的访问方式
                    if isinstance(class_names, list):
                        if cls_int < len(class_names):
                            label = class_names[cls_int]
                        else:
                            label = f"class_{cls_int}"
                    else:
                        label = class_names.get(cls_int, f"class_{cls_int}")
                    
                    annotation = {
                        'type': 'bbox',
                        'label': label,
                        'bbox': [x1, y1, x2, y2],
                        'confidence': float(conf),
                        'source': 'inference',
                        'color': '#00ffcc'
                    }
                    
                    annotations.append(annotation)
        
        return annotations
    
    def get_stats(self) -> Dict:
        return {
            "inference_count": self.inference_count,
            "total_time": self.total_inference_time,
            "avg_time": self.total_inference_time / self.inference_count if self.inference_count > 0 else 0,
            "model_loaded": self.loader.model_loaded,
            "device": device_manager.device_name,
            "current_classes": self.current_classes
        }


# ============================================
# 推理服务接口
# ============================================

class InferenceService:
    """推理服务 - 提供高层API"""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self._initialized = True
        self.engine = YOLOWorldInferEngine()
        self._initialized_success = False
    
    def start(self) -> bool:
        """启动推理服务"""
        log_manager.info("启动YOLO-World推理服务...")
        
        self._initialized_success = self.engine.initialize()
        
        if self._initialized_success:
            log_manager.info("推理服务启动成功!")
            log_manager.info("YOLO-World支持开集检测，可检测任意文本描述的类别!")
        else:
            log_manager.error("推理服务启动失败!")
        
        return self._initialized_success
    
    def infer(
        self,
        image_path: str,
        target_labels: List[str] = None,
        confidence: float = None
    ) -> Dict[str, Any]:
        """推理单张图像"""
        if not self._initialized_success:
            return {
                "success": False,
                "error": "推理服务未初始化",
                "annotations": []
            }
        
        annotations = self.engine.infer(
            image_path,
            target_labels=target_labels,
            confidence=confidence
        )
        
        return {
            "success": True,
            "image_path": image_path,
            "annotations": annotations,
            "count": len(annotations),
            "stats": self.engine.get_stats()
        }
    
    def batch_infer(
        self,
        image_paths: List[str],
        target_labels: List[str] = None,
        confidence: float = None,
        progress_callback: Callable = None
    ) -> Dict[str, Any]:
        """批量推理"""
        results = {}
        success_count = 0
        failed_count = 0
        
        total = len(image_paths)
        
        # 设置检测类别（只设置一次）
        if target_labels:
            self.engine.set_detection_classes(target_labels)
        
        for idx, image_path in enumerate(image_paths):
            try:
                result = self.infer(image_path, target_labels=None, confidence=confidence)
                
                if result["success"]:
                    results[image_path] = result["annotations"]
                    success_count += 1
                else:
                    results[image_path] = []
                    failed_count += 1
                
                if progress_callback:
                    progress_callback(idx + 1, total, result)
                    
            except Exception as e:
                log_manager.error(f"批量推理第{idx+1}张图像失败: {str(e)}")
                results[image_path] = []
                failed_count += 1
                
                if progress_callback:
                    progress_callback(idx + 1, total, {"error": str(e)})
        
        return {
            "total": total,
            "success": success_count,
            "failed": failed_count,
            "results": results,
            "errors": []  # 添加errors字段以兼容后端代码
        }
    
    def get_service_status(self) -> Dict:
        return {
            "initialized": self._initialized_success,
            "model_loaded": self.engine.loader.model_loaded,
            "device": device_manager.device_name,
            "cuda_available": device_manager.cuda_available,
            "model_type": "YOLO-World (yolov8s-world)",
            "stats": self.engine.get_stats()
        }
    
    def set_log_level(self, level: str):
        try:
            log_manager.set_min_level(LogLevel[level.upper()])
            log_manager.info(f"日志级别已设置为: {level.upper()}")
        except KeyError:
            log_manager.warning(f"无效的日志级别: {level}")


# 全局推理服务实例
inference_service = InferenceService()


# ============================================
# 便捷函数
# ============================================

def initialize_service() -> bool:
    return inference_service.start()


def infer_image(
    image_path: str,
    target_labels: List[str] = None,
    confidence: float = None
) -> List[Dict[str, Any]]:
    result = inference_service.infer(image_path, target_labels, confidence)
    return result.get("annotations", [])


def get_logs(level: str = None, limit: int = 100) -> List[Dict]:
    try:
        level_enum = LogLevel[level.upper()] if level else None
        return log_manager.get_buffer(level_enum, limit)
    except KeyError:
        return log_manager.get_buffer(limit=limit)


def clear_logs():
    log_manager.clear_buffer()


def add_log_handler(handler: Callable):
    log_manager.add_handler(handler)


def remove_log_handler(handler: Callable):
    log_manager.remove_handler(handler)


def get_device_info() -> Dict:
    return {
        "device": device_manager.device_name,
        "cuda_available": device_manager.cuda_available,
        "cuda_device_count": device_manager.cuda_device_count,
        "cuda_version": device_manager.cuda_version,
        "memory_info": device_manager.get_memory_info()
    }


def get_service_status() -> Dict:
    return inference_service.get_service_status()


# ============================================
# 测试入口
# ============================================

if __name__ == "__main__":
    print("=" * 60)
    print("YOLO-World 推理服务测试")
    print("=" * 60)
    print("YOLO-World支持开集检测，可检测任意文本描述的类别!")
    print("例如: 锥桶、交通锥、车辆、行人等")
    print("=" * 60)
    
    # 初始化服务
    if initialize_service():
        print("\n服务初始化成功!")
        
        # 测试图像路径
        test_image = "C:/Users/86173/Desktop/images/1.jpg"
        
        if os.path.exists(test_image):
            # 设置检测类别 - 锥桶
            target_labels = ["锥桶", "垃圾桶", "cone"]
            
            print(f"\n设置检测类别: {target_labels}")
            
            # 执行推理
            result = infer_image(test_image, target_labels=target_labels)
            print(f"\n检测到 {len(result)} 个目标")
            for ann in result:
                print(f"  - {ann['label']}: {ann['bbox']} (置信度: {ann['confidence']:.2f})")
        else:
            print(f"\n测试图像不存在: {test_image}")
            print("请提供测试图像路径进行测试")
    else:
        print("\n服务初始化失败!")
