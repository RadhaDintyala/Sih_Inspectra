"use client";

import { useEffect, useRef, useCallback } from "react";
import type { LiveDetectionState, DetectionResult } from "@/services/live-inference";

interface LiveOverlayProps {
  detectionState: LiveDetectionState;
  detection: DetectionResult | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  rotation: number;
  mirrored: boolean;
  displayWidth: number;
  displayHeight: number;
  devicePixelRatio: number;
}

export function LiveOverlay({
  detectionState,
  detection,
  videoRef,
  rotation,
  mirrored,
  displayWidth,
  displayHeight,
  devicePixelRatio,
}: LiveOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return;

    const isRot90or270 = rotation === 90 || rotation === 270;
    const baseW = isRot90or270 ? vh : vw;
    const baseH = isRot90or270 ? vw : vh;

    const scale = Math.min(canvas.width / baseW, canvas.height / baseH);
    const offsetX = (canvas.width - baseW * scale) / 2;
    const offsetY = (canvas.height - baseH * scale) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const toCanvasX = (x: number) => offsetX + x * scale * devicePixelRatio;
    const toCanvasY = (y: number) => offsetY + y * scale * devicePixelRatio;
    const toCanvasW = (w: number) => w * scale * devicePixelRatio;
    const toCanvasH = (h: number) => h * scale * devicePixelRatio;

    if (detection && detection.packageBbox) {
      const box = detection.packageBbox;
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = Math.max(2, devicePixelRatio);
      ctx.setLineDash([]);
      ctx.strokeRect(
        toCanvasX(box.x), toCanvasY(box.y),
        toCanvasW(box.width), toCanvasH(box.height)
      );
    }

    const fields = [
      { value: detectionState.productName, evidence: detectionState.productNameEvidence, label: "PRODUCT NAME" },
      { value: detectionState.mrp, evidence: detectionState.mrpEvidence, label: "MRP" },
      { value: detectionState.netQuantity, evidence: detectionState.netQuantityEvidence, label: "NET QTY" },
      { value: detectionState.manufacturer, evidence: detectionState.manufacturerEvidence, label: "MANUFACTURER" },
      { value: detectionState.date, evidence: detectionState.dateEvidence, label: "DATE" },
      { value: detectionState.consumerCare, evidence: detectionState.consumerCareEvidence, label: "CONSUMER CARE" },
      { value: detectionState.countryOfOrigin, evidence: detectionState.countryOfOriginEvidence, label: "COUNTRY OF ORIGIN" },
      { value: detectionState.unitSalePrice, evidence: detectionState.unitSalePriceEvidence, label: "UNIT PRICE" },
    ];

    const yOff = 50;
    const lineH = Math.max(18, 22 * devicePixelRatio);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field.value || field.value.length === 0 || !field.evidence) continue;

      const evidence = field.evidence;
      const bx = evidence.bbox;
      if (!bx || bx.width <= 0 || bx.height <= 0) continue;

      const y = yOff + i * lineH;
      const displayValue = field.value.length > 30 ? field.value.slice(0, 30) + "…" : field.value;

      ctx.font = `${Math.max(11, 13 * devicePixelRatio)}px monospace`;
      const labelWidth = ctx.measureText(`[${field.label}] `).width;
      const valueWidth = ctx.measureText(displayValue).width;
      const confText = `${Math.round(evidence.confidence * 100)}%`;
      const confWidth = ctx.measureText(confText).width;
      const totalWidth = labelWidth + valueWidth;

      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillRect(toCanvasX(bx.x) - 2, toCanvasY(bx.y) - 2, totalWidth + 4 + confWidth + 6, lineH - 2);

      ctx.fillStyle = "#22c55e";
      ctx.fillText(`[${field.label}]`, toCanvasX(bx.x), toCanvasY(bx.y));
      ctx.fillStyle = "#ffffff";
      ctx.fillText(displayValue, toCanvasX(bx.x) + labelWidth, toCanvasY(bx.y));
      ctx.fillStyle = "#f59e0b";
      ctx.fillText(confText, toCanvasX(bx.x) + totalWidth + 6, toCanvasY(bx.y));
    }

    ctx.font = `bold ${Math.max(10, 12 * devicePixelRatio)}px monospace`;
    const badge = detection ? `● LIVE ${detection.inferenceMs}ms` : "● LIVE";
    const badgeWidth = ctx.measureText(badge).width;
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillRect(canvas.width - badgeWidth - 12, 8, badgeWidth + 24, 22);
    ctx.fillStyle = "#22c55e";
    ctx.textAlign = "right";
    ctx.fillText(badge, canvas.width - 12, 14);
    ctx.textAlign = "left";
  }, [detectionState, detection, videoRef, rotation, mirrored, devicePixelRatio, canvasRef]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const dpr = devicePixelRatio || 1;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const isRot90or270 = rotation === 90 || rotation === 270;
    const baseW = isRot90or270 ? vh : vw;
    const baseH = isRot90or270 ? vw : vh;

    canvas.width = Math.round(baseW * dpr);
    canvas.height = Math.round(baseH * dpr);

    const animate = () => {
      render();
      rafRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [render, devicePixelRatio, rotation, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: displayWidth,
        height: displayHeight,
        pointerEvents: "none",
        zIndex: 20,
      }}
    />
  );
}
