import { NextResponse } from "next/server";

// Indian Navy operational zones with coordinates
const NAVAL_ZONES = [
  {
    id: "arabian-sea",
    name: "Arabian Sea",
    lat: 15.0,
    lon: 65.0,
    command: "Western Naval Command",
    hq: "Mumbai",
  },
  {
    id: "bay-of-bengal",
    name: "Bay of Bengal",
    lat: 14.0,
    lon: 85.0,
    command: "Eastern Naval Command",
    hq: "Visakhapatnam",
  },
  {
    id: "andaman-sea",
    name: "Andaman Sea",
    lat: 11.0,
    lon: 93.0,
    command: "Andaman & Nicobar Command",
    hq: "Port Blair",
  },
  {
    id: "laccadive-sea",
    name: "Laccadive Sea",
    lat: 10.0,
    lon: 73.0,
    command: "Southern Naval Command",
    hq: "Kochi",
  },
  {
    id: "indian-ocean-south",
    name: "Indian Ocean (South)",
    lat: 0.0,
    lon: 75.0,
    command: "Far Sea Operations",
    hq: "Karwar",
  },
  {
    id: "gulf-of-mannar",
    name: "Gulf of Mannar",
    lat: 8.5,
    lon: 79.0,
    command: "Tamil Nadu Naval Area",
    hq: "Chennai",
  },
];

async function fetchMarineData(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period&hourly=wave_height,wave_direction,wave_period,swell_wave_height&forecast_days=3&timezone=Asia/Kolkata`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWeatherData(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure&hourly=visibility,temperature_2m,wind_speed_10m&forecast_days=3&timezone=Asia/Kolkata`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// AI Threat Assessment Algorithm
function calculateThreatLevel(
  marine: any,
  weather: any,
): {
  level: number; // 0-100
  category: string;
  factors: { name: string; score: number; detail: string }[];
} {
  const factors: { name: string; score: number; detail: string }[] = [];

  // Sea state threat
  const waveHeight = marine?.current?.wave_height ?? 0;
  let seaScore = Math.min(waveHeight * 12, 30);
  factors.push({
    name: "Sea State",
    score: Math.round(seaScore),
    detail: `Wave height: ${waveHeight}m — ${waveHeight < 1 ? "Calm" : waveHeight < 2.5 ? "Moderate" : waveHeight < 4 ? "Rough" : "Very Rough"}`,
  });

  // Visibility threat (low visibility = higher submarine threat)
  const visibility = weather?.hourly?.visibility?.[0] ?? 50000;
  const visKm = visibility / 1000;
  let visScore = visKm < 2 ? 25 : visKm < 5 ? 18 : visKm < 10 ? 10 : 5;
  factors.push({
    name: "Visibility Risk",
    score: visScore,
    detail: `Visibility: ${visKm.toFixed(1)}km — ${visKm < 2 ? "Poor — submarine advantage" : visKm < 5 ? "Reduced — heightened alert" : visKm < 10 ? "Moderate" : "Clear"}`,
  });

  // Wind conditions
  const windSpeed = weather?.current?.wind_speed_10m ?? 0;
  const gustSpeed = weather?.current?.wind_gusts_10m ?? 0;
  let windScore = Math.min((windSpeed + gustSpeed * 0.5) * 0.5, 20);
  factors.push({
    name: "Wind Conditions",
    score: Math.round(windScore),
    detail: `Wind: ${windSpeed} km/h, Gusts: ${gustSpeed} km/h — ${windSpeed < 15 ? "Favorable" : windSpeed < 30 ? "Challenging" : "Hazardous"}`,
  });

  // Time-based threat (night = higher)
  const hour = new Date().getHours();
  const isNight = hour < 6 || hour > 18;
  const timeScore = isNight ? 15 : 5;
  factors.push({
    name: "Temporal Risk",
    score: timeScore,
    detail: `${isNight ? "Night operations — reduced visibility, higher submarine infiltration risk" : "Daylight operations — standard surveillance effective"}`,
  });

  // Swell analysis
  const swellHeight = marine?.current?.swell_wave_height ?? 0;
  let swellScore = Math.min(swellHeight * 5, 10);
  factors.push({
    name: "Swell Analysis",
    score: Math.round(swellScore),
    detail: `Swell: ${swellHeight}m — ${swellHeight < 1 ? "Low — mine detection feasible" : swellHeight < 2 ? "Moderate — sonar degradation possible" : "High — reduced sonar effectiveness"}`,
  });

  const totalScore = Math.min(
    Math.round(factors.reduce((s, f) => s + f.score, 0)),
    100,
  );
  const category =
    totalScore < 25
      ? "LOW"
      : totalScore < 50
        ? "MODERATE"
        : totalScore < 75
          ? "HIGH"
          : "CRITICAL";

  return { level: totalScore, category, factors };
}

// Operational readiness based on conditions
function calculateOpsReadiness(marine: any, weather: any) {
  const waveHeight = marine?.current?.wave_height ?? 0;
  const windSpeed = weather?.current?.wind_speed_10m ?? 0;
  const visibility = (weather?.hourly?.visibility?.[0] ?? 50000) / 1000;
  const swellHeight = marine?.current?.swell_wave_height ?? 0;

  return [
    {
      operation: "Submarine Operations",
      icon: "submarine",
      ready: waveHeight < 4 && windSpeed < 40,
      confidence: Math.max(0, 100 - waveHeight * 15 - windSpeed * 0.5),
      conditions: `Waves ${waveHeight}m, Wind ${windSpeed}km/h`,
      status:
        waveHeight < 2 ? "OPTIMAL" : waveHeight < 4 ? "FEASIBLE" : "RESTRICTED",
    },
    {
      operation: "Surface Patrol",
      icon: "ship",
      ready: waveHeight < 3 && windSpeed < 35,
      confidence: Math.max(0, 100 - waveHeight * 20 - windSpeed * 0.8),
      conditions: `Sea state ${waveHeight < 0.5 ? "0-1" : waveHeight < 1.25 ? "2-3" : waveHeight < 2.5 ? "4" : "5+"}, Wind ${windSpeed}km/h`,
      status:
        waveHeight < 1.25
          ? "OPTIMAL"
          : waveHeight < 2.5
            ? "FEASIBLE"
            : waveHeight < 4
              ? "CAUTION"
              : "NO-GO",
    },
    {
      operation: "Helicopter Operations",
      icon: "helicopter",
      ready: windSpeed < 25 && visibility > 3 && waveHeight < 3,
      confidence: Math.max(
        0,
        100 - windSpeed * 2 - (10 - Math.min(visibility, 10)) * 5,
      ),
      conditions: `Visibility ${visibility.toFixed(1)}km, Wind ${windSpeed}km/h`,
      status:
        windSpeed < 15 && visibility > 5
          ? "OPTIMAL"
          : windSpeed < 25 && visibility > 3
            ? "FEASIBLE"
            : "NO-GO",
    },
    {
      operation: "Diving Operations",
      icon: "diver",
      ready: waveHeight < 1.5 && swellHeight < 1 && windSpeed < 20,
      confidence: Math.max(
        0,
        100 - waveHeight * 30 - swellHeight * 20 - windSpeed * 1,
      ),
      conditions: `Waves ${waveHeight}m, Swell ${swellHeight}m`,
      status:
        waveHeight < 0.5 ? "OPTIMAL" : waveHeight < 1.5 ? "FEASIBLE" : "NO-GO",
    },
    {
      operation: "Mine Countermeasures",
      icon: "mine",
      ready: waveHeight < 1 && visibility > 5 && swellHeight < 0.5,
      confidence: Math.max(
        0,
        100 -
          waveHeight * 40 -
          swellHeight * 30 -
          (10 - Math.min(visibility, 10)) * 3,
      ),
      conditions: `Waves ${waveHeight}m, Visibility ${visibility.toFixed(1)}km`,
      status:
        waveHeight < 0.5 && visibility > 8
          ? "OPTIMAL"
          : waveHeight < 1
            ? "FEASIBLE"
            : "NO-GO",
    },
    {
      operation: "Amphibious Assault",
      icon: "assault",
      ready: waveHeight < 2 && windSpeed < 25 && visibility > 5,
      confidence: Math.max(
        0,
        100 -
          waveHeight * 25 -
          windSpeed * 1.2 -
          (10 - Math.min(visibility, 10)) * 4,
      ),
      conditions: `Waves ${waveHeight}m, Wind ${windSpeed}km/h, Vis ${visibility.toFixed(0)}km`,
      status:
        waveHeight < 1 && windSpeed < 15
          ? "OPTIMAL"
          : waveHeight < 2
            ? "FEASIBLE"
            : "NO-GO",
    },
  ];
}

// AI intelligence brief generator
function generateIntelBrief(zones: any[]) {
  const timestamp = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });
  const criticalZones = zones.filter((z) => z.threat.level >= 50);
  const highestThreat = zones.reduce(
    (max, z) => (z.threat.level > max.threat.level ? z : max),
    zones[0],
  );

  let brief = `FLASH // INDIAN NAVAL INTELLIGENCE // ${timestamp} IST\n`;
  brief += `═══════════════════════════════════════════════════════\n`;
  brief += `SUBJECT: Maritime Domain Awareness — Operational Summary\n`;
  brief += `CLASSIFICATION: SECRET // NOFORN // MAREYE-AI\n`;
  brief += `═══════════════════════════════════════════════════════\n\n`;

  brief += `1. SITUATION OVERVIEW:\n`;
  brief += `   Active monitoring of ${zones.length} naval operational zones.\n`;
  brief += `   Overall threat assessment: ${criticalZones.length > 0 ? "ELEVATED" : "NORMAL"}.\n`;
  brief += `   Highest threat zone: ${highestThreat.name} (${highestThreat.threat.category} — ${highestThreat.threat.level}%).\n\n`;

  brief += `2. ZONE-BY-ZONE ANALYSIS:\n`;
  zones.forEach((z, i) => {
    brief += `   ${String.fromCharCode(65 + i)}. ${z.name.toUpperCase()} [${z.command}]:\n`;
    brief += `      Threat Level: ${z.threat.category} (${z.threat.level}%)\n`;
    brief += `      Sea State: Wave Ht ${z.marine?.current?.wave_height ?? "N/A"}m, `;
    brief += `Swell ${z.marine?.current?.swell_wave_height ?? "N/A"}m\n`;
    brief += `      Weather: ${z.weather?.current?.temperature_2m ?? "N/A"}°C, `;
    brief += `Wind ${z.weather?.current?.wind_speed_10m ?? "N/A"}km/h, `;
    brief += `Cloud ${z.weather?.current?.cloud_cover ?? "N/A"}%\n`;
    const readyOps = z.ops.filter((o: any) => o.ready).length;
    brief += `      Ops Readiness: ${readyOps}/${z.ops.length} operations feasible\n\n`;
  });

  brief += `3. AI RECOMMENDATION:\n`;
  if (criticalZones.length > 0) {
    brief += `   ⚠ ALERT: ${criticalZones.length} zone(s) reporting elevated threat conditions.\n`;
    brief += `   Recommend increased ASW patrols in ${criticalZones.map((z) => z.name).join(", ")}.\n`;
    brief += `   Maritime patrol aircraft sorties should be prioritized.\n`;
  } else {
    brief += `   All zones within normal operating parameters.\n`;
    brief += `   Standard patrol schedules recommended.\n`;
    brief += `   Favorable conditions for scheduled exercises.\n`;
  }

  brief += `\n4. FORECAST:\n`;
  brief += `   72-hour maritime forecast available per-zone.\n`;
  brief += `   Next intelligence update: T+60 minutes.\n\n`;

  brief += `═══════════════════════════════════════════════════════\n`;
  brief += `MAREYE AI DEFENSE SYSTEM // INDIAN NAVAL COMMAND\n`;
  brief += `END OF REPORT // ${timestamp} IST\n`;

  return brief;
}

export async function GET() {
  try {
    const results = await Promise.all(
      NAVAL_ZONES.map(async (zone) => {
        let marine = null;
        let weather = null;
        try {
          [marine, weather] = await Promise.all([
            fetchMarineData(zone.lat, zone.lon),
            fetchWeatherData(zone.lat, zone.lon),
          ]);
        } catch {
          // If external APIs fail, continue with null data — threat calc handles nulls
        }

        const threat = calculateThreatLevel(marine, weather);
        const ops = calculateOpsReadiness(marine, weather);

        return {
          ...zone,
          marine,
          weather,
          threat,
          ops,
        };
      }),
    );

    const brief = generateIntelBrief(results);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      zones: results,
      brief,
      summary: {
        totalZones: results.length,
        criticalZones: results.filter((z) => z.threat.level >= 75).length,
        highZones: results.filter(
          (z) => z.threat.level >= 50 && z.threat.level < 75,
        ).length,
        moderateZones: results.filter(
          (z) => z.threat.level >= 25 && z.threat.level < 50,
        ).length,
        lowZones: results.filter((z) => z.threat.level < 25).length,
        avgThreat: Math.round(
          results.reduce((s, z) => s + z.threat.level, 0) / results.length,
        ),
        overallReadiness: Math.round(
          (results.reduce(
            (s, z) => s + z.ops.filter((o: any) => o.ready).length,
            0,
          ) /
            (results.length * results[0].ops.length)) *
            100,
        ),
      },
    });
  } catch (error: any) {
    console.error("Intelligence API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch intelligence data", detail: error.message },
      { status: 500 },
    );
  }
}
