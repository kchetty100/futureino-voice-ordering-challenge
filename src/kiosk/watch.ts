"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceDetector } from "@mediapipe/tasks-vision";
import { nextPresence, type Presence, type WatchStatus } from "./presence";

type Sees = (video: HTMLVideoElement, now: number) => Promise<boolean>;

type NativeFaceDetector = {
  detect: (image: CanvasImageSource) => Promise<unknown[]>;
};

export function useCustomerWatch(video: HTMLVideoElement | null): {
  status: WatchStatus;
  present: boolean;
  enable: () => void;
} {
  const [status, setStatus] = useState<WatchStatus>("idle");
  const [present, setPresent] = useState(false);
  const enableRef = useRef<() => void>(() => {});
  const started = useRef(false);

  useEffect(() => {
    if (!video) return;
    const frame = video;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    const presence: Presence = { present: false, faces: 0, misses: 0 };
    let busy = false;

    const enable = () => {
      if (started.current) return;
      started.current = true;
      setStatus("starting");
      void run();
    };
    enableRef.current = enable;

    async function run() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        started.current = false;
        if (!cancelled) setStatus("blocked");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      frame.muted = true;
      frame.volume = 0;
      frame.srcObject = stream;
      await frame.play().catch(() => undefined);
      let sees: Sees;
      try {
        sees = await loadSees();
      } catch {
        if (!cancelled) setStatus("unavailable");
        return;
      }
      if (cancelled) return;
      let shown: WatchStatus = "looking";
      setStatus(shown);
      timer = window.setInterval(() => {
        if (busy || frame.readyState < 2) return;
        busy = true;
        void sees(frame, performance.now())
          .then((seen) => {
            if (cancelled) return;
            const next = nextPresence(presence, seen);
            if (next.present !== presence.present) setPresent(next.present);
            presence.present = next.present;
            presence.faces = next.faces;
            presence.misses = next.misses;
            const nextStatus: WatchStatus = next.present ? "seen" : "looking";
            if (nextStatus !== shown) {
              shown = nextStatus;
              setStatus(nextStatus);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            busy = false;
          });
      }, 300);
    }

    enable();
    return () => {
      cancelled = true;
      started.current = false;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      frame.srcObject = null;
    };
  }, [video]);

  return { status, present, enable: () => enableRef.current() };
}

async function loadSees(): Promise<Sees> {
  const Native = (
    globalThis as {
      FaceDetector?: new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => NativeFaceDetector;
    }
  ).FaceDetector;
  if (Native) {
    try {
      const detector = new Native({ fastMode: true, maxDetectedFaces: 3 });
      return async (frame) => (await detector.detect(frame)).length > 0;
    } catch {
      // This browser names FaceDetector but cannot run it.
    }
  }
  const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const files = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
  const model =
    "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
  const shared = { modelAssetPath: model };
  let detector: FaceDetector;
  try {
    detector = await FaceDetector.createFromOptions(files, {
      baseOptions: { ...shared, delegate: "GPU" },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.55,
    });
  } catch {
    detector = await FaceDetector.createFromOptions(files, {
      baseOptions: { ...shared, delegate: "CPU" },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.55,
    });
  }
  return async (frame, now) => detector.detectForVideo(frame, now).detections.length > 0;
}
