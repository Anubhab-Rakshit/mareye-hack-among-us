"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as THREE from "three";
import {
  Globe2, Radar, Shield, Target, AlertTriangle,
  Crosshair, Anchor, RefreshCw, Activity, Eye, EyeOff,
  Navigation, Waves, Wind,
} from "lucide-react";
import { WarRoomHoneypotFeed } from "@/components/war-room-honeypot-feed";

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════
interface ZoneData {
  id: string; name: string; lat: number; lon: number; command: string; hq: string;
  marine: any; weather: any;
  threat: { level: number; category: string; factors: { name: string; score: number; detail: string }[] };
  ops: { operation: string; ready: boolean; confidence: number; status: string; conditions: string }[];
}
interface IntelResponse {
  timestamp: string; zones: ZoneData[];
  summary: { totalZones: number; criticalZones: number; highZones: number; moderateZones: number; lowZones: number; avgThreat: number; overallReadiness: number };
  brief: string;
}
interface NavalAsset {
  id: string; name: string; type: "carrier" | "submarine" | "destroyer" | "patrol" | "aircraft" | "base";
  lat: number; lng: number; heading: number; speed: number;
  status: "active" | "alert" | "patrol" | "docked"; threat: "friendly" | "hostile" | "neutral"; details: string;
}

// ═══════════════════════════════════════════════════════════
// CONSTANTS & GEO HELPERS
// ═══════════════════════════════════════════════════════════
const GLOBE_R = 2.5;

// Real-world Earth textures (NASA Blue Marble — public domain)
const EARTH_TEXTURE_URL = "https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg";
const EARTH_NIGHT_URL = "https://unpkg.com/three-globe@2.31.1/example/img/earth-night.jpg";
const EARTH_TOPO_URL = "https://unpkg.com/three-globe@2.31.1/example/img/earth-topology.png";
const EARTH_WATER_URL = "https://unpkg.com/three-globe@2.34.2/example/img/earth-water.png";

function geoTo3D(lat: number, lng: number, r: number = GLOBE_R): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(r) * Math.sin(phi) * Math.cos(theta),
    (r) * Math.cos(phi),
    (r) * Math.sin(phi) * Math.sin(theta),
  );
}

// ═══════════════════════════════════════════════════════════
// TACTICAL OVERLAYS (on real texture)
// ═══════════════════════════════════════════════════════════
const INDIA_COAST: [number, number][] = [
  [25,68],[23.5,68.5],[22.3,69.5],[21,70.5],[20.7,71],[20.2,72.8],[19,72.8],[18.5,73],
  [17,73.3],[15.4,73.9],[14.8,74.1],[13,74.8],[12,75],[10,76.2],[8.5,77],[8,77.5],
  [8.3,77.8],[9.2,79],[10,79.3],[10.8,79.8],[13.1,80.3],[14.5,80.1],[15.9,80.2],[17,82],
  [17.7,83.3],[19,84.8],[19.8,85.8],[21,86.8],[21.5,87],[22,88],[22.5,88.6],[23,89],
];
const SRI_LANKA: [number,number][] = [[9.8,80],[9,79.7],[8,79.8],[7,79.8],[6,80.2],[6.2,81.2],[7.5,81.8],[9,80.4],[9.8,80]];

// EEZ boundary (approximate)
const EEZ_INDIA: [number,number][] = [
  [25,60],[20,58],[14,62],[6,65],[0,68],[-4,72],[-4,78],[-2,85],[2,92],[8,96],[14,94],[18,92],[22,90],[25,88],[28,82],[28,72],[25,60],
];

// Shipping lanes
const SHIPPING_LANE_1: [number,number][] = [[12,51],[10,60],[8,70],[7,75],[6,80],[4,85],[2,95],[0,103]];
const SHIPPING_LANE_2: [number,number][] = [[-2,42],[0,50],[4,60],[8,68],[12,72],[15,74]];
const SHIPPING_LANE_3: [number,number][] = [[25,56],[22,62],[18,68],[15,73],[12,77],[10,80]];

// ═══════════════════════════════════════════════════════════
// ATMOSPHERE SHADER
// ═══════════════════════════════════════════════════════════
const ATMO_VERTEX = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ATMO_FRAGMENT = `
  varying vec3 vNormal;
  void main() {
    float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0);
    gl_FragColor = vec4(0.02, 0.71, 0.83, 1.0) * intensity * 0.6;
  }
`;

// ═══════════════════════════════════════════════════════════
// ASSET GENERATION
// ═══════════════════════════════════════════════════════════
function generateAssets(zones: ZoneData[]): NavalAsset[] {
  const assets: NavalAsset[] = [
    { id:"INS-VKT", name:"INS Vikrant", type:"carrier", lat:15.4, lng:73.8, heading:180, speed:18, status:"active", threat:"friendly", details:"Vikrant-class Aircraft Carrier — CBG Alpha\n40,000t / Deck: MiG-29K, KA-31" },
    { id:"INS-ARH", name:"INS Arihant", type:"submarine", lat:10, lng:72, heading:90, speed:12, status:"patrol", threat:"friendly", details:"Arihant-class SSBN — Strategic Deterrence Patrol\n6,000t / K-15 SLBM / Nuclear Powered" },
    { id:"INS-KOL", name:"INS Kolkata", type:"destroyer", lat:18.9, lng:72.8, heading:270, speed:22, status:"active", threat:"friendly", details:"Kolkata-class DDG — Western Fleet\n7,500t / BrahMos AShM / Barak-8 SAM" },
    { id:"INS-SHV", name:"INS Shivalik", type:"destroyer", lat:17, lng:83, heading:150, speed:16, status:"patrol", threat:"friendly", details:"Shivalik-class Frigate — Eastern Fleet\n6,200t / BrahMos / 76mm OTO" },
    { id:"P8I-01", name:"Neptune-1", type:"aircraft", lat:12, lng:75, heading:45, speed:490, status:"active", threat:"friendly", details:"P-8I Neptune — Maritime Patrol\nAPS-154 Radar / Mk 54 Torpedoes" },
    { id:"INS-BZ", name:"INS Baaz", type:"base", lat:6.8, lng:93.9, heading:0, speed:0, status:"active", threat:"friendly", details:"Naval Air Station Baaz — Andaman & Nicobar\nForward Operating Base" },
    { id:"KRW-B", name:"Karwar NB", type:"base", lat:14.8, lng:74.1, heading:0, speed:0, status:"active", threat:"friendly", details:"Project Seabird — Western Naval Command\nLargest naval base in Indian Ocean" },
    { id:"VSK-B", name:"Vizag NB", type:"base", lat:17.7, lng:83.3, heading:0, speed:0, status:"active", threat:"friendly", details:"Eastern Naval Command HQ\nSubmarine arm / Ship Building Centre" },
    { id:"INS-VKM", name:"INS Vikramaditya", type:"carrier", lat:8.5, lng:76, heading:120, speed:15, status:"patrol", threat:"friendly", details:"Modified Kiev-class Carrier\n45,400t / MiG-29K Air Wing" },
    { id:"INS-CKR", name:"INS Chakra II", type:"submarine", lat:5, lng:80, heading:200, speed:18, status:"patrol", threat:"friendly", details:"Akula-II class SSN — Hunter-Killer\n12,000t / Klub-S Missiles" },
    { id:"DRN-01", name:"Drishti-10", type:"patrol", lat:20, lng:65, heading:90, speed:180, status:"active", threat:"friendly", details:"Heron TP UAV — Surveillance Drone\nEO/IR + Maritime Radar" },
  ];
  zones.forEach((z, i) => {
    if (z.threat.level > 35) {
      const t = Date.now() / 30000 + i;
      assets.push({
        id: `TRK-${String.fromCharCode(65 + i)}`, name: `Contact ${String.fromCharCode(65 + i)}`,
        type: z.threat.level > 65 ? "submarine" : "patrol",
        lat: z.lat + Math.sin(t) * 2.5, lng: z.lon + Math.cos(t) * 2.5,
        heading: Math.round((Date.now() / 1000 + i * 37) % 360), speed: z.threat.level > 65 ? 8 : 14,
        status: z.threat.level > 65 ? "alert" : "patrol", threat: z.threat.level > 65 ? "hostile" : "neutral",
        details: z.threat.level > 65 ? `Unidentified subsurface contact — ${z.name}\nSonar classification pending` : `Merchant/fishing traffic — ${z.name}`,
      });
    }
  });
  return assets;
}

// ═══════════════════════════════════════════════════════════
// THREE.JS SCENE BUILDER
// ═══════════════════════════════════════════════════════════
function buildScene(container: HTMLDivElement) {
  const W = container.clientWidth;
  const H = container.clientHeight;

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x020810, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  // Camera — positioned to look at Indian Ocean
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
  camera.position.set(0, 1.5, 7.5);
  camera.lookAt(0, 0, 0);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
  sunLight.position.set(5, 3, 5);
  scene.add(sunLight);
  const fillLight = new THREE.DirectionalLight(0x88ccff, 0.3);
  fillLight.position.set(-5, -1, -5);
  scene.add(fillLight);
  scene.add(new THREE.HemisphereLight(0xaaddff, 0x112244, 0.3));

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const starCount = 4000;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 50 + Math.random() * 80;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPos[i * 3 + 2] = r * Math.cos(phi);
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.8, sizeAttenuation: true }));
  scene.add(stars);

  // Globe group
  const globeGroup = new THREE.Group();
  globeGroup.rotation.z = -23.5 * Math.PI / 180; // Axial tilt
  scene.add(globeGroup);

  // ─── REAL EARTH GLOBE WITH NASA TEXTURES ───
  const loader = new THREE.TextureLoader();
  const loadedTextures: THREE.Texture[] = [];

  const globeGeo = new THREE.SphereGeometry(GLOBE_R, 96, 64);
  const globeMat = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    shininess: 25,
    specular: new THREE.Color(0x333333),
  });
  const globe = new THREE.Mesh(globeGeo, globeMat);
  globeGroup.add(globe);

  // Load real-world textures
  loader.load(EARTH_TEXTURE_URL, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    globeMat.map = tex;
    globeMat.needsUpdate = true;
    loadedTextures.push(tex);
  });
  loader.load(EARTH_TOPO_URL, (tex) => {
    globeMat.bumpMap = tex;
    globeMat.bumpScale = 0.04;
    globeMat.needsUpdate = true;
    loadedTextures.push(tex);
  });
  loader.load(EARTH_NIGHT_URL, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    globeMat.emissiveMap = tex;
    globeMat.emissive = new THREE.Color(0xffcc88);
    globeMat.emissiveIntensity = 0.05;
    globeMat.needsUpdate = true;
    loadedTextures.push(tex);
  });
  loader.load(EARTH_WATER_URL, (tex) => {
    globeMat.specularMap = tex;
    globeMat.needsUpdate = true;
    loadedTextures.push(tex);
  });

  // Cloud layer
  const cloudGeo = new THREE.SphereGeometry(GLOBE_R * 1.008, 64, 48);
  const cloudMat = new THREE.MeshPhongMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false });
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  globeGroup.add(clouds);

  // Atmosphere glow (custom shader)
  const atmoGeo = new THREE.SphereGeometry(GLOBE_R * 1.12, 64, 64);
  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: ATMO_VERTEX, fragmentShader: ATMO_FRAGMENT,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  scene.add(new THREE.Mesh(atmoGeo, atmoMat));

  // Inner edge glow
  const innerAtmoGeo = new THREE.SphereGeometry(GLOBE_R * 1.02, 64, 64);
  globeGroup.add(new THREE.Mesh(innerAtmoGeo, new THREE.MeshBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.03, side: THREE.BackSide })));

  // ─── TACTICAL OVERLAYS ───
  function addLine(coords: [number,number][], color: number, opacity: number, dashed = false) {
    const pts = coords.map(([lat, lng]) => geoTo3D(lat, lng, GLOBE_R * 1.003));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    if (dashed) {
      const mat = new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.05, gapSize: 0.03 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      globeGroup.add(line);
    } else {
      globeGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
    }
  }

  addLine(INDIA_COAST, 0x06b6d4, 0.45);
  addLine(SRI_LANKA, 0x06b6d4, 0.3);
  addLine(EEZ_INDIA, 0x06b6d4, 0.12, true);
  addLine(SHIPPING_LANE_1, 0xeab308, 0.1, true);
  addLine(SHIPPING_LANE_2, 0xeab308, 0.08, true);
  addLine(SHIPPING_LANE_3, 0xeab308, 0.08, true);

  // Subtle lat/lng grid
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts: THREE.Vector3[] = [];
    for (let lng = 0; lng <= 360; lng += 3) pts.push(geoTo3D(lat, lng, GLOBE_R * 1.002));
    globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.03 })));
  }
  for (let lng = 0; lng < 360; lng += 30) {
    const pts: THREE.Vector3[] = [];
    for (let lat = -90; lat <= 90; lat += 3) pts.push(geoTo3D(lat, lng, GLOBE_R * 1.002));
    globeGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.03 })));
  }

  // Radar sweep
  const sweepPts: THREE.Vector3[] = [];
  sweepPts.push(geoTo3D(12, 78, GLOBE_R * 1.004));
  for (let a = 0; a <= 8; a++) {
    const angle = a * 0.1;
    sweepPts.push(geoTo3D(12 + Math.cos(angle) * 15, 78 + Math.sin(angle) * 15, GLOBE_R * 1.004));
  }
  const sweepLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(sweepPts),
    new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.1 }),
  );
  globeGroup.add(sweepLine);

  return { renderer, scene, camera, globeGroup, clouds, stars, sweepLine, loadedTextures, globe };
}

// ═══════════════════════════════════════════════════════════
// THREAT ZONE MARKERS
// ═══════════════════════════════════════════════════════════
function addThreatZones(globeGroup: THREE.Group, zones: ZoneData[]): THREE.Group[] {
  const groups: THREE.Group[] = [];
  zones.forEach(z => {
    const group = new THREE.Group();
    const pos = geoTo3D(z.lat, z.lon, GLOBE_R * 1.005);
    group.position.copy(pos);

    const color = z.threat.level >= 75 ? 0xef4444 : z.threat.level >= 50 ? 0xf97316 : z.threat.level >= 25 ? 0xeab308 : 0x10b981;
    const sc = 0.12 + z.threat.level * 0.002;

    // Core
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(sc * 0.25, 16, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }),
    ));

    // Orient rings outward
    const normal = pos.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    // Rings
    [
      { inner: sc * 0.6, outer: sc * 0.75, op: 0.25 },
      { inner: sc * 1.0, outer: sc * 1.1, op: 0.1 },
      { inner: sc * 1.4, outer: sc * 1.5, op: 0.04 },
    ].forEach(r => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r.inner, r.outer, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: r.op, side: THREE.DoubleSide }),
      );
      ring.quaternion.copy(q);
      group.add(ring);
    });

    // Vertical beam
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.003, sc * 1.8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15 }),
    );
    beam.quaternion.copy(q);
    beam.rotateX(Math.PI / 2);
    group.add(beam);

    (group as any)._threatLevel = z.threat.level;
    globeGroup.add(group);
    groups.push(group);
  });
  return groups;
}

// ═══════════════════════════════════════════════════════════
// ASSET MARKERS
// ═══════════════════════════════════════════════════════════
function addAssetMarkers(globeGroup: THREE.Group, assets: NavalAsset[]): THREE.Group[] {
  const groups: THREE.Group[] = [];
  assets.forEach(a => {
    const group = new THREE.Group();
    const pos = geoTo3D(a.lat, a.lng, GLOBE_R * 1.015);
    group.position.copy(pos);

    const color = a.threat === "hostile" ? 0xef4444 : a.threat === "friendly" ? 0x06b6d4 : 0xeab308;

    let geo: THREE.BufferGeometry;
    let sz: number;
    switch (a.type) {
      case "carrier": geo = new THREE.OctahedronGeometry(0.06, 0); sz = 0.06; break;
      case "submarine": geo = new THREE.CapsuleGeometry(0.015, 0.04, 4, 8); sz = 0.04; break;
      case "base": geo = new THREE.BoxGeometry(0.05, 0.02, 0.05); sz = 0.05; break;
      case "aircraft": geo = new THREE.ConeGeometry(0.02, 0.06, 3); sz = 0.04; break;
      default: geo = new THREE.OctahedronGeometry(0.035, 0); sz = 0.035;
    }

    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })));

    // Glow ring
    const normal = pos.clone().normalize();
    const rq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(sz * 0.8, sz * 1.2, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide }),
    );
    ring.quaternion.copy(rq);
    ring.position.copy(pos.clone().normalize().multiplyScalar(-0.02));
    group.add(ring);

    // Trail for movers
    if (a.speed > 0 && a.type !== "base") {
      const trail: THREE.Vector3[] = [];
      const hRad = a.heading * Math.PI / 180;
      for (let i = 0; i < 8; i++) {
        const d = i * 0.4;
        trail.push(geoTo3D(a.lat - Math.cos(hRad) * d, a.lng - Math.sin(hRad) * d, GLOBE_R * 1.004));
      }
      globeGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(trail),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.06 }),
      ));
    }

    (group as any)._assetId = a.id;
    globeGroup.add(group);
    groups.push(group);
  });
  return groups;
}

// Connection arcs between nearby friendlies
function addConnectionLines(globeGroup: THREE.Group, assets: NavalAsset[]) {
  const fr = assets.filter(a => a.threat === "friendly" && a.type !== "base");
  for (let i = 0; i < fr.length; i++) {
    for (let j = i + 1; j < fr.length; j++) {
      const dist = Math.sqrt((fr[i].lat - fr[j].lat) ** 2 + (fr[i].lng - fr[j].lng) ** 2);
      if (dist < 15) {
        const pts: THREE.Vector3[] = [];
        for (let s = 0; s <= 20; s++) {
          const t = s / 20;
          const lat = fr[i].lat + (fr[j].lat - fr[i].lat) * t;
          const lng = fr[i].lng + (fr[j].lng - fr[i].lng) * t;
          pts.push(geoTo3D(lat, lng, GLOBE_R * 1.005 + Math.sin(t * Math.PI) * 0.08));
        }
        globeGroup.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.06 }),
        ));
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
// ORBIT CONTROLS
// ═══════════════════════════════════════════════════════════
function setupOrbitControls(camera: THREE.PerspectiveCamera, el: HTMLElement) {
  let dragging = false;
  let prev = { x: 0, y: 0 };
  const sph = new THREE.Spherical().setFromVector3(camera.position);

  const md = (e: MouseEvent) => { dragging = true; prev = { x: e.clientX, y: e.clientY }; };
  const mm = (e: MouseEvent) => {
    if (!dragging) return;
    sph.theta -= (e.clientX - prev.x) * 0.005;
    sph.phi -= (e.clientY - prev.y) * 0.005;
    sph.phi = Math.max(0.15, Math.min(Math.PI - 0.15, sph.phi));
    prev = { x: e.clientX, y: e.clientY };
    camera.position.setFromSpherical(sph);
    camera.lookAt(0, 0, 0);
  };
  const mu = () => { dragging = false; };
  const wh = (e: WheelEvent) => {
    e.preventDefault();
    sph.radius += e.deltaY * 0.004;
    sph.radius = Math.max(GLOBE_R * 1.3, Math.min(GLOBE_R * 6, sph.radius));
    camera.position.setFromSpherical(sph);
    camera.lookAt(0, 0, 0);
  };

  el.addEventListener("mousedown", md);
  el.addEventListener("mousemove", mm);
  el.addEventListener("mouseup", mu);
  el.addEventListener("mouseleave", mu);
  el.addEventListener("wheel", wh, { passive: false });

  let lt = { x: 0, y: 0 };
  const ts = (e: TouchEvent) => { if (e.touches.length === 1) { dragging = true; lt = { x: e.touches[0].clientX, y: e.touches[0].clientY }; } };
  const tmv = (e: TouchEvent) => {
    if (!dragging || e.touches.length !== 1) return;
    sph.theta -= (e.touches[0].clientX - lt.x) * 0.005;
    sph.phi -= (e.touches[0].clientY - lt.y) * 0.005;
    sph.phi = Math.max(0.15, Math.min(Math.PI - 0.15, sph.phi));
    lt = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    camera.position.setFromSpherical(sph);
    camera.lookAt(0, 0, 0);
  };
  const te = () => { dragging = false; };
  el.addEventListener("touchstart", ts);
  el.addEventListener("touchmove", tmv);
  el.addEventListener("touchend", te);

  // Pinch zoom
  let pinchDist = 0;
  const pz = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinchDist > 0) {
        sph.radius += (pinchDist - d) * 0.02;
        sph.radius = Math.max(GLOBE_R * 1.3, Math.min(GLOBE_R * 6, sph.radius));
        camera.position.setFromSpherical(sph);
        camera.lookAt(0, 0, 0);
      }
      pinchDist = d;
    }
  };
  const pe = () => { pinchDist = 0; };
  el.addEventListener("touchmove", pz);
  el.addEventListener("touchend", pe);

  return {
    isDragging: () => dragging,
    sph,
    dispose: () => {
      el.removeEventListener("mousedown", md); el.removeEventListener("mousemove", mm);
      el.removeEventListener("mouseup", mu); el.removeEventListener("mouseleave", mu);
      el.removeEventListener("wheel", wh);
      el.removeEventListener("touchstart", ts); el.removeEventListener("touchmove", tmv);
      el.removeEventListener("touchend", te); el.removeEventListener("touchmove", pz);
      el.removeEventListener("touchend", pe);
    },
  };
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export function GlobeWarRoom() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof buildScene> | null>(null);
  const ctrlRef = useRef<ReturnType<typeof setupOrbitControls> | null>(null);
  const threatGrps = useRef<THREE.Group[]>([]);
  const assetGrps = useRef<THREE.Group[]>([]);
  const animId = useRef<number>(0);

  const [intel, setIntel] = useState<IntelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<NavalAsset | null>(null);
  const [showThreat, setShowThreat] = useState(true);
  const [texLoaded, setTexLoaded] = useState(false);

  const fetchIntel = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/intelligence");
      if (!res.ok) throw new Error("Intelligence API failed");
      setIntel(await res.json());
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchIntel(); }, [fetchIntel]);
  useEffect(() => { const iv = setInterval(fetchIntel, 60000); return () => clearInterval(iv); }, [fetchIntel]);

  const assets = useMemo(() => intel ? generateAssets(intel.zones) : [], [intel]);
  const friendlies = useMemo(() => assets.filter(a => a.threat === "friendly"), [assets]);
  const hostiles = useMemo(() => assets.filter(a => a.threat === "hostile"), [assets]);
  const neutrals = useMemo(() => assets.filter(a => a.threat === "neutral"), [assets]);

  // ── Three.js lifecycle ──
  useEffect(() => {
    if (!containerRef.current || !intel) return;
    while (containerRef.current.firstChild) containerRef.current.removeChild(containerRef.current.firstChild);

    const s = buildScene(containerRef.current);
    sceneRef.current = s;

    // Texture detection
    const texCheck = setInterval(() => {
      if ((s.globe.material as THREE.MeshPhongMaterial).map) { setTexLoaded(true); clearInterval(texCheck); }
    }, 200);
    setTimeout(() => clearInterval(texCheck), 15000);

    threatGrps.current = addThreatZones(s.globeGroup, intel.zones);
    assetGrps.current = addAssetMarkers(s.globeGroup, assets);
    addConnectionLines(s.globeGroup, assets);
    ctrlRef.current = setupOrbitControls(s.camera, s.renderer.domElement);

    const clock = new THREE.Clock();
    const animate = () => {
      animId.current = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Auto-rotate
      if (ctrlRef.current && !ctrlRef.current.isDragging()) {
        ctrlRef.current.sph.theta += 0.0008;
        s.camera.position.setFromSpherical(ctrlRef.current.sph);
        s.camera.lookAt(0, 0, 0);
      }

      s.clouds.rotation.y = t * 0.008;
      (s.stars.material as THREE.PointsMaterial).opacity = 0.6 + Math.sin(t * 0.3) * 0.2;

      threatGrps.current.forEach((g, i) => {
        g.scale.setScalar(1 + Math.sin(t * 2 + ((g as any)._threatLevel || 30) * 0.05 + i) * 0.12);
        g.visible = showThreat;
      });

      assetGrps.current.forEach((g, i) => {
        if (g.children[0]) g.children[0].rotation.y = t * 0.6 + i;
        const bob = Math.sin(t * 1.5 + i * 0.7) * 0.005;
        g.position.normalize().multiplyScalar(GLOBE_R * 1.015 + bob);
      });

      s.sweepLine.rotation.y = t * 0.15;
      s.renderer.render(s.scene, s.camera);
    };
    animate();

    const onResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth, h = containerRef.current.clientHeight;
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
      s.renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId.current);
      clearInterval(texCheck);
      window.removeEventListener("resize", onResize);
      ctrlRef.current?.dispose();
      s.loadedTextures.forEach(tx => tx.dispose());
      s.renderer.dispose();
      if (containerRef.current && s.renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(s.renderer.domElement);
      }
    };
  }, [intel, assets]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { threatGrps.current.forEach(g => { g.visible = showThreat; }); }, [showThreat]);

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  if (loading && !intel) return (
    <div className="min-h-screen bg-slate-950 pt-[128px] flex items-center justify-center">
      <div className="text-center">
        <Radar className="w-14 h-14 text-cyan-400 mx-auto mb-4 animate-spin" />
        <p className="text-cyan-400 font-orbitron animate-pulse tracking-wider">CONNECTING TO INTELLIGENCE NETWORK...</p>
        <p className="text-[10px] font-space-mono text-cyan-400/40 mt-2">Loading real-world satellite imagery & 6 naval zone feeds</p>
        <div className="mt-4 w-48 mx-auto h-0.5 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-cyan-500/50 rounded-full animate-pulse" style={{ width: "60%" }} />
        </div>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-slate-950 pt-[128px] flex items-center justify-center">
      <div className="text-center">
        <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-400 font-orbitron">INTELLIGENCE LINK FAILED</p>
        <p className="text-xs font-space-mono text-slate-500 mt-2">{error}</p>
        <button onClick={fetchIntel} className="mt-4 px-4 py-2 border border-cyan-500/30 text-cyan-400 rounded-lg font-orbitron text-xs hover:bg-cyan-500/10 transition-all">RETRY</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 pt-[128px] pb-20 px-3">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="text-center mb-3">
          <div className="flex items-center justify-center gap-3 mb-1">
            <div className="h-px w-16 bg-gradient-to-r from-transparent to-cyan-500/30" />
            <h1 className="text-xl md:text-2xl font-orbitron font-black text-cyan-400 tracking-[0.2em]">
              3D WAR ROOM — REAL-TIME
            </h1>
            <div className="h-px w-16 bg-gradient-to-l from-transparent to-cyan-500/30" />
          </div>
          <p className="text-[9px] font-space-mono text-cyan-400/30 tracking-[0.3em]">
            JOINT OPERATIONS CENTER // INDIAN OCEAN REGION // NASA SATELLITE IMAGERY // LIVE INTELLIGENCE
          </p>
          <p className="text-[8px] font-space-mono text-emerald-400/40 mt-0.5">
            LAST UPDATE: {intel?.timestamp ? new Date(intel.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"} IST
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* 3D GLOBE */}
          <div className="lg:col-span-9">
            <div className="relative bg-gradient-to-b from-slate-900/40 to-slate-950/60 border border-cyan-500/15 rounded-xl overflow-hidden shadow-2xl shadow-cyan-500/5"
                 style={{ height: "clamp(450px, 70vh, 700px)" }}>
              <div ref={containerRef} className="w-full h-full" />

              {/* Loading overlay */}
              {!texLoaded && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                  <div className="bg-slate-900/90 border border-cyan-500/20 rounded-lg px-4 py-2 text-center">
                    <Globe2 className="w-6 h-6 text-cyan-400 mx-auto mb-1 animate-pulse" />
                    <p className="text-[8px] font-space-mono text-cyan-400/60">LOADING NASA BLUE MARBLE...</p>
                  </div>
                </div>
              )}

              {/* Controls */}
              <div className="absolute top-3 left-3 space-y-1.5 z-10">
                <button onClick={() => setShowThreat(p => !p)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[7px] font-orbitron transition-all backdrop-blur-sm ${showThreat ? "bg-amber-500/15 text-amber-400 border border-amber-500/25" : "bg-slate-800/60 text-slate-500 border border-slate-700/20"}`}>
                  {showThreat ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} THREAT ZONES
                </button>
                <button onClick={fetchIntel}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[7px] font-orbitron bg-slate-800/60 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/10 transition-all backdrop-blur-sm">
                  <RefreshCw className="w-3 h-3" /> REFRESH
                </button>
              </div>

              {/* Force posture */}
              <div className="absolute top-3 right-3 bg-slate-950/80 backdrop-blur-sm border border-cyan-500/15 rounded-lg p-2.5 z-10 min-w-[130px]">
                <div className="text-[7px] font-orbitron text-cyan-400/50 mb-2 tracking-widest">FORCE POSTURE</div>
                <div className="space-y-1.5 text-[9px] font-space-mono">
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400" /><span className="text-slate-400">FRIENDLY</span><span className="text-cyan-400 ml-auto font-orbitron">{friendlies.length}</span></div>
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-red-400" /><span className="text-slate-400">HOSTILE</span><span className="text-red-400 ml-auto font-orbitron">{hostiles.length}</span></div>
                  <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-400" /><span className="text-slate-400">NEUTRAL</span><span className="text-amber-400 ml-auto font-orbitron">{neutrals.length}</span></div>
                  <div className="border-t border-slate-700/20 pt-1.5 mt-1">
                    <div className="flex items-center gap-2">
                      <Activity className="w-3 h-3 text-slate-500" /><span className="text-slate-400">THREAT</span>
                      <span className={`ml-auto font-orbitron ${(intel?.summary.avgThreat || 0) >= 50 ? "text-red-400" : "text-emerald-400"}`}>{intel?.summary.avgThreat}%</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="absolute bottom-3 left-3 bg-slate-950/70 backdrop-blur-sm border border-cyan-500/10 rounded-lg p-2 z-10">
                <div className="text-[6px] font-space-mono text-slate-600 mb-1">DRAG ↔ ROTATE / SCROLL ↕ ZOOM</div>
                <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-[6px] font-space-mono">
                  <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> Friendly</div>
                  <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-red-400" /> Hostile</div>
                  <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Neutral</div>
                  <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 border border-amber-400/40" /> Shipping</div>
                  <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 border border-cyan-400/40 border-dashed" /> EEZ</div>
                  <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400/60" /> Safe Zone</div>
                </div>
              </div>

              <div className="absolute bottom-3 right-3 z-10">
                <div className="text-[6px] font-space-mono text-cyan-400/20">NASA BLUE MARBLE / REAL GEOGRAPHY</div>
              </div>

              {/* HUD corners */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-0 left-0 w-6 h-6 border-l-2 border-t-2 border-cyan-500/15" />
                <div className="absolute top-0 right-0 w-6 h-6 border-r-2 border-t-2 border-cyan-500/15" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-l-2 border-b-2 border-cyan-500/15" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-r-2 border-b-2 border-cyan-500/15" />
              </div>
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div className="lg:col-span-3 space-y-3">
            {/* Summary */}
            <div className="bg-slate-900/60 border border-cyan-500/15 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2.5">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] font-orbitron text-cyan-400 tracking-wider">LIVE SUMMARY</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: "ZONES", value: intel?.summary.totalZones, color: "text-cyan-400" },
                  { label: "AVG THREAT", value: `${intel?.summary.avgThreat}%`, color: (intel?.summary.avgThreat || 0) >= 50 ? "text-red-400" : "text-emerald-400" },
                  { label: "READINESS", value: `${intel?.summary.overallReadiness}%`, color: "text-emerald-400" },
                  { label: "CRITICAL", value: intel?.summary.criticalZones, color: intel?.summary.criticalZones ? "text-red-400" : "text-slate-500" },
                ].map(s => (
                  <div key={s.label} className="bg-slate-800/20 rounded-lg p-2 text-center">
                    <div className={`text-base font-orbitron ${s.color}`}>{s.value}</div>
                    <div className="text-[6px] font-space-mono text-slate-600 mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Honeypot Feed */}
            <WarRoomHoneypotFeed />

            {/* Fleet */}
            <div className="bg-slate-900/60 border border-cyan-500/15 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2.5">
                <Radar className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] font-orbitron text-cyan-400 tracking-wider">FLEET TRACKER</span>
                <span className="ml-auto text-[7px] font-space-mono text-slate-600">{assets.length} tracks</span>
              </div>
              <div className="space-y-1 max-h-52 overflow-y-auto war-scroll">
                {assets.map(a => {
                  const clr = a.threat === "hostile" ? "text-red-400" : a.threat === "friendly" ? "text-cyan-400" : "text-amber-400";
                  const bg = a.threat === "hostile" ? "bg-red-500/5" : a.threat === "friendly" ? "bg-cyan-500/5" : "bg-amber-500/5";
                  return (
                    <button key={a.id} onClick={() => setSelectedAsset(a)}
                      className={`w-full text-left px-2 py-1.5 rounded-lg transition-all text-[8px] font-space-mono border ${selectedAsset?.id === a.id ? `${bg} border-current ${clr}` : "hover:bg-slate-800/40 border-transparent"}`}>
                      <div className="flex items-center justify-between">
                        <span className={`font-orbitron text-[7px] ${clr}`}>{a.id}</span>
                        <span className={`text-[6px] px-1 py-0.5 rounded ${a.status === "alert" ? "bg-red-500/20 text-red-400 animate-pulse" : a.status === "patrol" ? "bg-amber-500/10 text-amber-400/60" : "bg-emerald-500/10 text-emerald-400/60"}`}>
                          {a.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-slate-400 mt-0.5 flex items-center gap-1.5">
                        <span>{a.name}</span>
                        {a.speed > 0 && <span className="text-slate-600">• {a.speed}kn</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Asset Detail */}
            {selectedAsset && (
              <div className={`bg-slate-900/60 border rounded-xl p-3 ${selectedAsset.threat === "hostile" ? "border-red-500/20" : "border-cyan-500/15"}`}>
                <div className="flex items-center gap-2 mb-2.5">
                  <Target className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px] font-orbitron text-cyan-400 tracking-wider">ASSET INTEL</span>
                  <button onClick={() => setSelectedAsset(null)} className="ml-auto text-[7px] text-slate-600 hover:text-slate-400">✕</button>
                </div>
                <div className="space-y-1 text-[8px] font-space-mono">
                  {[
                    { l: "CALLSIGN", v: selectedAsset.name },
                    { l: "CLASS", v: selectedAsset.type.toUpperCase() },
                    { l: "POSITION", v: `${selectedAsset.lat.toFixed(2)}°N ${selectedAsset.lng.toFixed(2)}°E` },
                    { l: "COURSE", v: `${selectedAsset.heading}° / ${selectedAsset.speed} kn` },
                    { l: "STATUS", v: selectedAsset.status.toUpperCase() },
                    { l: "IFF", v: selectedAsset.threat.toUpperCase() },
                  ].map(r => (
                    <div key={r.l} className="flex justify-between items-center">
                      <span className="text-slate-600">{r.l}</span>
                      <span className={`${selectedAsset!.threat === "hostile" ? "text-red-400" : "text-slate-300"}`}>{r.v}</span>
                    </div>
                  ))}
                  <div className="mt-2 pt-2 border-t border-slate-800/30">
                    <div className="text-[7px] text-slate-500 whitespace-pre-line leading-relaxed">{selectedAsset.details}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Zone threats */}
            <div className="bg-slate-900/60 border border-cyan-500/15 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[10px] font-orbitron text-amber-400 tracking-wider">ZONE THREATS</span>
              </div>
              <div className="space-y-1.5">
                {intel?.zones.sort((a, b) => b.threat.level - a.threat.level).map(z => (
                  <div key={z.id} className="bg-slate-800/20 rounded-lg p-2">
                    <div className="flex items-center justify-between text-[8px] font-space-mono">
                      <span className="text-slate-400 truncate max-w-[55%]">{z.name}</span>
                      <span className={`text-[6px] font-orbitron px-1.5 py-0.5 rounded ${
                        z.threat.level >= 75 ? "bg-red-500/20 text-red-400" :
                        z.threat.level >= 50 ? "bg-orange-500/15 text-orange-400" :
                        z.threat.level >= 25 ? "bg-amber-500/10 text-amber-400" :
                        "bg-emerald-500/10 text-emerald-400"
                      }`}>{z.threat.category} ({z.threat.level}%)</span>
                    </div>
                    <div className="mt-1 h-0.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${
                        z.threat.level >= 75 ? "bg-red-500" : z.threat.level >= 50 ? "bg-orange-500" :
                        z.threat.level >= 25 ? "bg-amber-500" : "bg-emerald-500"
                      }`} style={{ width: `${z.threat.level}%` }} />
                    </div>
                    {z.threat.factors[0] && (
                      <div className="mt-1 text-[6px] font-space-mono text-slate-600">▸ {z.threat.factors[0].name}: {z.threat.factors[0].detail}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Sea state */}
            <div className="bg-slate-900/60 border border-cyan-500/15 rounded-xl p-3">
              <div className="flex items-center gap-2 mb-2.5">
                <Wind className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] font-orbitron text-cyan-400 tracking-wider">SEA STATE</span>
              </div>
              <div className="space-y-1 text-[8px] font-space-mono">
                {intel?.zones.slice(0, 4).map(z => (
                  <div key={z.id} className="flex items-center justify-between">
                    <span className="text-slate-500 truncate max-w-[40%]">{z.name.split(" ").slice(0, 2).join(" ")}</span>
                    <div className="flex items-center gap-2 text-slate-400">
                      <span><Waves className="w-2.5 h-2.5 inline" /> {z.marine?.wave_height || "—"}m</span>
                      <span><Wind className="w-2.5 h-2.5 inline" /> {z.weather?.wind_speed || "—"}km/h</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Brief */}
            {intel?.brief && (
              <div className="bg-slate-900/60 border border-cyan-500/15 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Globe2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px] font-orbitron text-cyan-400 tracking-wider">INTEL BRIEF</span>
                </div>
                <p className="text-[8px] font-space-mono text-slate-500 leading-relaxed">{intel.brief}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .war-scroll::-webkit-scrollbar { width: 2px; }
        .war-scroll::-webkit-scrollbar-track { background: transparent; }
        .war-scroll::-webkit-scrollbar-thumb { background: rgba(6, 182, 212, 0.15); border-radius: 2px; }
      `}</style>
    </div>
  );
}
