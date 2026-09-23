/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DetectionResult, LiveDetectionState, LiveDeclaration } from "@/services/live-inference";
import { emptyDetectionState, updateDetectionState, stateHasAnyDetection } from "@/services/live-inference";
import type { FrameAnalysisResult } from "@/services/frame-analysis";

/**
 * Full extraction cadence. Extraction is NOT attempted on every frame — the
 * camera loop only dispatches when the client-side quality signals and the
 * server package gate both say the frame is worth reading, then waits at
 * least this long between dispatches to bound server load in the field.
 */
const DISPATCH_INTERVAL_MS = 1500;
/** Clear the HUD detection state after the package has been out of view this long. */
const STALE_RESET_MS = 4000;

interface PendingFrame {
  canvas: HTMLCanvasElement;
  videoWidth: number;
  videoHeight: number;
  timestamp: number;
}

export class LiveCameraEngine {
  private videoRef: HTMLVideoElement | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private offscreenCtx: CanvasRenderingContext2D | null = null;
  private rafId: number | null = null;
  private isRunning = false;
  private isProcessing = false;
  private latestFrame: PendingFrame | null = null;
  private detectionState: LiveDetectionState = emptyDetectionState();
  private onDetectionUpdate: ((state: LiveDetectionState, detection: DetectionResult | null) => void) | null = null;
  private onStateChange: ((running: boolean) => void) | null = null;
  private cameraRotation = 0;
  private isMirrored = false;
  private devicePixelRatio = 1;
  private displayWidth = 0;
  private displayHeight = 0;
  private lastInferenceMs = 0;
  private lastDetectionAt = 0;
  private inferenceAbortController: AbortController | null = null;
  /** Latest Tier-0 client-side frame quality (sharp/glare/framing/steady). */
  private frameQuality: FrameAnalysisResult | null = null;
  /** Latest server package-gate state from /api/scan/live-guidance. */
  private gateStatus: string | null = null;

  constructor() {}

  setCallbacks(
    onDetectionUpdate: (state: LiveDetectionState, detection: DetectionResult | null) => void,
    onStateChange: (running: boolean) => void
  ) {
    this.onDetectionUpdate = onDetectionUpdate;
    this.onStateChange = onStateChange;
  }

  setCameraTransform(rotation: number, mirrored: boolean) {
    this.cameraRotation = rotation;
    this.isMirrored = mirrored;
  }

  setDisplayDimensions(width: number, height: number) {
    this.displayWidth = width;
    this.displayHeight = height;
  }

  setDevicePixelRatio(ratio: number) {
    this.devicePixelRatio = ratio;
  }

  /** Feed the latest Tier-0 frame quality into the dispatch policy. */
  setFrameQuality(quality: FrameAnalysisResult | null) {
    this.frameQuality = quality;
  }

  /** Feed the latest server package-gate state into the dispatch policy. */
  setGateStatus(state: string | null) {
    this.gateStatus = state;
  }

  getDetectionState(): LiveDetectionState {
    return this.detectionState;
  }

  start(
    videoRef: HTMLVideoElement,
    overlayCanvas: HTMLCanvasElement,
    offscreenCanvas: HTMLCanvasElement
  ): void {
    this.videoRef = videoRef;
    this.overlayCanvas = overlayCanvas;
    this.offscreenCanvas = offscreenCanvas;
    this.isRunning = true;

    const ctx = overlayCanvas.getContext("2d");
    this.overlayCtx = ctx;

    const offCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
    this.offscreenCtx = offCtx;

    this.devicePixelRatio = window.devicePixelRatio || 1;

    if (!this.offscreenCanvas) {
      this.offscreenCanvas = offscreenCanvas;
    }

    if (this.onStateChange) this.onStateChange(true);
    this.scheduleNextFrame();
  }

  stop(): void {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.inferenceAbortController) {
      this.inferenceAbortController.abort();
      this.inferenceAbortController = null;
    }
    this.latestFrame = null;
    this.lastDetectionAt = 0;
    if (this.onStateChange) this.onStateChange(false);
  }

  private scheduleNextFrame(): void {
    if (!this.isRunning) return;
    this.rafId = requestAnimationFrame(() => this.captureFrame());
  }

  private captureFrame(): void {
    if (!this.isRunning || !this.videoRef || !this.offscreenCtx || !this.offscreenCanvas) {
      this.scheduleNextFrame();
      return;
    }

    const video = this.videoRef;
    if (video.readyState < 2 || video.videoWidth === 0) {
      this.scheduleNextFrame();
      return;
    }

    const now = performance.now();
    if (now - this.lastInferenceMs < DISPATCH_INTERVAL_MS) {
      this.scheduleNextFrame();
      return;
    }

    // Smart dispatch: while the frame is blurry/glared/unframed or the server
    // package gate reports no package in view, skip the expensive extraction.
    // The Tier-0 HUD keeps guiding the officer; extraction resumes instantly
    // when the frame becomes readable again.
    if (!this.dispatchAllowed()) {
      this.maybeClearStaleState(now);
      this.scheduleNextFrame();
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const isRot90or270 = this.cameraRotation === 90 || this.cameraRotation === 270;
    const baseW = isRot90or270 ? vh : vw;
    const baseH = isRot90or270 ? vw : vh;

    const scale = Math.min(this.displayWidth / baseW, this.displayHeight / baseH);
    const dispW = baseW * scale;
    const dispH = baseH * scale;

    const targetW = Math.round(dispW * this.devicePixelRatio);
    const targetH = Math.round(dispH * this.devicePixelRatio);

    if (this.offscreenCanvas.width !== targetW || this.offscreenCanvas.height !== targetH) {
      this.offscreenCanvas.width = targetW;
      this.offscreenCanvas.height = targetH;
    }

    this.offscreenCtx.save();
    this.offscreenCtx.clearRect(0, 0, targetW, targetH);
    this.offscreenCtx.translate(targetW / 2, targetH / 2);
    this.offscreenCtx.rotate((this.cameraRotation * Math.PI) / 180);
    if (this.isMirrored) {
      this.offscreenCtx.scale(-1, 1);
    }
    const drawW = isRot90or270 ? targetH : targetW;
    const drawH = isRot90or270 ? targetW : targetH;
    this.offscreenCtx.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH);
    this.offscreenCtx.restore();

    const frame: PendingFrame = {
      canvas: this.offscreenCanvas,
      videoWidth: vw,
      videoHeight: vh,
      timestamp: now,
    };

    this.latestFrame = frame;
    this.lastInferenceMs = now;
    this.scheduleNextFrame();
    this.dispatchInference();
  }

  private dispatchAllowed(): boolean {
    // A still-polling (null) gate never blocks the first extraction attempt.
    if (this.gateStatus === "PACKAGE_NOT_DETECTED" || this.gateStatus === "QUALITY_INSUFFICIENT") {
      return false;
    }
    // Unknown quality (before the first Tier-0 sample) never blocks either.
    if (this.frameQuality !== null && !this.frameQuality.isReady) {
      return false;
    }
    return true;
  }

  private maybeClearStaleState(now: number): void {
    if (this.lastDetectionAt === 0) return;
    if (now - this.lastDetectionAt < STALE_RESET_MS) return;
    // Only clear when the OBJECT left the frame (gate says no package) — a
    // transient blur/glare while steadying the hand must not blank the HUD.
    if (this.gateStatus !== "PACKAGE_NOT_DETECTED" && this.gateStatus !== "QUALITY_INSUFFICIENT") {
      return;
    }
    if (!stateHasAnyDetection(this.detectionState)) return;
    this.detectionState = emptyDetectionState();
    this.lastDetectionAt = 0;
    if (this.onDetectionUpdate) this.onDetectionUpdate(this.detectionState, null);
  }

  private dispatchInference(): void {
    if (this.isProcessing) return;
    const frame = this.latestFrame;
    if (!frame) return;

    this.isProcessing = true;
    this.inferenceAbortController = new AbortController();

    const frameData = frame.canvas.toDataURL("image/jpeg", 0.85);

    fetch("/api/scan/live-detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: frameData, videoWidth: frame.videoWidth, videoHeight: frame.videoHeight }),
      signal: this.inferenceAbortController.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result) => {
        if (!this.isRunning) return;
        const detection = this.parseDetectionResult(result);
        if (detection) {
          this.lastDetectionAt = performance.now();
          this.detectionState = updateDetectionState(this.detectionState, detection);
          if (this.onDetectionUpdate) {
            this.onDetectionUpdate(this.detectionState, detection);
          }
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.warn("[LiveCameraEngine] Inference error:", err);
        }
      })
      .finally(() => {
        this.isProcessing = false;
        this.inferenceAbortController = null;
      });
  }

  private parseDetectionResult(result: any): DetectionResult | null {
    try {
      if (!result) return null;
      const declarations: LiveDeclaration[] = [];
      const rawOcrText = result.rawOcrText || "";
      const inferenceMs = result.inferenceMs || 0;
      const packageConfidence = result.packageConfidence || 0;

      if (result.declarations && Array.isArray(result.declarations)) {
        for (const d of result.declarations) {
          declarations.push({
            field: d.field,
            value: d.value,
            rawValue: d.rawValue,
            status: d.status,
            confidence: d.confidence,
            bbox: d.bbox,
            polygon: d.polygon,
            evidence: d.evidence,
          });
        }
      }

      const packageBbox = result.packageBbox;
      const packagePolygon = result.packagePolygon;

      return {
        packageDetected: result.packageDetected ?? false,
        packageConfidence,
        packageBbox: packageBbox ? { x: packageBbox.x, y: packageBbox.y, width: packageBbox.width, height: packageBbox.height } : undefined,
        packagePolygon,
        declarations,
        rawOcrText,
        inferenceMs,
      };
    } catch (err) {
      console.error("[LiveCameraEngine] Parse error:", err);
      return null;
    }
  }

  renderOverlay(state: LiveDetectionState, detection: DetectionResult | null): void {
    if (!this.overlayCtx || !this.overlayCanvas || !this.videoRef) return;
    const ctx = this.overlayCtx;
    const canvas = this.overlayCanvas;
    const video = this.videoRef;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const isRot90or270 = this.cameraRotation === 90 || this.cameraRotation === 270;
    const baseW = isRot90or270 ? vh : vw;
    const baseH = isRot90or270 ? vw : vh;

    const scale = Math.min(canvas.width / baseW, canvas.height / baseH);
    const offsetX = (canvas.width - baseW * scale) / 2;
    const offsetY = (canvas.height - baseH * scale) / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const toCanvasX = (x: number) => offsetX + x * scale * this.devicePixelRatio;
    const toCanvasY = (y: number) => offsetY + y * scale * this.devicePixelRatio;
    const toCanvasW = (w: number) => w * scale * this.devicePixelRatio;
    const toCanvasH = (h: number) => h * scale * this.devicePixelRatio;

    if (detection && detection.packageBbox) {
      const box = detection.packageBbox;
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.strokeRect(
        toCanvasX(box.x), toCanvasY(box.y),
        toCanvasW(box.width), toCanvasH(box.height)
      );

      if (detection.packagePolygon) {
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        const poly = detection.packagePolygon;
        ctx.moveTo(toCanvasX(poly[0][0]), toCanvasY(poly[0][1]));
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(toCanvasX(poly[i][0]), toCanvasY(poly[i][1]));
        }
        ctx.closePath();
        ctx.stroke();
      }
    }

    const fields = [
      { value: state.productName, evidence: state.productNameEvidence, label: "PRODUCT NAME" },
      { value: state.mrp, evidence: state.mrpEvidence, label: "MRP" },
      { value: state.netQuantity, evidence: state.netQuantityEvidence, label: "NET QUANTITY" },
      { value: state.manufacturer, evidence: state.manufacturerEvidence, label: "MANUFACTURER" },
      { value: state.date, evidence: state.dateEvidence, label: "DATE" },
      { value: state.consumerCare, evidence: state.consumerCareEvidence, label: "CONSUMER CARE" },
      { value: state.countryOfOrigin, evidence: state.countryOfOriginEvidence, label: "COUNTRY OF ORIGIN" },
      { value: state.unitSalePrice, evidence: state.unitSalePriceEvidence, label: "UNIT SALE PRICE" },
    ];

    const yOff = 50;
    const lineHeight = 24;
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field.value || field.value.length === 0) continue;

      const evidence = field.evidence;
      if (!evidence) continue;

      const y = yOff + i * lineHeight;
      const bx = evidence.bbox;

      if (bx && bx.width > 0 && bx.height > 0) {
        ctx.fillStyle = "rgba(34, 197, 94, 0.15)";
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 1;
        ctx.strokeRect(
          toCanvasX(bx.x), toCanvasY(bx.y),
          toCanvasW(bx.width), toCanvasH(bx.height)
        );
      }

      const label = field.label;
      const displayValue = field.value.length > 30 ? field.value.slice(0, 30) + "…" : field.value;
      const text = `[${label}] ${displayValue}`;

      const labelWidth = ctx.measureText(`[${label}] `).width;
      const valueWidth = ctx.measureText(displayValue).width;
      const totalWidth = labelWidth + valueWidth;

      ctx.font = "13px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.fillRect(toCanvasX(bx.x) - 2, toCanvasY(bx.y) - 2, totalWidth + 4, lineHeight - 2);

      ctx.fillStyle = "#22c55e";
      ctx.fillText(`[${label}]`, toCanvasX(bx.x), toCanvasY(bx.y));
      ctx.fillStyle = "#fff";
      ctx.fillText(displayValue, toCanvasX(bx.x) + labelWidth, toCanvasY(bx.y));

      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.font = "10px monospace";
      const confText = `${Math.round(evidence.confidence * 100)}%`;
      const confWidth = ctx.measureText(confText).width;
      ctx.fillRect(toCanvasX(bx.x) + totalWidth + 2, toCanvasY(bx.y) - 2, confWidth + 4, lineHeight - 2);
      ctx.fillStyle = "#f59e0b";
      ctx.fillText(confText, toCanvasX(bx.x) + totalWidth + 4, toCanvasY(bx.y));
    }

    const detectionBadge = detection
      ? `● LIVE (${detection.inferenceMs}ms)`
      : "● LIVE";
    ctx.font = "bold 12px monospace";
    const badgeWidth = ctx.measureText(detectionBadge).width;
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(canvas.width - badgeWidth - 12, 8, badgeWidth + 24, 22);
    ctx.fillStyle = "#22c55e";
    ctx.textAlign = "right";
    ctx.fillText(detectionBadge, canvas.width - 12, 12);
    ctx.textAlign = "left";
  }

  getInferenceInterval(): number {
    return DISPATCH_INTERVAL_MS;
  }

  isProcessingInference(): boolean {
    return this.isProcessing;
  }
}
