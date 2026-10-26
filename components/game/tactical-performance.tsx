'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, Mesh, type WebGLRenderer, type Scene } from 'three';
import { FrameBudget } from '@/lib/frame-budget';
import { debugFlag } from './world/lighting';

/** Keep the 3D view within the device's frame budget; HUD resolution is unchanged. */
export function AdaptiveFrameBudget({
  onQuality,
}: {
  onQuality: (quality: number) => void;
}) {
  const budget = useRef(new FrameBudget());
  useFrame((_state, delta) => {
    if (debugFlag('noadapt')) return;
    const previous = budget.current.quality;
    const quality = budget.current.sample(document.hidden ? 1 : delta);
    if (quality !== previous) onQuality(quality);
  });
  return null;
}

function clearMemorySample(gl: WebGLRenderer) {
  delete gl.domElement.dataset.memoryStats;
}

function sampleMemory(gl: WebGLRenderer, scene: Scene) {
  const buffers = new Set<ArrayBufferLike>();
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    for (const attribute of [
      geometry.index,
      ...Object.values(geometry.attributes),
    ]) {
      if (!attribute) continue;
      const array =
        attribute instanceof BufferAttribute
          ? attribute.array
          : attribute.data.array;
      buffers.add(array.buffer);
    }
  });
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
    }
  ).memory;
  gl.domElement.dataset.memoryStats = JSON.stringify({
    heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
    heapAllocatedMB: memory
      ? Math.round(memory.totalJSHeapSize / 1048576)
      : null,
    geometryMB:
      Math.round(
        [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0) /
          10485.76,
      ) / 100,
    geometries: gl.info.memory.geometries,
    textures: gl.info.memory.textures,
    programs: gl.info.programs?.length,
    width: gl.domElement.width,
    height: gl.domElement.height,
    antialias: gl.getContext().getContextAttributes()?.antialias,
  });
}

/** Browser heap and renderer resources, sampled without requesting another frame. */
export function MemoryMeasurements() {
  const { gl, scene } = useThree();
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const sample = () => sampleMemory(gl, scene);
    sample();
    const timer = window.setInterval(sample, 1000);
    return () => {
      window.clearInterval(timer);
      clearMemorySample(gl);
    };
  }, [gl, scene]);
  return null;
}

/** Development-only, DOM-readable measurements; no analytics or network reporting. */
export function FrameMeasurements() {
  const samples = useRef<number[]>([]);
  useFrame(({ gl, scene, camera }, delta) => {
    if (process.env.NODE_ENV === 'production' || document.hidden) return;
    // Development probes (headless measurements) reach the renderer here.
    (window as unknown as { __three?: object }).__three = { gl, scene, camera };
    const frames = samples.current;
    frames.push(delta * 1000);
    if (frames.length < 120) return;
    const elapsed = frames.reduce((sum, ms) => sum + ms, 0);
    const sorted = frames.slice().sort((a, b) => a - b);
    gl.domElement.dataset.frameStats = JSON.stringify({
      fps: Math.round((frames.length * 100000) / elapsed) / 100,
      p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100,
      draws: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      dpr: gl.getPixelRatio(),
    });
    frames.length = 0;
  });
  return null;
}
