"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  TrendingUp,
  AlertTriangle,
  Shield,
  Clock,
  Activity,
  Zap,
  Target,
  Brain,
  Radio,
  RefreshCw,
} from "lucide-react";

// ═══ Types from intelligence API ═══
interface ZoneData {
  id: string;
  name: string;
  lat: number;
  lon: number;
  command: string;
  hq: string;
  marine: {
    current: Record<string, number>;
    hourly: {
      time: string[];
      wave_height: number[];
      wave_direction: number[];
      wave_period: number[];
      swell_wave_height: number[];
    };
  };
  weather: {
    current: Record<string, number>;
    hourly: {
      time: string[];
      temperature_2m: number[];
      relative_humidity_2m: number[];
      wind_speed_10m: number[];
      wind_direction_10m: number[];
      visibility: number[];
      cloud_cover: number[];
    };
  };
  threat: {
    level: number;
    category: string;
    factors: { name: string; score: number; detail: string }[];
  };
  ops: {
    operation: string;
    ready: boolean;
    confidence: number;
    status: string;
    conditions: string;
  }[];
}

interface IntelResponse {
  timestamp: string;
  zones: ZoneData[];
  summary: {
    totalZones: number;
    criticalZones: number;
    highZones: number;
    moderateZones: number;
    lowZones: number;
    avgThreat: number;
    overallReadiness: number;
  };
  brief: string;
}

interface ThreatPrediction {
  timestamp: Date;
  hour: number;
  threatLevel: number;
  confidence: number;
  upperBound: number;
  lowerBound: number;
  category: "low" | "moderate" | "elevated" | "high" | "critical";
  factors: string[];
  waveHeight: number;
  windSpeed: number;
  visibility: number;
}

interface ThreatEvent {
  time: Date;
  type: "patrol" | "intrusion" | "weather" | "exercise" | "deployment";
  title: string;
  severity: number;
  zone: string;
}

// Derive threat level from real weather/marine data at a given hour
function deriveThreatFromHourlyData(
  waveH: number,
  swellH: number,
  windSpd: number,
  visibility: number,
  cloudCover: number,
  hourOfDay: number,
): { level: number; factors: string[] } {
  let level = 0;
  const factors: string[] = [];

  // Sea state risk (wave height > 2m is rough)
  const seaState = Math.min(30, (waveH / 4) * 30);
  level += seaState;
  if (waveH > 2.5) factors.push(`High sea state: ${waveH.toFixed(1)}m waves`);

  // Visibility risk (< 5000m is dangerous)
  const visRisk =
    visibility < 10000 ? Math.min(25, ((10000 - visibility) / 10000) * 25) : 0;
  level += visRisk;
  if (visibility < 5000)
    factors.push(`Low visibility: ${(visibility / 1000).toFixed(1)}km`);

  // Wind risk
  const windRisk = Math.min(15, (windSpd / 50) * 15);
  level += windRisk;
  if (windSpd > 20) factors.push(`Strong winds: ${windSpd.toFixed(0)} km/h`);

  // Swell risk
  const swellRisk = Math.min(10, (swellH / 3) * 10);
  level += swellRisk;
  if (swellH > 2) factors.push(`Heavy swell: ${swellH.toFixed(1)}m`);

  // Night operations risk
  if (hourOfDay < 6 || hourOfDay > 20) {
    level += 8;
    factors.push("Night operations period");
  }

  // Cloud cover affects aerial surveillance
  if (cloudCover > 80) {
    level += 5;
    factors.push("Dense cloud cover — limited aerial surveillance");
  }

  return { level: Math.min(100, Math.round(level)), factors };
}

function buildPredictions(zones: ZoneData[]): ThreatPrediction[] {
  if (!zones.length || !zones[0].weather?.hourly?.time) return [];

  const predictions: ThreatPrediction[] = [];
  const now = new Date();
  const hourlyTimes = zones[0].weather.hourly.time;

  hourlyTimes.forEach((timeStr, idx) => {
    const time = new Date(timeStr);
    const hourFromNow = (time.getTime() - now.getTime()) / 3600000;
    if (hourFromNow < -12 || hourFromNow > 74) return;

    // Average across all zones for composite threat
    let totalLevel = 0;
    let totalWave = 0;
    let totalWind = 0;
    let totalVis = 0;
    const allFactors: string[] = [];
    let validZones = 0;

    zones.forEach((z) => {
      const waveH = z.marine?.hourly?.wave_height?.[idx] ?? 0;
      const swellH = z.marine?.hourly?.swell_wave_height?.[idx] ?? 0;
      const windSpd = z.weather?.hourly?.wind_speed_10m?.[idx] ?? 0;
      const vis = z.weather?.hourly?.visibility?.[idx] ?? 50000;
      const cloud = z.weather?.hourly?.cloud_cover?.[idx] ?? 0;
      const hourOfDay = time.getHours();

      const { level, factors } = deriveThreatFromHourlyData(
        waveH,
        swellH,
        windSpd,
        vis,
        cloud,
        hourOfDay,
      );
      totalLevel += level;
      totalWave += waveH;
      totalWind += windSpd;
      totalVis += vis;
      factors.forEach((f) => {
        if (!allFactors.includes(f)) allFactors.push(f);
      });
      validZones++;
    });

    if (validZones === 0) return;
    const avgLevel = totalLevel / validZones;
    const hoursAway = Math.abs(hourFromNow);
    const confidence = Math.max(0.3, 1 - hoursAway * 0.008);
    const spread = (1 - confidence) * 20;

    predictions.push({
      timestamp: time,
      hour: Math.round(hourFromNow * 10) / 10,
      threatLevel: avgLevel,
      confidence,
      upperBound: Math.min(100, avgLevel + spread),
      lowerBound: Math.max(0, avgLevel - spread),
      category:
        avgLevel < 20
          ? "low"
          : avgLevel < 40
            ? "moderate"
            : avgLevel < 60
              ? "elevated"
              : avgLevel < 80
                ? "high"
                : "critical",
      factors: allFactors.slice(0, 3),
      waveHeight: totalWave / validZones,
      windSpeed: totalWind / validZones,
      visibility: totalVis / validZones,
    });
  });

  return predictions;
}

function buildEvents(zones: ZoneData[]): ThreatEvent[] {
  const events: ThreatEvent[] = [];
  const now = new Date();

  zones.forEach((zone) => {
    // Derive events from threat level and conditions
    if (zone.threat.level >= 65) {
      events.push({
        time: new Date(now.getTime() - Math.random() * 3600000 * 3),
        type: "intrusion",
        title: `Elevated threat detected — ${zone.name} — ${zone.threat.factors[0]?.name || "Multiple factors"}`,
        severity: zone.threat.level,
        zone: zone.name,
      });
    }

    if (zone.marine?.current?.wave_height > 2.5) {
      events.push({
        time: now,
        type: "weather",
        title: `High sea state warning — ${zone.name} — ${zone.marine.current.wave_height.toFixed(1)}m waves`,
        severity: Math.min(
          80,
          Math.round(zone.marine.current.wave_height * 20),
        ),
        zone: zone.name,
      });
    }

    if (zone.weather?.current?.wind_speed_10m > 25) {
      events.push({
        time: now,
        type: "weather",
        title: `Strong wind advisory — ${zone.name} — ${zone.weather.current.wind_speed_10m.toFixed(0)} km/h`,
        severity: Math.min(
          70,
          Math.round(zone.weather.current.wind_speed_10m * 2),
        ),
        zone: zone.name,
      });
    }

    // Ops readiness events
    zone.ops.forEach((op) => {
      if (!op.ready) {
        events.push({
          time: new Date(now.getTime() + Math.random() * 3600000 * 12),
          type: "deployment",
          title: `${op.operation} NOT READY — ${zone.name} — ${op.conditions}`,
          severity: 45,
          zone: zone.name,
        });
      }
    });

    // Patrol events based on ops
    const readyOps = zone.ops.filter((o) => o.ready);
    if (readyOps.length > 0) {
      events.push({
        time: new Date(now.getTime() + Math.random() * 3600000 * 6),
        type: "patrol",
        title: `${readyOps[0].operation} active — ${zone.name} — ${readyOps[0].conditions}`,
        severity: 15,
        zone: zone.name,
      });
    }
  });

  return events.sort((a, b) => a.time.getTime() - b.time.getTime());
}

export function AIThreatPrediction() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [intel, setIntel] = useState<IntelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<ThreatPrediction | null>(
    null,
  );
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [selectedRange, setSelectedRange] = useState<
    "12h" | "24h" | "48h" | "72h"
  >("72h");
  const animFrame = useRef(0);

  // Fetch real intelligence data
  const fetchIntel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/intelligence");
      if (!res.ok) throw new Error("Intelligence API failed");
      const data = await res.json();
      setIntel(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntel();
  }, [fetchIntel]);

  const predictions = useMemo(
    () => (intel ? buildPredictions(intel.zones) : []),
    [intel],
  );
  const events = useMemo(
    () => (intel ? buildEvents(intel.zones) : []),
    [intel],
  );

  const nowPrediction = useMemo(() => {
    if (!predictions.length) return null;
    return predictions.reduce(
      (c, p) => (Math.abs(p.hour) < Math.abs(c.hour) ? p : c),
      predictions[0],
    );
  }, [predictions]);

  const rangeHours: Record<string, [number, number]> = {
    "12h": [-6, 12],
    "24h": [-6, 24],
    "48h": [-12, 48],
    "72h": [-12, 72],
  };
  const [startH, endH] = rangeHours[selectedRange];
  const filteredPredictions = predictions.filter(
    (p) => p.hour >= startH && p.hour <= endH,
  );
  const filteredEvents = events.filter((e) => {
    const h = (e.time.getTime() - Date.now()) / 3600000;
    return h >= startH && h <= endH;
  });

  // Canvas chart
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !filteredPredictions.length) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const W = rect.width,
      H = rect.height;
    const pad = { top: 30, bottom: 40, left: 50, right: 20 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    const xScale = (h: number) =>
      pad.left + ((h - startH) / (endH - startH)) * chartW;
    const yScale = (v: number) => pad.top + chartH - (v / 100) * chartH;

    let phase = 0;
    const drawFrame = () => {
      phase += 0.02;
      ctx.clearRect(0, 0, W, H);

      // Grid
      ctx.strokeStyle = "rgba(6, 182, 212, 0.06)";
      ctx.lineWidth = 1;
      for (let v = 0; v <= 100; v += 20) {
        ctx.beginPath();
        ctx.moveTo(pad.left, yScale(v));
        ctx.lineTo(W - pad.right, yScale(v));
        ctx.stroke();
        ctx.fillStyle = "rgba(6, 182, 212, 0.3)";
        ctx.font = "9px 'Space Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText(v.toString(), pad.left - 8, yScale(v) + 3);
      }

      // Time axis
      const step =
        selectedRange === "12h"
          ? 2
          : selectedRange === "24h"
            ? 4
            : selectedRange === "48h"
              ? 8
              : 12;
      for (let h = Math.ceil(startH / step) * step; h <= endH; h += step) {
        const x = xScale(h);
        ctx.strokeStyle = "rgba(6, 182, 212, 0.04)";
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, H - pad.bottom);
        ctx.stroke();
        ctx.fillStyle = "rgba(6, 182, 212, 0.3)";
        ctx.font = "9px 'Space Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          h === 0 ? "NOW" : h > 0 ? `+${h}h` : `${h}h`,
          x,
          H - pad.bottom + 16,
        );
      }

      // NOW line
      const nowX = xScale(0);
      ctx.strokeStyle = "rgba(6, 182, 212, 0.4)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nowX, pad.top);
      ctx.lineTo(nowX, H - pad.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Confidence band
      ctx.beginPath();
      filteredPredictions.forEach((p, i) => {
        const x = xScale(p.hour),
          y = yScale(p.upperBound);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      [...filteredPredictions]
        .reverse()
        .forEach((p) => ctx.lineTo(xScale(p.hour), yScale(p.lowerBound)));
      ctx.closePath();
      const bandGrad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
      bandGrad.addColorStop(0, "rgba(239, 68, 68, 0.08)");
      bandGrad.addColorStop(0.5, "rgba(234, 179, 8, 0.05)");
      bandGrad.addColorStop(1, "rgba(6, 182, 212, 0.03)");
      ctx.fillStyle = bandGrad;
      ctx.fill();

      // Zone backgrounds
      const zones = [
        { max: 20, color: "rgba(16, 185, 129, 0.03)" },
        { max: 40, color: "rgba(234, 179, 8, 0.03)" },
        { max: 60, color: "rgba(249, 115, 22, 0.03)" },
        { max: 80, color: "rgba(239, 68, 68, 0.03)" },
        { max: 100, color: "rgba(239, 68, 68, 0.05)" },
      ];
      zones.forEach((z) => {
        ctx.fillStyle = z.color;
        ctx.fillRect(
          pad.left,
          yScale(z.max),
          chartW,
          yScale(z.max - 20) - yScale(z.max),
        );
      });

      // Zone labels
      ctx.font = "8px 'Orbitron', sans-serif";
      ctx.textAlign = "left";
      const zLabels = [
        { y: 10, text: "LOW", color: "rgba(16, 185, 129, 0.4)" },
        { y: 30, text: "MODERATE", color: "rgba(234, 179, 8, 0.4)" },
        { y: 50, text: "ELEVATED", color: "rgba(249, 115, 22, 0.4)" },
        { y: 70, text: "HIGH", color: "rgba(239, 68, 68, 0.4)" },
        { y: 90, text: "CRITICAL", color: "rgba(239, 68, 68, 0.6)" },
      ];
      zLabels.forEach((l) => {
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, W - pad.right - 55, yScale(l.y) + 3);
      });

      // Main threat line
      ctx.beginPath();
      filteredPredictions.forEach((p, i) => {
        const x = xScale(p.hour),
          y = yScale(p.threatLevel);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      const lineGrad = ctx.createLinearGradient(pad.left, 0, W - pad.right, 0);
      lineGrad.addColorStop(0, "rgba(6, 182, 212, 0.8)");
      lineGrad.addColorStop(0.3, "rgba(234, 179, 8, 0.8)");
      lineGrad.addColorStop(0.7, "rgba(239, 68, 68, 0.8)");
      lineGrad.addColorStop(1, "rgba(239, 68, 68, 0.9)");
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Glow under line
      ctx.beginPath();
      filteredPredictions.forEach((p, i) => {
        const x = xScale(p.hour),
          y = yScale(p.threatLevel);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(xScale(endH), H - pad.bottom);
      ctx.lineTo(xScale(startH), H - pad.bottom);
      ctx.closePath();
      const glowGrad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
      glowGrad.addColorStop(0, "rgba(239, 68, 68, 0.1)");
      glowGrad.addColorStop(0.5, "rgba(234, 179, 8, 0.05)");
      glowGrad.addColorStop(1, "rgba(6, 182, 212, 0.02)");
      ctx.fillStyle = glowGrad;
      ctx.fill();

      // Current dot
      const nowP = filteredPredictions.reduce(
        (c, p) => (Math.abs(p.hour) < Math.abs(c.hour) ? p : c),
        filteredPredictions[0],
      );
      const dotX = xScale(nowP.hour),
        dotY = yScale(nowP.threatLevel);
      const pulseR = 4 + Math.sin(phase * 3) * 2;
      ctx.beginPath();
      ctx.arc(dotX, dotY, pulseR + 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(6, 182, 212, ${0.1 + Math.sin(phase * 3) * 0.05})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgb(6, 182, 212)";
      ctx.fill();

      // Event markers
      filteredEvents.forEach((e) => {
        const h = (e.time.getTime() - Date.now()) / 3600000;
        const x = xScale(h);
        ctx.strokeStyle =
          e.severity > 60
            ? "rgba(239, 68, 68, 0.6)"
            : e.severity > 30
              ? "rgba(234, 179, 8, 0.5)"
              : "rgba(6, 182, 212, 0.4)";
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, H - pad.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle =
          e.severity > 60
            ? "rgba(239, 68, 68, 0.7)"
            : e.severity > 30
              ? "rgba(234, 179, 8, 0.6)"
              : "rgba(6, 182, 212, 0.5)";
        ctx.font = "7px 'Space Mono', monospace";
        ctx.textAlign = "center";
        ctx.save();
        ctx.translate(x, pad.top - 4);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(e.title.substring(0, 35), 0, 0);
        ctx.restore();
        ctx.save();
        ctx.translate(x, pad.top + 10);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle =
          e.severity > 60
            ? "rgba(239, 68, 68, 0.8)"
            : e.severity > 30
              ? "rgba(234, 179, 8, 0.6)"
              : "rgba(6, 182, 212, 0.5)";
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
      });

      // Labels
      if (nowX > pad.left && nowX < W - pad.right) {
        ctx.fillStyle = "rgba(6, 182, 212, 0.15)";
        ctx.font = "8px 'Orbitron', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("← HISTORICAL", pad.left + 4, pad.top + 12);
        ctx.textAlign = "right";
        ctx.fillText("PREDICTED →", W - pad.right - 4, pad.top + 12);
      }

      animFrame.current = requestAnimationFrame(drawFrame);
    };

    drawFrame();
    return () => cancelAnimationFrame(animFrame.current);
  }, [filteredPredictions, filteredEvents, selectedRange, startH, endH]);

  // Mouse hover
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const relX = (x - 50) / (rect.width - 70);
      const hoverHour = startH + relX * (endH - startH);
      const closest = filteredPredictions.reduce(
        (c, p) =>
          Math.abs(p.hour - hoverHour) < Math.abs(c.hour - hoverHour) ? p : c,
        filteredPredictions[0],
      );
      if (
        closest &&
        Math.abs(closest.hour - hoverHour) <
          ((endH - startH) / filteredPredictions.length) * 2
      ) {
        setHoveredPoint(closest);
        setMousePos({ x: e.clientX, y: e.clientY });
      } else {
        setHoveredPoint(null);
      }
    },
    [filteredPredictions, startH, endH],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 pt-[128px] flex items-center justify-center">
        <div className="text-center">
          <Brain className="w-12 h-12 text-cyan-400 mx-auto mb-4 animate-pulse" />
          <p className="text-cyan-400 font-orbitron animate-pulse">
            LOADING THREAT PREDICTION MODEL...
          </p>
          <p className="text-[10px] font-space-mono text-cyan-400/40 mt-2">
            Fetching live weather & marine data across 6 zones
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 pt-[128px] flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-red-400 font-orbitron">
            PREDICTION ENGINE OFFLINE
          </p>
          <p className="text-xs font-space-mono text-slate-500 mt-2">{error}</p>
          <button
            onClick={fetchIntel}
            className="mt-4 px-4 py-2 border border-cyan-500/30 text-cyan-400 rounded-lg font-orbitron text-xs hover:bg-cyan-500/10"
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  const currentThreat = nowPrediction?.threatLevel ?? 0;
  const threatColor =
    currentThreat < 20
      ? "text-emerald-400"
      : currentThreat < 40
        ? "text-yellow-400"
        : currentThreat < 60
          ? "text-orange-400"
          : currentThreat < 80
            ? "text-red-400"
            : "text-red-500";

  return (
    <div className="min-h-screen bg-slate-950 pt-[128px] pb-20 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-orbitron font-black text-cyan-400 tracking-wider mb-1">
            AI THREAT PREDICTION ENGINE
          </h1>
          <p className="text-[10px] font-space-mono text-cyan-400/40 tracking-widest">
            REAL-TIME MARITIME THREAT FORECASTING // LIVE DATA FROM{" "}
            {intel?.zones.length || 0} NAVAL ZONES
          </p>
          <p className="text-[9px] font-space-mono text-emerald-400/40 mt-1">
            Data source: Open-Meteo Marine & Weather API // Updated:{" "}
            {intel?.timestamp
              ? new Date(intel.timestamp).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })
              : "—"}{" "}
            IST
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-slate-900/80 border border-cyan-500/20 rounded-lg p-3 text-center">
            <div className="text-[8px] font-space-mono text-cyan-400/50 mb-1">
              CURRENT THREAT
            </div>
            <div className={`text-2xl font-orbitron font-black ${threatColor}`}>
              {Math.round(currentThreat)}
            </div>
            <div className={`text-[8px] font-orbitron ${threatColor}`}>
              {nowPrediction?.category?.toUpperCase() || "—"}
            </div>
          </div>
          <div className="bg-slate-900/80 border border-cyan-500/20 rounded-lg p-3 text-center">
            <div className="text-[8px] font-space-mono text-cyan-400/50 mb-1">
              MODEL CONFIDENCE
            </div>
            <div className="text-2xl font-orbitron font-black text-cyan-400">
              {nowPrediction ? (nowPrediction.confidence * 100).toFixed(0) : 0}%
            </div>
            <div className="text-[8px] font-orbitron text-cyan-400/60">
              LIVE
            </div>
          </div>
          <div className="bg-slate-900/80 border border-cyan-500/20 rounded-lg p-3 text-center">
            <div className="text-[8px] font-space-mono text-cyan-400/50 mb-1">
              PEAK (+24H)
            </div>
            <div className="text-2xl font-orbitron font-black text-amber-400">
              {predictions.length
                ? Math.round(
                    Math.max(
                      ...predictions
                        .filter((p) => p.hour >= 0 && p.hour <= 24)
                        .map((p) => p.threatLevel),
                    ),
                  )
                : 0}
            </div>
            <div className="text-[8px] font-orbitron text-amber-400/60">
              PROJECTED
            </div>
          </div>
          <div className="bg-slate-900/80 border border-cyan-500/20 rounded-lg p-3 text-center">
            <div className="text-[8px] font-space-mono text-cyan-400/50 mb-1">
              AVG WAVE HEIGHT
            </div>
            <div className="text-2xl font-orbitron font-black text-cyan-400">
              {nowPrediction ? nowPrediction.waveHeight.toFixed(1) : "—"}m
            </div>
            <div className="text-[8px] font-orbitron text-cyan-400/60">
              REAL
            </div>
          </div>
          <div className="bg-slate-900/80 border border-cyan-500/20 rounded-lg p-3 text-center">
            <div className="text-[8px] font-space-mono text-cyan-400/50 mb-1">
              AVG WIND SPEED
            </div>
            <div className="text-2xl font-orbitron font-black text-orange-400">
              {nowPrediction ? nowPrediction.windSpeed.toFixed(0) : "—"} km/h
            </div>
            <div className="text-[8px] font-orbitron text-orange-400/60">
              REAL
            </div>
          </div>
        </div>

        {/* Range selector + refresh */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-orbitron text-cyan-400">
              PREDICTIVE TIMELINE
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {(["12h", "24h", "48h", "72h"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setSelectedRange(r)}
                  className={`px-3 py-1 text-[9px] font-orbitron rounded transition-all ${
                    selectedRange === r
                      ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                      : "text-cyan-400/30 hover:text-cyan-400/60 border border-transparent"
                  }`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              onClick={fetchIntel}
              className="px-2 py-1 text-[9px] font-orbitron text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/10 transition-all"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Chart */}
        <div
          ref={containerRef}
          className="relative bg-slate-900/50 border border-cyan-500/20 rounded-xl overflow-hidden"
          style={{ height: 400 }}
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredPoint(null)}
          />

          {hoveredPoint && (
            <div
              className="fixed z-50 bg-slate-900/95 border border-cyan-500/30 rounded-lg p-3 pointer-events-none shadow-xl shadow-cyan-500/10"
              style={{
                left: mousePos.x + 15,
                top: mousePos.y - 100,
                maxWidth: 280,
              }}
            >
              <div className="text-[9px] font-space-mono text-cyan-400/50 mb-1">
                {hoveredPoint.timestamp.toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}{" "}
                ({hoveredPoint.hour > 0 ? "+" : ""}
                {hoveredPoint.hour.toFixed(0)}h)
              </div>
              <div
                className={`text-lg font-orbitron font-black ${
                  hoveredPoint.threatLevel < 40
                    ? "text-emerald-400"
                    : hoveredPoint.threatLevel < 60
                      ? "text-amber-400"
                      : "text-red-400"
                }`}
              >
                THREAT: {hoveredPoint.threatLevel.toFixed(1)}
              </div>
              <div className="text-[8px] font-space-mono text-cyan-400/40 mt-1">
                Confidence: {(hoveredPoint.confidence * 100).toFixed(0)}% |
                Range: {hoveredPoint.lowerBound.toFixed(0)}-
                {hoveredPoint.upperBound.toFixed(0)}
              </div>
              <div className="text-[8px] font-space-mono text-slate-500 mt-1">
                Wave: {hoveredPoint.waveHeight.toFixed(1)}m | Wind:{" "}
                {hoveredPoint.windSpeed.toFixed(0)}km/h | Vis:{" "}
                {(hoveredPoint.visibility / 1000).toFixed(0)}km
              </div>
              {hoveredPoint.factors.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {hoveredPoint.factors.map((f, i) => (
                    <div
                      key={i}
                      className="text-[8px] font-space-mono text-amber-400/60"
                    >
                      ⚠ {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Events */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-orbitron text-cyan-400">
              EVENTS FROM LIVE DATA
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {events.slice(0, 9).map((e, i) => {
              const hoursFromNow = (e.time.getTime() - Date.now()) / 3600000;
              const isPast = hoursFromNow < 0;
              return (
                <div
                  key={i}
                  className={`bg-slate-900/60 border rounded-lg p-3 transition-all hover:scale-[1.02] ${
                    e.severity > 60
                      ? "border-red-500/20 hover:border-red-500/40"
                      : e.severity > 30
                        ? "border-amber-500/20 hover:border-amber-500/40"
                        : "border-cyan-500/20 hover:border-cyan-500/40"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {e.type === "intrusion" && (
                        <AlertTriangle className="w-3 h-3 text-red-400" />
                      )}
                      {e.type === "patrol" && (
                        <Shield className="w-3 h-3 text-emerald-400" />
                      )}
                      {e.type === "weather" && (
                        <Radio className="w-3 h-3 text-amber-400" />
                      )}
                      {e.type === "deployment" && (
                        <Zap className="w-3 h-3 text-cyan-400" />
                      )}
                      <span
                        className={`text-[8px] font-orbitron px-1.5 py-0.5 rounded ${
                          isPast
                            ? "bg-slate-700/50 text-slate-400"
                            : "bg-cyan-500/10 text-cyan-400"
                        }`}
                      >
                        {isPast
                          ? `${Math.abs(Math.round(hoursFromNow))}H AGO`
                          : `IN ${Math.round(hoursFromNow)}H`}
                      </span>
                    </div>
                    <div
                      className={`text-[8px] font-orbitron px-1.5 py-0.5 rounded ${
                        e.severity > 60
                          ? "bg-red-500/20 text-red-400"
                          : e.severity > 30
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-emerald-500/20 text-emerald-400"
                      }`}
                    >
                      SEV: {e.severity}
                    </div>
                  </div>
                  <div className="text-[10px] font-space-mono text-slate-300">
                    {e.title}
                  </div>
                  <div className="text-[8px] font-space-mono text-slate-500 mt-1">
                    {e.zone}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Zone breakdown */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-orbitron text-cyan-400">
              ZONE-BY-ZONE THREAT LEVELS (LIVE)
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {intel?.zones.map((z) => (
              <div
                key={z.id}
                className="bg-slate-900/60 border border-cyan-500/20 rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-orbitron text-cyan-400">
                    {z.name}
                  </span>
                  <span
                    className={`text-[8px] font-orbitron px-2 py-0.5 rounded ${
                      z.threat.level >= 75
                        ? "bg-red-500/20 text-red-400"
                        : z.threat.level >= 50
                          ? "bg-orange-500/20 text-orange-400"
                          : z.threat.level >= 25
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-emerald-500/20 text-emerald-400"
                    }`}
                  >
                    {z.threat.level}%
                  </span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
                  <div
                    className={`h-full rounded-full ${
                      z.threat.level >= 75
                        ? "bg-red-500"
                        : z.threat.level >= 50
                          ? "bg-orange-500"
                          : z.threat.level >= 25
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                    }`}
                    style={{ width: `${z.threat.level}%` }}
                  />
                </div>
                <div className="space-y-0.5">
                  {z.threat.factors.slice(0, 2).map((f, i) => (
                    <div
                      key={i}
                      className="text-[8px] font-space-mono text-slate-500"
                    >
                      {f.name}: {f.detail}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-2 text-[7px] font-space-mono text-slate-600">
                  <span>
                    Wave: {z.marine?.current?.wave_height?.toFixed(1) || "—"}m
                  </span>
                  <span>
                    Wind:{" "}
                    {z.weather?.current?.wind_speed_10m?.toFixed(0) || "—"}km/h
                  </span>
                  <span>
                    Vis:{" "}
                    {z.weather?.current?.visibility
                      ? (z.weather.current.visibility / 1000).toFixed(0) + "km"
                      : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Model info */}
        <div className="mt-6 bg-slate-900/40 border border-cyan-500/10 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-4 h-4 text-cyan-400/50" />
            <span className="text-[9px] font-orbitron text-cyan-400/50">
              DATA SOURCES & METHODOLOGY
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[9px] font-space-mono text-slate-500">
            <div>
              <span className="text-slate-600">Weather:</span> Open-Meteo
              Forecast API
            </div>
            <div>
              <span className="text-slate-600">Marine:</span> Open-Meteo Marine
              API
            </div>
            <div>
              <span className="text-slate-600">Zones:</span>{" "}
              {intel?.zones.length || 0} IOR naval zones
            </div>
            <div>
              <span className="text-slate-600">Forecast:</span> 72-hour hourly
              data
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
