#!/usr/bin/env python3
"""
YOLO Model Validation & Regression Script for Legal Metrology Packaging
Evaluates mAP50, mAP50-95, precision, and recall on test annotations.
"""

import sys
import os
import argparse

def validate_model(weights: str, data_yaml: str):
    try:
        from ultralytics import YOLO
    except ImportError:
        print("Please install ultralytics: pip install ultralytics")
        sys.exit(1)

    if not os.path.exists(weights):
        print(f"Weights file not found: {weights}")
        sys.exit(1)

    model = YOLO(weights)
    metrics = model.val(data=data_yaml, split="test")
    print(f"mAP50: {metrics.box.map50:.3f}")
    print(f"mAP50-95: {metrics.box.map:.3f}")
    return metrics

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate YOLO on Legal Metrology dataset")
    parser.add_argument("--weights", default="ml/weights/best.pt", help="Path to weights")
    parser.add_argument("--data", default="ml/dataset/data.yaml", help="Path to data.yaml")
    args = parser.parse_args()

    validate_model(args.weights, args.data)
