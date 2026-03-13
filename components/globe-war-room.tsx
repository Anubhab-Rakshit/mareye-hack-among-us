"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Globe2, Radar, Shield, Target, AlertTriangle,
  Crosshair, Anchor, RefreshCw, Activity, Eye, EyeOff,
  Navigation as NavIcon, Waves, Wind, Skull, Zap, ShieldOff, Ban, Loader2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import dynamic from "next/dynamic";
import { WarRoomHoneypotFeed } from "@/components/war-room-honeypot-feed";

// Dynamically import Leaflet map to prevent SSR window issues
const AdvancedLeafletMap = dynamic(
  () => import("@/components/advanced-leaflet-map"),
  { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center bg-slate-900 border border-cyan-500/30 rounded-2xl"><RefreshCw className="w-8 h-8 text-cyan-500 animate-spin" /></div> }
);

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

export function GlobeWarRoom() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intel, setIntel] = useState<IntelResponse | null>(null);
  const [assets, setAssets] = useState<NavalAsset[]>([]);
  
  const [selectedAsset, setSelectedAsset] = useState<NavalAsset | null>(null);

  const fetchIntel = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const res = await fetch("/api/intel/global");
      if (!res.ok) throw new Error("Intelligence link failed");
      const data = await res.json();
      setIntel(data);
      setAssets(generateAssets(data.zones));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network failure");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntel();
    const int = setInterval(fetchIntel, 30000); 
    return () => clearInterval(int);
  }, [fetchIntel]);

  if (loading && !intel) return (
    <div className="min-h-screen bg-slate-950 pt-[128px] flex items-center justify-center">
      <div className="text-center">
        <Radar className="w-14 h-14 text-cyan-400 mx-auto mb-4 animate-spin" />
        <p className="text-cyan-400 font-orbitron animate-pulse tracking-wider">CONNECTING TO INTELLIGENCE NETWORK...</p>
        <p className="text-[10px] font-space-mono text-cyan-400/40 mt-2">Loading interactive intelligence map & 6 naval zones...</p>
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
              COMMAND CENTER — REAL-TIME
            </h1>
            <div className="h-px w-16 bg-gradient-to-l from-transparent to-cyan-500/30" />
          </div>
          <div className="flex items-center justify-center gap-4 text-[10px] font-space-mono text-cyan-500">
            <span className="flex items-center gap-1.5"><Activity className="w-3 h-3 text-emerald-400 animate-pulse" /> SAT-LINK NOMINAL</span>
            <span className="flex items-center gap-1.5"><Shield className="w-3 h-3 text-cyan-400" /> SECURE CHANNEL</span>
          </div>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          {[
            { l: "ZONES MONITORED", v: intel?.summary.totalZones || 0, c: "text-cyan-400" },
            { l: "CRITICAL THREATS", v: intel?.summary.criticalZones || 0, c: "text-red-400" },
            { l: "HIGH THREATS", v: intel?.summary.highZones || 0, c: "text-orange-400" },
            { l: "FLEET READINESS", v: `${intel?.summary.overallReadiness || 0}%`, c: "text-emerald-400" }
          ].map(s => (
            <div key={s.l} className="bg-slate-900/60 border border-cyan-500/20 rounded-lg p-2 text-center backdrop-blur-sm shadow-[0_4px_20px_-5px_rgba(6,182,212,0.1)]">
              <div className="text-[9px] text-slate-500 font-orbitron tracking-widest mb-0.5">{s.l}</div>
              <div className={`text-lg font-space-mono font-bold ${s.c}`}>{s.v}</div>
            </div>
          ))}
        </div>

        {/* Main Interface Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[75vh]">
          {/* LEFT PANEL */}
          <div className="lg:col-span-1 space-y-4 h-full flex flex-col">
            {/* Intel Feed */}
            <div className="bg-slate-900/40 border border-cyan-500/20 rounded-xl p-3 flex-[2] flex flex-col overflow-hidden relative">
              <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-cyan-500/30 rounded-tr-xl" />
              <div className="flex items-center justify-between mb-3 border-b border-cyan-500/10 pb-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px] font-orbitron text-cyan-400 tracking-wider">LIVE INTEL FEED</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 war-scroll space-y-2">
                {intel?.zones.map((z) => (
                  <div key={z.id} className="relative bg-slate-950/50 hover:bg-slate-800/50 border border-cyan-500/10 rounded-lg p-2.5 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="text-[9px] text-cyan-300 font-orbitron font-bold group-hover:text-cyan-200">{z.name}</span>
                      <span className={`text-[8px] font-space-mono px-1.5 py-0.5 rounded ${
                        z.threat.level > 60 ? "bg-red-500/20 text-red-400" :
                        z.threat.level > 30 ? "bg-amber-500/20 text-amber-400" :
                        "bg-emerald-500/10 text-emerald-400"
                      }`}>LVL {z.threat.level}</span>
                    </div>
                    <div className="text-[8px] text-slate-500 font-space-mono line-clamp-2 leading-relaxed">{z.command} • {z.threat.category}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Honeypot Feed Widget */}
            <div className="flex-[1] min-h-[160px]">
              <WarRoomHoneypotFeed />
            </div>
          </div>

          {/* MIDDLE: 2D LEAFLET MAP CONTAINER */}
          <div className="lg:col-span-2 relative h-full rounded-2xl border border-cyan-500/20 shadow-[0_0_40px_rgba(6,182,212,0.1)] bg-slate-950/80">
            {/* Map Header overlays */}
            <div className="absolute top-4 left-4 z-20 pointer-events-none">
              <div className="text-cyan-500 font-space-mono text-[10px] mb-1 flex items-center shadow-md bg-slate-900/60 p-1 px-2 rounded backdrop-blur">
                <Globe2 className="w-3 h-3 inline mr-2 text-cyan-400" /> GLOBAL DEFENSE NETWORK
              </div>
            </div>
            <div className="absolute top-4 right-4 z-20 pointer-events-none flex gap-2">
              <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 backdrop-blur-md shadow-md">
                TACTICAL MAP
              </Badge>
              <Badge className="bg-blue-500/20 text-blue-300 border border-blue-500/50 backdrop-blur-md shadow-md">
                AI TRACKING
              </Badge>
            </div>
            
            <AdvancedLeafletMap />
            
          </div>

          {/* RIGHT PANEL */}
          <div className="lg:col-span-1 space-y-4 h-full flex flex-col">
            {/* Active Assets */}
            <div className="bg-slate-900/40 border border-cyan-500/20 rounded-xl p-3 flex-1 overflow-hidden relative shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]">
               <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-cyan-500/30 rounded-tr-xl" />
              <div className="flex items-center gap-2 mb-3 border-b border-cyan-500/10 pb-2">
                <Anchor className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] font-orbitron text-cyan-400 tracking-wider">NAVAL ASSETS</span>
              </div>
              <div className="space-y-1.5 overflow-y-auto h-[calc(100%-40px)] pr-1 war-scroll">
                {assets.map(a => {
                  const isS = selectedAsset?.id === a.id;
                  return (
                    <button key={a.id} onClick={() => {
                        setSelectedAsset(isS ? null : a);
                    }} className={`w-full text-left bg-slate-950/50 hover:bg-slate-800 border p-2 rounded-lg transition-all ${
                      isS ? "border-cyan-400 bg-cyan-950/30" : "border-slate-800"
                    }`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[9px] font-orbitron font-bold ${a.threat === "hostile" ? "text-red-400" : "text-cyan-300"}`}>{a.id}</span>
                        <span className="text-[7px] text-slate-500">{a.type.toUpperCase()}</span>
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
                      <span className={`${selectedAsset.threat === "hostile" ? "text-red-400" : "text-slate-300"}`}>{r.v}</span>
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
