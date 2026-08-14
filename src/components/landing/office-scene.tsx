"use client";

import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Html, RoundedBox } from "@react-three/drei";
import { useReducedMotion } from "framer-motion";
import * as THREE from "three";

/**
 * The landing hero's 3D visual: a stylised office block, its geofence ring,
 * and employee markers orbiting in and out of the perimeter.
 *
 * Constraints this scene is built to:
 *  - It is loaded only by `HeroVisual`, behind a dynamic import, so three.js
 *    never enters the bundle of any other route.
 *  - `dpr` is capped at 1.5 and the frameloop is demand-free but light: a few
 *    dozen meshes, no shadows, no post-processing. It must not melt a phone.
 *  - With `prefers-reduced-motion`, everything holds still — the composition
 *    still reads, it simply stops moving.
 */

const BRAND = "#6366f1";
const ACCENT = "#22d3ee";
const VIOLET = "#a855f7";

/** Employee marker: a capsule that drifts along a circular path. */
function Marker({
  radius,
  speed,
  offset,
  color,
  height,
  animate,
}: {
  radius: number;
  speed: number;
  offset: number;
  color: string;
  height: number;
  animate: boolean;
}) {
  const ref = React.useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!ref.current || !animate) return;
    const t = clock.getElapsedTime() * speed + offset;
    ref.current.position.x = Math.cos(t) * radius;
    ref.current.position.z = Math.sin(t) * radius;
    // Gentle bob so the markers don't read as a rigid carousel.
    ref.current.position.y = height + Math.sin(t * 2) * 0.06;
  });

  const initial = new THREE.Vector3(Math.cos(offset) * radius, height, Math.sin(offset) * radius);

  return (
    <group ref={ref} position={initial}>
      <mesh>
        <capsuleGeometry args={[0.09, 0.16, 4, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.45} roughness={0.3} />
      </mesh>
      {/* Ground dot, so each marker reads as standing somewhere. */}
      <mesh position={[0, -0.22, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.14, 20]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} />
      </mesh>
    </group>
  );
}

/** The geofence: a translucent disc with a bright rim. */
function GeofenceRing({ animate }: { animate: boolean }) {
  const ringRef = React.useRef<THREE.Mesh>(null);
  const pulseRef = React.useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!animate) return;
    const t = clock.getElapsedTime();
    if (ringRef.current) ringRef.current.rotation.z = t * 0.12;
    if (pulseRef.current) {
      // 0 → 1 sawtooth expands the pulse outward, fading as it goes.
      const phase = (t % 3.2) / 3.2;
      const scale = 0.55 + phase * 0.75;
      pulseRef.current.scale.set(scale, scale, scale);
      const material = pulseRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.34 * (1 - phase);
    }
  });

  return (
    <group position={[0, -0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <circleGeometry args={[2.5, 64]} />
        <meshBasicMaterial color={BRAND} transparent opacity={0.09} />
      </mesh>
      <mesh ref={ringRef}>
        <ringGeometry args={[2.42, 2.5, 64]} />
        <meshBasicMaterial color={BRAND} transparent opacity={0.75} />
      </mesh>
      <mesh ref={pulseRef}>
        <ringGeometry args={[2.3, 2.5, 64]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.3} />
      </mesh>
      {/* Grid rings, to read as a plan view rather than a plain disc. */}
      {[0.85, 1.6].map((r) => (
        <mesh key={r}>
          <ringGeometry args={[r - 0.006, r, 64]} />
          <meshBasicMaterial color={BRAND} transparent opacity={0.18} />
        </mesh>
      ))}
    </group>
  );
}

/** The office block itself. */
function OfficeBuilding() {
  return (
    <group position={[0, -0.15, 0]}>
      <RoundedBox args={[1.5, 1.15, 1.5]} radius={0.09} smoothness={4} position={[0, 0, 0]}>
        <meshStandardMaterial color="#eef2ff" roughness={0.35} metalness={0.12} />
      </RoundedBox>
      <RoundedBox args={[1.1, 0.85, 1.1]} radius={0.08} smoothness={4} position={[0, 0.98, 0]}>
        <meshStandardMaterial color="#c7d2fe" roughness={0.3} metalness={0.18} />
      </RoundedBox>
      <RoundedBox args={[0.66, 0.6, 0.66]} radius={0.07} smoothness={4} position={[0, 1.68, 0]}>
        <meshStandardMaterial color={BRAND} roughness={0.25} metalness={0.3} emissive={BRAND} emissiveIntensity={0.18} />
      </RoundedBox>

      {/* Window bands. Two thin emissive strips read as glazing at this scale. */}
      {[-0.24, 0.2].map((y) => (
        <mesh key={y} position={[0, y, 0.76]}>
          <planeGeometry args={[1.16, 0.16]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0.5} />
        </mesh>
      ))}

      <mesh position={[0, -0.57, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.15, 32]} />
        <meshBasicMaterial color="#312e81" transparent opacity={0.18} />
      </mesh>
    </group>
  );
}

/** Floating glass card rendered as DOM inside the scene, for crisp text. */
function FloatingCard({
  position,
  children,
  animate,
}: {
  position: [number, number, number];
  children: React.ReactNode;
  animate: boolean;
}) {
  return (
    <Float
      speed={animate ? 1.4 : 0}
      rotationIntensity={animate ? 0.14 : 0}
      floatIntensity={animate ? 0.5 : 0}
      position={position}
    >
      <Html
        center
        distanceFactor={6}
        // `pointer-events-none` keeps the cards decorative; the real controls
        // are the CTAs beneath the canvas.
        wrapperClass="pointer-events-none select-none"
      >
        <div className="pointer-events-none w-max rounded-xl border border-white/25 bg-white/85 px-3 py-2 shadow-[0_8px_32px_-12px_rgba(15,23,42,0.4)] backdrop-blur-md dark:border-white/10 dark:bg-[rgb(24_28_47/0.85)]">
          {children}
        </div>
      </Html>
    </Float>
  );
}

function SceneContents({ animate }: { animate: boolean }) {
  const groupRef = React.useRef<THREE.Group>(null);

  useFrame(({ clock, pointer }) => {
    if (!groupRef.current || !animate) return;
    const t = clock.getElapsedTime();
    // Slow idle rotation, nudged by the pointer for a sense of depth.
    groupRef.current.rotation.y = t * 0.13 + pointer.x * 0.22;
    groupRef.current.rotation.x = THREE.MathUtils.lerp(
      groupRef.current.rotation.x,
      -pointer.y * 0.1,
      0.05,
    );
  });

  return (
    <>
      <ambientLight intensity={1.15} />
      <directionalLight position={[4, 6, 3]} intensity={1.6} color="#ffffff" />
      <directionalLight position={[-4, 2, -3]} intensity={0.7} color={VIOLET} />
      <pointLight position={[0, 3, 0]} intensity={12} distance={9} color={ACCENT} />

      <group ref={groupRef}>
        <OfficeBuilding />
        <GeofenceRing animate={animate} />

        <Marker radius={1.95} speed={0.35} offset={0} color={ACCENT} height={-0.5} animate={animate} />
        <Marker radius={2.15} speed={0.28} offset={2.1} color="#34d399" height={-0.5} animate={animate} />
        <Marker radius={1.7} speed={0.42} offset={4.0} color={VIOLET} height={-0.5} animate={animate} />
        {/* Deliberately outside the ring — the "outside the geofence" case. */}
        <Marker radius={3.1} speed={0.22} offset={5.2} color="#fb7185" height={-0.5} animate={animate} />

        <FloatingCard position={[-2.5, 1.5, 0.6]} animate={animate}>
          <p className="text-[0.5rem] font-medium text-slate-500 dark:text-slate-400">Present today</p>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">218 / 240</p>
        </FloatingCard>

        <FloatingCard position={[2.6, 1.15, -0.3]} animate={animate}>
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <p className="text-[0.5rem] font-medium text-slate-900 dark:text-white">Inside geofence</p>
          </div>
          <p className="text-[0.5rem] text-slate-500 dark:text-slate-400">Verified · 42 m</p>
        </FloatingCard>

        <FloatingCard position={[2.1, -1.25, 1.1]} animate={animate}>
          <p className="text-[0.5rem] font-medium text-slate-500 dark:text-slate-400">Tasks completed</p>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">42 this week</p>
        </FloatingCard>
      </group>
    </>
  );
}

export default function OfficeScene() {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion;

  return (
    <Canvas
      camera={{ position: [0, 2.2, 7.2], fov: 42 }}
      // Cap the pixel ratio: a 3× phone screen would otherwise render 9× the
      // pixels for no visible gain on a decorative scene.
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
    >
      <SceneContents animate={animate} />
    </Canvas>
  );
}
