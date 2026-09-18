"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ArrowUpRight,
  Camera,
  Check,
  Image as ImageIcon,
  Info,
  Lock,
  ScanLine,
  ShieldCheck,
  Upload,
  X,
  AlertTriangle,
  RefreshCw,
  FlipHorizontal,
  RotateCw,
  SwitchCamera,
  Plus,
  Trash2,
  Eye,
  Radio,
  RadioOff,
} from "lucide-react";
import type { AnalysisPhase, Inspection, EvidenceImage, DeclarationField } from "@/domain/inspection";
import { analyzeFrame, type FrameAnalysisResult } from "@/services/frame-analysis";
import { compressAndDownscaleImage } from "@/services/image-compression";
import type { UserRole } from "@/context/RoleContext";
import { LiveCameraEngine } from "@/services/live-camera-engine";
import type { LiveDetectionState, DetectionResult } from "@/services/live-inference";
import { emptyDetectionState } from "@/services/live-inference";

const phaseCopy: Record<AnalysisPhase, { label: string; detail: string }> = {
  image: { label: "Image normalization", detail: "Validating multi-frame package evidence" },
  text: { label: "YOLO region detection", detail: "Locating package & statutory declaration clusters" },
  declarations: { label: "Multi-pass regional OCR", detail: "Recognizing & normalizing declaration values" },
  rules: { label: "Statutory compliance", detail: "Evaluating Indian Legal Metrology Rules (2011)" },
  complete: { label: "Inspection ready", detail: "Evidence-backed compliance result assembled" },
};
const phaseOrder: AnalysisPhase[] = ["image", "text", "declarations", "rules", "complete"];

function cleanErrorMessage(msg: string | null): string {
  if (!msg) return "";
  if (
    msg.includes("prisma.inspectionRecord.upsert") ||
    msg.includes("foreign key") ||
    msg.includes("Foreign key constraint")
  ) {
    return "Inspection record database link has been refreshed. Please click 'Retry Analysis' to proceed.";
  }
  if (msg.includes("EXTRACTION_TIMEOUT") || msg.includes("timed out")) {
    return "Analysis timed out after 30 seconds. Click 'Retry Analysis' to evaluate the package again.";
  }
  const firstLine = msg.split("\n")[0];
  return firstLine.replace(/\/Users\/[^\s]+/g, "").replace(/at async [^\s]+/g, "").trim() || msg;
}

export function ScanView({
  role = "officer",
  inspection,
  phase,
  fileName,
  onUpload,
  onFiles,
  onAnalyze,
  inputRef,
  errorMsg,
  onDismissError,
  elapsed = 0,
  isTimeout = false,
  onRetry,
  activeFiles = [],
  onUpdateFiles,
  isAnalyzing: isAnalyzingProp,
}: {
  role?: UserRole;
  inspection: Inspection | null;
  phase: AnalysisPhase;
  fileName: string;
  onUpload: () => void;
  onFiles: (files: File[], append?: boolean) => void;
  onAnalyze: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  errorMsg: string | null;
  onDismissError?: () => void;
  elapsed?: number;
  isTimeout?: boolean;
  onRetry?: () => void;
  activeFiles?: File[];
  onUpdateFiles?: (files: File[]) => void;
  isAnalyzing?: boolean;
}) {
  const isAnalyzing = isAnalyzingProp !== undefined ? isAnalyzingProp : phase !== "image";
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  // Camera MUST NOT be mirrored by default so packaging text reads left-to-right
  const [isMirrored, setIsMirrored] = useState(false);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number>(0);
  const [sessionCapturedCount, setSessionCapturedCount] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Live detection state
  const [liveDetectEnabled, setLiveDetectEnabled] = useState(false);
  const [liveDetectionState, setLiveDetectionState] = useState<LiveDetectionState>(emptyDetectionState());
  const [liveDetection, setLiveDetection] = useState<DetectionResult | null>(null);
  const [liveInferenceMs, setLiveInferenceMs] = useState(0);
  const liveEngineRef = useRef<LiveCameraEngine | null>(null);
  const liveOverlayRef = useRef<HTMLCanvasElement>(null);
  const liveOffscreenRef = useRef<HTMLCanvasElement | null>(null);
  const liveDisplayRef = useRef<HTMLDivElement>(null);

  // Tier 0 Classical CV Frame Diagnostics State (100% Client-Side, 0ms latency)
  // Must be declared before the useEffect that references it.
  const [tier0Result, setTier0Result] = useState<FrameAnalysisResult | null>(null);

  // Server-side package-presence confirmation (same gate as the pipeline).
  // Must be declared before the useEffect at ~line 200 that references it.
  const [serverGate, setServerGate] = useState<{
    state: "LOOKING" | "PACKAGE_NOT_DETECTED" | "PACKAGE_DETECTED" | "CAPTURE_READY" | "QUALITY_INSUFFICIENT";
    tip: string;
  } | null>(null);

  // Live detection effect
  useEffect(() => {
    if (!liveDetectEnabled || !liveEngineRef.current) return;
    const engine = liveEngineRef.current;
    engine.setCameraTransform(rotation, isMirrored);
    if (liveDisplayRef.current) {
      engine.setDisplayDimensions(liveDisplayRef.current.offsetWidth, liveDisplayRef.current.offsetHeight);
    }
  }, [rotation, isMirrored, liveDetectEnabled]);

  // Update overlay when detection changes
  useEffect(() => {
    if (!liveEngineRef.current || !liveOverlayRef.current) return;
    liveEngineRef.current.renderOverlay(liveDetectionState, liveDetection);
  }, [liveDetectionState, liveDetection]);

  useEffect(() => {
    if (!cameraOpen && videoRef.current) {
      if (liveEngineRef.current) {
        liveEngineRef.current.stop();
        liveEngineRef.current = null;
      }
      setLiveDetectEnabled(false);
    }
  }, [cameraOpen]);

  // Live detection engine lifecycle: auto-starts the moment the camera opens
  // (automatic object detection + extraction — no manual toggle needed). The
  // engine's smart dispatch only extracts when Tier-0 quality signals and the
  // server package gate both say the frame is readable, so this is cheap when
  // the officer is still framing the product.
  useEffect(() => {
    if (!cameraOpen || !liveDetectEnabled) return;
    const video = videoRef.current;
    const overlayCanvas = liveOverlayRef.current;
    if (!video || !overlayCanvas) return;

    const offscreenCanvas = liveOffscreenRef.current || document.createElement("canvas");
    liveOffscreenRef.current = offscreenCanvas;

    const engine = new LiveCameraEngine();
    const handleDetection = (state: LiveDetectionState, detection: DetectionResult | null) => {
      setLiveDetectionState(state);
      setLiveDetection(detection);
      if (detection) {
        setLiveInferenceMs(detection.inferenceMs);
      }
    };
    const handleStateChange = (_running: boolean) => {
      // Engine state changed
    };
    engine.setCallbacks(handleDetection, handleStateChange);
    engine.setCameraTransform(rotationRef.current, isMirroredRef.current);
    engine.setDevicePixelRatio(window.devicePixelRatio || 1);
    const displayEl = liveDisplayRef.current;
    if (displayEl) {
      engine.setDisplayDimensions(displayEl.offsetWidth, displayEl.offsetHeight);
    }
    engine.start(video, overlayCanvas, offscreenCanvas);
    liveEngineRef.current = engine;

    return () => {
      engine.stop();
      if (liveEngineRef.current === engine) {
        liveEngineRef.current = null;
      }
    };
  }, [cameraOpen, liveDetectEnabled]);

  // Feed the latest Tier-0 quality and server package-gate state into the
  // engine's dispatch policy (smart dispatch: no OCR while blurry/no package).
  useEffect(() => {
    if (!liveEngineRef.current) return;
    liveEngineRef.current.setFrameQuality(tier0Result);
  }, [tier0Result]);

  useEffect(() => {
    if (!liveEngineRef.current) return;
    liveEngineRef.current.setGateStatus(serverGate?.state ?? null);
  }, [serverGate]);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );
      if (droppedFiles.length > 0) {
        onFiles(droppedFiles, true);
      }
    }
  }

  async function flipStagedImage(index: number) {
    if (!activeFiles || !activeFiles[index] || !onUpdateFiles) return;
    try {
      const file = activeFiles[index];
      const img = new Image();
      const url = URL.createObjectURL(file);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }

      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
      URL.revokeObjectURL(url);

      const flippedBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), file.type || "image/jpeg", 0.92);
      });

      if (flippedBlob) {
        const flippedFile = new File([flippedBlob], file.name, {
          type: file.type || "image/jpeg",
          lastModified: Date.now(),
        });
        const updated = [...activeFiles];
        updated[index] = flippedFile;
        onUpdateFiles(updated);
      }
    } catch (err) {
      console.error("Failed to flip staged image:", err);
    }
  }

  function removeStagedImage(index: number) {
    if (!activeFiles || !onUpdateFiles) return;
    const updated = activeFiles.filter((_, i) => i !== index);
    onUpdateFiles(updated);
    if (selectedImageIndex >= updated.length && updated.length > 0) {
      setSelectedImageIndex(updated.length - 1);
    }
  }

  const isMirroredRef = useRef(isMirrored);
  isMirroredRef.current = isMirrored;
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;

  // tier0Result is declared earlier in the component (see above) to avoid
  // the temporal dead zone in the useEffect that feeds it to the live engine.

  // serverGate is declared earlier in the component (see above) to avoid
  // the temporal dead zone in the useEffect that feeds it to the live engine.
  const gateInFlightRef = useRef(false);
  const gateCheck = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0 || gateInFlightRef.current) return;
    gateInFlightRef.current = true;
    try {
      const canvas = document.createElement("canvas");
      const scale = 320 / video.videoWidth;
      canvas.width = 320;
      canvas.height = Math.max(180, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      const res = await fetch("/api/scan/live-guidance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        const state = data.packageDetected
          ? data.packageConfidence >= 0.6 ? "CAPTURE_READY" : "PACKAGE_DETECTED"
          : data.state === "QUALITY_INSUFFICIENT" ? "QUALITY_INSUFFICIENT" : "PACKAGE_NOT_DETECTED";
        setServerGate({ state, tip: data.tip || "Looking for package..." });
      }
    } catch {
      // Guidance is advisory — Tier-0 HUD keeps working offline.
    } finally {
      gateInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!cameraOpen) {
      setServerGate(null);
      return;
    }
    setServerGate({ state: "LOOKING", tip: "Looking for package..." });
    const timer = setInterval(gateCheck, 2500);
    return () => clearInterval(timer);
  }, [cameraOpen]);

  const previousGrayRef = useRef<Uint8Array | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastSampleTimeRef = useRef<number>(0);

  const images = inspection?.images || [];
  const currentImage: EvidenceImage | undefined = images[selectedImageIndex] || images[0];

  useEffect(() => {
    if (cameraOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOpen]);

  // Adjust selected index when images change
  useEffect(() => {
    if (images.length > 0 && selectedImageIndex >= images.length) {
      setSelectedImageIndex(images.length - 1);
    }
  }, [images.length, selectedImageIndex]);

  // Real-time client-side classical CV frame sampling loop via requestAnimationFrame (~180ms throttle)
  useEffect(() => {
    if (!cameraOpen) {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      previousGrayRef.current = null;
      setTier0Result(null);
      return;
    }

    let isMounted = true;

    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement("canvas");
      offscreenCanvasRef.current.width = 320;
      offscreenCanvasRef.current.height = 240;
    }
    const canvas = offscreenCanvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const processFrame = (timestamp: number) => {
      if (!isMounted) return;

      if (timestamp - lastSampleTimeRef.current >= 180) {
        lastSampleTimeRef.current = timestamp;
        const video = videoRef.current;

        if (video && video.readyState >= 2 && video.videoWidth > 0 && ctx) {
          const curRot = rotationRef.current;
          const curMirror = isMirroredRef.current;
          const isRot90or270 = curRot === 90 || curRot === 270;
          const baseW = isRot90or270 ? video.videoHeight : video.videoWidth;
          const baseH = isRot90or270 ? video.videoWidth : video.videoHeight;
          const targetWidth = 320;
          const targetHeight = Math.round((baseH / baseW) * targetWidth) || 240;
          if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
          }

          ctx.save();
          ctx.translate(targetWidth / 2, targetHeight / 2);
          ctx.rotate((curRot * Math.PI) / 180);
          if (curMirror) {
            ctx.scale(-1, 1);
          }
          const drawW = isRot90or270 ? targetHeight : targetWidth;
          const drawH = isRot90or270 ? targetWidth : targetHeight;
          ctx.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();

          const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
          const { result, gray } = analyzeFrame(imageData, previousGrayRef.current);
          previousGrayRef.current = gray;

          if (isMounted) {
            setTier0Result(result);
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(processFrame);
    };

    rafIdRef.current = requestAnimationFrame(processFrame);

    return () => {
      isMounted = false;
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [cameraOpen]);

  async function openCamera(preferredMode?: "environment" | "user") {
    const targetMode = preferredMode ?? facingMode;
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera is unavailable in this browser.");
      return;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    try {
      let stream: MediaStream;
      try {
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: targetMode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          }),
          new Promise<MediaStream>((_, reject) =>
            setTimeout(() => reject(new Error("Camera permission request timed out.")), 8000)
          ),
        ]);
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      setFacingMode(targetMode);
      // Strictly unmirrored by default so packaging text reads left-to-right naturally
      setIsMirrored(false);
      setCameraOpen(true);
      // Automatic object detection + extraction starts with the camera.
      setLiveDetectEnabled(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (error) {
      setCameraError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Camera permission was denied."
          : error instanceof Error
          ? error.message
          : "Camera could not be opened."
      );
    }
  }

  function toggleFacingMode() {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
    setIsMirrored(false);
    openCamera(nextMode);
  }

  function toggleMirror() {
    setIsMirrored((prev) => !prev);
  }

  function cycleRotation() {
    setRotation((prev) => ((prev + 90) % 360) as 0 | 90 | 180 | 270);
  }

  function closeCamera() {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    if (liveEngineRef.current) {
      liveEngineRef.current.stop();
      liveEngineRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
    setLiveDetectEnabled(false);
    setTier0Result(null);
    previousGrayRef.current = null;
    setSessionCapturedCount(0);
  }

  function toggleLiveDetect() {
    if (liveDetectEnabled) {
      // Engine stop is owned by the lifecycle effect above.
      setLiveDetectEnabled(false);
      setLiveDetectionState(emptyDetectionState());
      setLiveDetection(null);
      return;
    }
    setLiveDetectEnabled(true);
  }

  function captureFrame(closeAfter = false) {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setCameraError("Camera frame is not ready yet.");
      return;
    }

    const curRot = rotationRef.current;
    const isRot90or270 = curRot === 90 || curRot === 270;
    const targetWidth = isRot90or270 ? video.videoHeight : video.videoWidth;
    const targetHeight = isRot90or270 ? video.videoWidth : video.videoHeight;

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Canvas context unavailable.");
      return;
    }

    // Evidence pixels are always unmirrored. Preview mirroring is a display-only
    // aid and must never become part of the statutory evidence record.
    ctx.save();
    ctx.translate(targetWidth / 2, targetHeight / 2);
    ctx.rotate((curRot * Math.PI) / 180);
    ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
    ctx.restore();

    canvas.toBlob(async (blob) => {
      if (blob) {
        try {
          const timestamp = Date.now();
          const count = sessionCapturedCount + 1;
          const compressedFile = await compressAndDownscaleImage(
            blob,
            `evidence-photo-${count}-${timestamp}.jpg`,
            1600,
            0.85
          );
          onFiles([compressedFile], true);
          setSessionCapturedCount(count);
          if (closeAfter) {
            closeCamera();
          }
        } catch (err) {
          console.error("Failed to compress captured frame, using raw file fallback:", err);
          const rawFile = new File([blob], `evidence-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
          onFiles([rawFile], true);
          if (closeAfter) {
            closeCamera();
          }
        }
      } else {
        setCameraError("Failed to create image from camera frame.");
      }
    }, "image/jpeg", 0.92);
  }

  return (
    <div className="page-enter">
      <div className="eyebrow">LEGAL METROLOGY INSPECTION / {inspection?.id || "DRAFT"}</div>
      <div className="page-heading">
        <div>
          <h1>Evidence Capture Console</h1>
          <p>Capture multi-angle package evidence (Front, Back, MRP/Date panel, Ingredients) for statutory evaluation.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span className="capture-badge">
            <span className="status-dot" style={{ backgroundColor: images.length > 0 ? "#10b981" : "#f59e0b" }} />
            {images.length} Evidence Photo{images.length === 1 ? "" : "s"} Staged
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="inspection-notice-banner">
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0 }}>
            <div className="inspection-notice-icon">
              <AlertTriangle size={18} />
            </div>
            <div className="inspection-notice-body">
              <div className="inspection-notice-title">Pipeline Notice</div>
              <div className="inspection-notice-text">{cleanErrorMessage(errorMsg)}</div>
            </div>
          </div>
          <div className="inspection-notice-actions">
            <button
              type="button"
              className="button primary"
              style={{ fontSize: "13px", padding: "6px 14px", whiteSpace: "nowrap" }}
              onClick={onRetry || onAnalyze}
            >
              <RefreshCw size={14} /> Retry Analysis
            </button>
            {onDismissError && (
              <button
                type="button"
                onClick={onDismissError}
                title="Dismiss notice"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#92400e",
                  cursor: "pointer",
                  padding: "6px",
                  display: "flex",
                  alignItems: "center",
                  borderRadius: "4px",
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="scan-layout">
        <section className="capture-panel">
          <div className="capture-head">
            <div>
              <span className="eyebrow">
                EVIDENCE FRAME {String(selectedImageIndex + 1).padStart(2, "0")} / {String(Math.max(1, images.length)).padStart(2, "0")}
              </span>
              <h2>{currentImage?.side ? `${currentImage.side.toUpperCase()} VIEW` : "PRIMARY PACKAGE FACE"}</h2>
            </div>
            {images.length > 0 && (
              <span className="quality-badge">
                <Check size={13} /> {currentImage?.width} × {currentImage?.height}px
              </span>
            )}
          </div>

          {/* Main Inspection Viewport */}
          <div
            className={`scan-stage ${images.length ? "has-image" : ""} ${isDragging ? "drag-over" : ""}`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={currentImage ? { backgroundImage: `url(${currentImage.uri})` } : undefined}
          >
            {!images.length && (
              <div className="drop-prompt">
                <div className="drop-icon">
                  <Upload size={24} />
                </div>
                <b>Drop food package images here</b>
                <span>Supports JPG, PNG, WEBP (front, back, and declaration sides)</span>
                <div className="capture-actions" style={{ marginTop: "16px", display: "flex", gap: "10px" }}>
                  <button className="button secondary" onClick={onUpload}>
                    <Upload size={15} /> Upload image(s)
                  </button>
                  <button className="button primary" onClick={() => openCamera("environment")}>
                    <Camera size={15} /> Launch camera
                  </button>
                </div>
              </div>
            )}

            {!!images.length && (
              <div className="capture-overlay">
                <span>
                  <span className="status-dot" style={{ backgroundColor: "#10b981" }} /> Frame {selectedImageIndex + 1} of {images.length} locked
                </span>
                <div className="capture-overlay-actions" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {activeFiles && activeFiles[selectedImageIndex] && onUpdateFiles && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => flipStagedImage(selectedImageIndex)}
                      title="Flip photo horizontally to unmirror backward package text"
                      style={{ fontSize: "12px", padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                    >
                      <FlipHorizontal size={14} /> Flip / Unmirror
                    </button>
                  )}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => openCamera("environment")}
                    style={{ fontSize: "12px", padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <Camera size={14} /> Add photo
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={onUpload}
                    style={{ fontSize: "12px", padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <Plus size={14} /> Add file
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Hidden File Input */}
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                onFiles([...event.target.files], true);
              }
              event.target.value = "";
            }}
          />

          {/* Multi-Photo Evidence Gallery Strip */}
          {images.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span className="eyebrow" style={{ color: "var(--muted)" }}>
                  STAGED EVIDENCE GALLERY ({images.length} PHOTOS)
                </span>
                <span style={{ fontSize: "0.76rem", color: "var(--muted)" }}>Click a frame to inspect</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                  gap: "10px",
                }}
              >
                {images.map((img, idx) => (
                  <div
                    key={img.id || idx}
                    onClick={() => setSelectedImageIndex(idx)}
                    style={{
                      position: "relative",
                      height: "95px",
                      borderRadius: "6px",
                      overflow: "hidden",
                      cursor: "pointer",
                      border: idx === selectedImageIndex ? "2px solid #2563eb" : "1px solid rgba(255,255,255,0.15)",
                      boxShadow: idx === selectedImageIndex ? "0 0 0 2px rgba(37,99,235,0.3)" : "none",
                      backgroundImage: `url(${img.uri})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {activeFiles && activeFiles[idx] && onUpdateFiles && (
                      <div
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          display: "flex",
                          gap: "4px",
                          zIndex: 3,
                        }}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            flipStagedImage(idx);
                          }}
                          title="Flip photo horizontally (unmirror)"
                          style={{
                            background: "rgba(15, 23, 42, 0.85)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "4px",
                            color: "#fff",
                            width: "22px",
                            height: "22px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          <FlipHorizontal size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeStagedImage(idx);
                          }}
                          title="Remove photo"
                          style={{
                            background: "rgba(15, 23, 42, 0.85)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "4px",
                            color: "#f87171",
                            width: "22px",
                            height: "22px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: "rgba(15, 23, 42, 0.85)",
                        padding: "3px 6px",
                        fontSize: "0.7rem",
                        color: "#fff",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>Photo {idx + 1}</span>
                      <span style={{ textTransform: "capitalize", opacity: 0.8 }}>{img.side || "frame"}</span>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => openCamera("environment")}
                  style={{
                    height: "90px",
                    borderRadius: "6px",
                    border: "2px dashed rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.02)",
                    color: "var(--muted)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    cursor: "pointer",
                    fontSize: "0.75rem",
                  }}
                >
                  <Camera size={18} />
                  <span>+ Add photo</span>
                </button>
              </div>
            </div>
          )}

          {/* Camera Dialog */}
          {cameraOpen && (
            <div className="camera-dialog" style={{ position: "relative", display: "flex", flexDirection: "column", gap: "10px", marginTop: "16px" }}>
              {/* Camera Controls Bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "#0f172a",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.15)",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={toggleMirror}
                    style={{
                      fontSize: "12px",
                      padding: "6px 12px",
                      backgroundColor: isMirrored ? "#b45309" : "#15803d",
                      color: "#fff",
                      borderColor: isMirrored ? "#f59e0b" : "#22c55e",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                    title="Toggle horizontal mirror"
                  >
                    <FlipHorizontal size={14} />
                    {isMirrored ? "Feed: Mirrored (Inverted)" : "Feed: Normal (Unmirrored)"}
                  </button>

                  <button
                    type="button"
                    className="button secondary"
                    onClick={cycleRotation}
                    style={{
                      fontSize: "12px",
                      padding: "5px 11px",
                      backgroundColor: rotation !== 0 ? "#2563eb" : "rgba(255,255,255,0.1)",
                      color: "#fff",
                      borderColor: rotation !== 0 ? "#3b82f6" : "rgba(255,255,255,0.2)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    <RotateCw size={14} />
                    {rotation}°
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                   <button
                     type="button"
                     className="button secondary"
                     onClick={toggleFacingMode}
                     style={{
                       fontSize: "12px",
                       padding: "5px 11px",
                       backgroundColor: "rgba(255,255,255,0.1)",
                       color: "#fff",
                       borderColor: "rgba(255,255,255,0.2)",
                       display: "inline-flex",
                       alignItems: "center",
                       gap: "6px",
                       cursor: "pointer",
                       fontWeight: 600,
                     }}
                   >
                     <SwitchCamera size={14} />
                     {facingMode === "environment" ? "Rear Camera" : "Front Camera"}
                   </button>

                   <button
                     type="button"
                     className={liveDetectEnabled ? "button secondary" : "button secondary"}
                     onClick={toggleLiveDetect}
                     style={{
                       fontSize: "12px",
                       padding: "5px 11px",
                       backgroundColor: liveDetectEnabled ? "#dc2626" : "rgba(34,197,94,0.3)",
                       color: "#fff",
                       borderColor: liveDetectEnabled ? "#dc2626" : "#22c55e",
                       display: "inline-flex",
                       alignItems: "center",
                       gap: "6px",
                       cursor: "pointer",
                       fontWeight: 600,
                     }}
                   >
                     {liveDetectEnabled ? <RadioOff size={14} /> : <Radio size={14} />}
                     {liveDetectEnabled ? "Stop Live Detect" : "Live Detect"}
                   </button>

                   <button
                     type="button"
                     className="icon-button light"
                     onClick={closeCamera}
                     title="Close camera"
                   >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Verified Non-Mirrored Rear Camera Guarantee Banner */}
              <div
                style={{
                  backgroundColor: isMirrored ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)",
                  border: `1px solid ${isMirrored ? "rgba(245, 158, 11, 0.35)" : "rgba(16, 185, 129, 0.35)"}`,
                  color: isMirrored ? "#fcd34d" : "#34d399",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {isMirrored ? <AlertTriangle size={13} /> : <Check size={13} />}
                <span>
                  <b>Orientation:</b>{" "}
                  {isMirrored
                    ? "Mirror mode active (inverted). Click 'Feed: Normal' for readable package text."
                    : "1:1 Unmirrored feed. Package text and labels read naturally left-to-right."}
                </span>
              </div>

                 {/* Video Preview */}
                <div
                  ref={liveDisplayRef}
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    borderRadius: "8px",
                    backgroundColor: "#000",
                    minHeight: "280px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    style={{
                      width: "100%",
                      height: "auto",
                      display: "block",
                      transform: `${isMirrored ? "scaleX(-1) " : ""}${rotation ? `rotate(${rotation}deg)` : ""}`.trim() || "none",
                      transformOrigin: "center center",
                      transition: "transform 0.25s ease",
                    }}
                  />

                  {/* Live Detection Canvas Overlay */}
                  {liveDetectEnabled && (
                    <>
                      <canvas
                        ref={liveOverlayRef}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: "100%",
                          pointerEvents: "none",
                          zIndex: 20,
                        }}
                      />
                      <canvas ref={liveOffscreenRef} style={{ display: "none" }} />

                      {/* Live Detection HUD */}
                      <div
                        style={{
                          position: "absolute",
                          bottom: "10px",
                          left: "10px",
                          right: "10px",
                          pointerEvents: "none",
                          zIndex: 20,
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        <div
                          style={{
                            backgroundColor: "rgba(15, 23, 42, 0.9)",
                            backdropFilter: "blur(6px)",
                            padding: "8px 12px",
                            borderRadius: "6px",
                            border: "1px solid rgba(34,197,94,0.4)",
                          }}
                        >
                          <div style={{ color: "#22c55e", fontSize: "0.76rem", fontWeight: 700, marginBottom: "4px" }}>
                            ● LIVE DETECTION {liveInferenceMs > 0 ? `(${liveInferenceMs}ms)` : ""}
                          </div>
                          {liveDetectionState.productName && (
                            <div style={{ color: "#fff", fontSize: "0.72rem" }}>PRODUCT: {liveDetectionState.productName}</div>
                          )}
                          {liveDetectionState.mrp && (
                            <div style={{ color: "#fff", fontSize: "0.72rem" }}>MRP: {liveDetectionState.mrp}</div>
                          )}
                          {liveDetectionState.netQuantity && (
                            <div style={{ color: "#fff", fontSize: "0.72rem" }}>NET QTY: {liveDetectionState.netQuantity}</div>
                          )}
                          {liveDetectionState.manufacturer && (
                            <div style={{ color: "#fff", fontSize: "0.72rem" }}>MFR: {liveDetectionState.manufacturer}</div>
                          )}
                          {liveDetectionState.date && (
                            <div style={{ color: "#fff", fontSize: "0.72rem" }}>DATE: {liveDetectionState.date}</div>
                          )}
                          {!liveDetectionState.productName && !liveDetectionState.mrp && (
                            <div style={{ color: "#f59e0b", fontSize: "0.7rem" }}>Waiting for package detection...</div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Tier 0 HUD Overlay */}
                  {!liveDetectEnabled && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        pointerEvents: "none",
                        zIndex: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          backgroundColor: "rgba(15, 23, 42, 0.88)",
                          backdropFilter: "blur(6px)",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          color: "#fff",
                          fontSize: "0.76rem",
                          border: "1px solid rgba(255,255,255,0.15)",
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span
                            className="status-dot"
                            style={{ backgroundColor: serverGate?.state === "CAPTURE_READY" ? "#10b981" : "#f59e0b" }}
                          />
                          <b>
                            {serverGate?.state === "CAPTURE_READY"
                              ? "PACKAGE DETECTED — READY TO CAPTURE"
                              : serverGate?.state === "PACKAGE_DETECTED"
                                ? "PACKAGE DETECTED"
                                : serverGate?.state === "QUALITY_INSUFFICIENT"
                                  ? "IMAGE QUALITY INSUFFICIENT"
                                  : "LOOKING FOR PACKAGE..."}
                          </b>
                        </span>
                        <span style={{ fontSize: "0.7rem", opacity: 0.75 }}>Package Gate</span>
                      </div>

                      <div
                        style={{
                          backgroundColor: serverGate?.state === "CAPTURE_READY" ? "rgba(16, 185, 129, 0.9)" : "rgba(180, 83, 9, 0.9)",
                          backdropFilter: "blur(6px)",
                          padding: "6px 10px",
                          borderRadius: "6px",
                          color: "#fff",
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          border: "1px solid rgba(255,255,255,0.25)",
                        }}
                      >
                        <span>{serverGate?.state === "CAPTURE_READY" ? "✓" : "💡"}</span>
                        <span>{serverGate?.tip || "Looking for package..."}</span>
                      </div>
                      {tier0Result && !tier0Result.isReady && (
                        <div
                          style={{
                            backgroundColor: "rgba(15, 23, 42, 0.85)",
                            padding: "5px 10px",
                            borderRadius: "6px",
                            color: "#fcd34d",
                            fontSize: "0.74rem",
                            border: "1px solid rgba(255,255,255,0.15)",
                          }}
                        >
                          Sensor: {tier0Result.tip}
                        </div>
                      )}
                    </div>
                  )}

                {/* Reticle guide overlay */}
                <div
                  style={{
                    position: "absolute",
                    top: "15%",
                    left: "10%",
                    right: "10%",
                    bottom: "15%",
                    border: "2px dashed rgba(255,255,255,0.4)",
                    borderRadius: "12px",
                    pointerEvents: "none",
                  }}
                />
              </div>

              {/* Capture Action Bar */}
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  justifyContent: "center",
                  alignItems: "center",
                  padding: "10px",
                  background: "#0f172a",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                <button
                  type="button"
                  className="button primary"
                  onClick={() => captureFrame(false)}
                  style={{
                    fontSize: "14px",
                    padding: "8px 18px",
                    backgroundColor: "#16a34a",
                    borderColor: "#22c55e",
                    fontWeight: 700,
                  }}
                >
                  <Camera size={16} /> Capture Photo ({sessionCapturedCount} Staged)
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => captureFrame(true)}
                  style={{ fontSize: "14px", padding: "8px 14px" }}
                >
                  Capture & Done
                </button>
              </div>
            </div>
          )}

          {cameraError && (
            <div style={{ color: "#ef4444", fontSize: "0.82rem", marginTop: "8px" }}>
              <b>Camera Error:</b> {cameraError}
            </div>
          )}
        </section>

        {/* Action / Execution Sidebar */}
        <section className="analysis-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">PIPELINE EXECUTION</span>
              <h2>Run Inspection</h2>
            </div>
          </div>

          <div className="pipeline-steps-grid">
            {phaseOrder.map((p, index) => {
              const currentPhaseIndex = phaseOrder.indexOf(phase);
              const isPast = currentPhaseIndex > index;
              const isCurrent = currentPhaseIndex === index;
              return (
                <div
                  key={p}
                  className={`pipeline-step-card ${isPast ? "done" : isCurrent ? "active" : ""}`}
                >
                  <div className="pipeline-step-header">
                    <div className="pipeline-step-badge">
                      {isPast ? <Check size={12} /> : <span>{index + 1}</span>}
                    </div>
                    {isCurrent && <span className="pipeline-step-live-dot" />}
                  </div>
                  <div className="pipeline-step-content">
                    <strong className="pipeline-step-title">{phaseCopy[p].label}</strong>
                    <span className="pipeline-step-desc">{phaseCopy[p].detail}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <button
              className="button primary"
              disabled={isAnalyzing || (images.length === 0 && (!activeFiles || activeFiles.length === 0))}
              onClick={onAnalyze}
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "15px",
                fontWeight: 700,
                justifyContent: "center",
              }}
            >
              {isAnalyzing ? (
                <>
                  <RefreshCw size={16} className="spin" /> Processing Evidence ({elapsed}s)...
                </>
              ) : (
                <>
                  <ScanLine size={16} /> Run Statutory Compliance Analysis
                </>
              )}
            </button>

            <div style={{ fontSize: "0.78rem", color: "var(--muted)", textAlign: "center" }}>
              Deterministic YOLO/layout detection + regional OCR · LM (PC) Rules 2011
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
