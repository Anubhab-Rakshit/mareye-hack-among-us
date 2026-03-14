"use client";

import React, { useRef, useEffect, useState, useMemo } from "react";
import Globe, { GlobeMethods } from "react-globe.gl";
import { Radar, Anchor, Shield, Target } from "lucide-react";

interface NavalAsset {
  id: string;
  name: string;
  type: "carrier" | "submarine" | "destroyer" | "patrol" | "aircraft" | "base" | string;
  lat: number;
  lng: number;
  threat: "friendly" | "hostile" | "neutral";
  details: string;
  heading?: number;
  speed?: number;
  status?: string;
}

interface TacticalGlobeProps {
  assets: any[];
  zones?: any[];
  userLocation?: [number, number];
  onAssetClick?: (asset: any) => void;
  selectedAssetId?: string | null;
}

export default function TacticalGlobe({ 
  assets, 
  zones = [],
  userLocation = [21.0, 88.0],
  onAssetClick, 
  selectedAssetId 
}: TacticalGlobeProps) {
  const globeRef = useRef<GlobeMethods>();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Responsive handling
  useEffect(() => {
    if (containerRef.current) {
      const updateDimensions = () => {
        if (containerRef.current) {
          setDimensions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight
          });
        }
      };
      
      updateDimensions();
      window.addEventListener("resize", updateDimensions);
      return () => window.removeEventListener("resize", updateDimensions);
    }
  }, []);

  const gData = useMemo(() => {
    const data = assets.map(asset => ({
      ...asset,
      size: asset.id === selectedAssetId ? 0.8 : 0.4,
      color: asset.threat === "hostile" ? "#ef4444" : 
             asset.threat === "friendly" ? "#10b981" : "#f59e0b"
    }));
    
    // Add user location
    data.push({
      id: "USER_LOC",
      name: "NSC-01 (Your Location)",
      type: "base",
      lat: userLocation[0],
      lng: userLocation[1],
      threat: "friendly",
      details: "Command Center",
      size: 0.6,
      color: "#06b6d4" // Cyan
    });

    return data;
  }, [assets, selectedAssetId, userLocation]);

  // Arcs for "detected" threats (simulation) - relative to user
  const arcsData = useMemo(() => {
    const hostile = assets.filter(a => a.threat === "hostile");
    
    if (hostile.length > 0) {
      return hostile.map(h => ({
        startLat: userLocation[0],
        startLng: userLocation[1],
        endLat: h.lat,
        endLng: h.lng,
        color: ["#06b6d4", "#ef4444"]
      }));
    }
    return [];
  }, [assets, userLocation]);

  // Threat rings based on zones
  const ringsData = useMemo(() => zones.map(z => ({
    lat: z.lat,
    lng: z.lon || z.lng,
    maxR: (z.threat.level / 100) * 5 + 2,
    propagationSpeed: (z.threat.level / 100) * 2 + 0.5,
    color: z.threat.level > 60 ? "#ef4444" : z.threat.level > 30 ? "#f59e0b" : "#10b981"
  })), [zones]);

  return (
    <div ref={containerRef} className="w-full h-full relative bg-slate-950">
      <Globe
        ref={globeRef}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        
        // Points (Naval Assets)
        pointsData={gData}
        pointLat="lat"
        pointLng="lng"
        pointColor="color"
        pointRadius="size"
        pointAltitude={0.01}
        pointsMerge={true}
        onPointClick={(p: any) => onAssetClick?.(p)}

        // Arcs (Tactical Links)
        arcsData={arcsData}
        arcColor="color"
        arcDashLength={0.4}
        arcDashGap={4}
        arcDashAnimateTime={1500}
        arcStroke={0.5}

        // Rings (Threat Zones)
        ringsData={ringsData}
        ringColor="color"
        ringMaxRadius="maxR"
        ringPropagationSpeed="propagationSpeed"
        ringRepeatPeriod={1500}

        // Labels (Asset Names)
        labelsData={gData}
        labelLat="lat"
        labelLng="lng"
        labelText="name"
        labelSize={0.5}
        labelDotRadius={0.2}
        labelColor="color"
        labelResolution={2}
        
        // Atmosphere behavior
        showAtmosphere={true}
        atmosphereColor="#06b6d4"
        atmosphereAltitude={0.15}
      />

      {/* 3D UI Overlay Overlay */}
      <div className="absolute bottom-4 left-4 pointer-events-none">
        <div className="flex flex-col gap-2">
           <div className="flex items-center gap-2 bg-slate-900/80 border border-cyan-500/20 px-3 py-1.5 rounded-lg backdrop-blur-md">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-orbitron text-cyan-300 tracking-widest uppercase">3D TACTICAL RENDER ACTIVE</span>
           </div>
        </div>
      </div>

      <style jsx global>{`
        .scene-container .clickable {
          cursor: crosshair !important;
        }
      `}</style>
    </div>
  );
}
