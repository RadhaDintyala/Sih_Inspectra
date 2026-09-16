#!/usr/bin/env python3
"""
YOLO Training Script for Legal Metrology Packaging Detection
Trains YOLOv8 on packaged commodities declaration dataset.
"""

import sys
import os
import argparse

def train_model(data_yaml: str, epochs: int = 100, imgsz: int = 640, model_base: str = "yolov8n.pt"):
    try:
        from ultralytics import YOLO
    except ImportError:
        print("Please install ultralytics: pip install ultralytics")
        sys.exit(1)

    print(f"Loading base model: {model_base}...")
    model = YOLO(model_base)

    print(f"Starting training on {data_yaml} for {epochs} epochs...")
    results = model.train(
        data=data_yaml,
        epochs=epochs,
        imgsz=imgsz,
        project="ml/runs",
        name="legal_metrology_detect",
        save=True,
        exist_ok=True,
    )
    print("Training finished. Weights saved to ml/runs/legal_metrology_detect/weights/best.pt")
    return results

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train YOLO on Legal Metrology dataset")
    parser.add_argument("--data", default="ml/dataset/data.yaml", help="Path to data.yaml")
    parser.add_argument("--epochs", type=int, default=100, help="Number of epochs")
    parser.add_argument("--imgsz", type=int, default=640, help="Image size")
    parser.add_argument("--base", default="yolov8n.pt", help="Base model weights")
    args = parser.parse_args()

    train_model(args.data, args.epochs, args.imgsz, args.base)
