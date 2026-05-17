// ============================================================
// SMART CROP AI — REACT NATIVE (Expo SDK 54) PORT
// ============================================================
// Ported from the web version (../smart-crop/src/App.jsx).
// Same flow: dummy ESP32 sensor data -> local proxy server.js -> Groq AI -> UI.
//
// HOW TO RUN (both terminals in this folder)
//   Terminal 1:  npm run server     (Groq proxy on port 3002 — runs server.mjs)
//   Terminal 2:  npm start          (Expo Metro bundler — scan QR with Expo Go)
//
// IMPORTANT — set CONFIG.API_HOST below.
//   Phones cannot reach "localhost"; use your computer's LAN IP on the same Wi-Fi.
//   Find it with:  ip addr | grep "inet "  (Linux)
//   Android emulator can use 10.0.2.2 to reach the host.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StatusBar,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import { onAuthStateChanged, signOut } from 'firebase/auth';

import LoginScreen from './LoginScreen';
import { getAuthInstance, isConfigured } from './firebase';

// ============================================================
// SECTION 1: CONFIGURATION
// ============================================================
const CONFIG = {
  CROP_TYPE:         'Maize',
  DISTRICT:          'Chukha',
  VILLAGE:           'Phuentsholing',
  LAT:               27.4712,
  LON:               89.6339,
  ALTITUDE_M:        302,
  SENSOR_REFRESH_MS: 30000,

  // Your dev machine's LAN IP — used when running on a real phone via Expo Go.
  // Find with:  ip -4 addr | grep "inet "
  API_HOST_LAN: '172.20.10.9',
  API_PORT:     3002,
};

// Backend URL — hard-coded for simplicity. If the page is hosted anywhere
// other than localhost (i.e. on Vercel), call the Render backend directly.
const PROD_API = 'https://smart-crop-api-x50x.onrender.com/api/analyze';
const isWeb    = Platform.OS === 'web';
const isProdWeb = isWeb && typeof window !== 'undefined'
                       && window.location.hostname !== 'localhost';
const PROXY_URL = isProdWeb
  ? PROD_API
  : `http://${isWeb ? 'localhost' : CONFIG.API_HOST_LAN}:${CONFIG.API_PORT}/api/analyze`;

// ============================================================
// SECTION 2: DUMMY ESP32 SENSOR DATA
// ============================================================
const generateESP32Data = () => {
  const rainfall     = parseFloat((Math.random() * 18).toFixed(1));
  const soilMoisture = parseFloat((28 + Math.random() * 52).toFixed(1));
  const temperature  = parseFloat((14 + Math.random() * 20).toFixed(1));
  const humidity     = parseFloat((42 + Math.random() * 42).toFixed(1));
  const ph           = parseFloat((5.2 + Math.random() * 2.8).toFixed(2));
  const nitrogen     = Math.round(60 + Math.random() * 200);

  return {
    device_id:        'ESP32-BT-CHUKHA-001',
    firmware_version: '2.1.4',
    timestamp:        new Date().toISOString(),
    location: {
      lat:        CONFIG.LAT,
      lon:        CONFIG.LON,
      district:   CONFIG.DISTRICT,
      village:    CONFIG.VILLAGE,
      altitude_m: CONFIG.ALTITUDE_M,
      crop:       CONFIG.CROP_TYPE,
      field_id:   'FIELD-07',
    },
    sensors: {
      temperature_celsius:   temperature,
      humidity_percent:      humidity,
      soil_moisture_percent: soilMoisture,
      soil_ph:               ph,
      light_lux:             Math.round(10000 + Math.random() * 70000),
      nitrogen_ppm:          nitrogen,
      phosphorus_ppm:        Math.round(12 + Math.random() * 75),
      potassium_ppm:         Math.round(80 + Math.random() * 220),
      rainfall_mm_24h:       rainfall,
      wind_speed_kmh:        parseFloat((Math.random() * 28).toFixed(1)),
      co2_ppm:               Math.round(380 + Math.random() * 90),
    },
    device_status: {
      battery_percent:     Math.round(55 + Math.random() * 45),
      signal_strength_dbm: Math.round(-82 + Math.random() * 42),
      uptime_hours:        Math.round(80 + Math.random() * 700),
      last_calibration:    '2026-04-01',
      errors:              [],
    },
  };
};

// ============================================================
// SECTION 3: AI PROMPT BUILDER
// ============================================================
const buildAIPrompt = (data) => {
  const month  = new Date().getMonth();
  const season = (month >= 5 && month <= 9)
    ? 'Monsoon (June-October)'
    : 'Dry Season (Nov-May)';

  return `You are an agricultural AI expert for Bhutan's smallholder farmers (${data.location.district} district).

Analyze this real-time ESP32 sensor data and respond ONLY with a valid JSON object.
No markdown, no explanation, no code fences. Just raw JSON.

ESP32 SENSOR DATA:
${JSON.stringify(data, null, 2)}

CONTEXT:
- Crop: ${data.location.crop}
- Season: ${season}
- Region: Bhutan subtropical foothills, monsoon climate
- Altitude: ${data.location.altitude_m}m
- Users: Smallholder farmers — use simple language

Return EXACTLY this JSON (fill every field):
{
  "health_score": <integer 0-100>,
  "summary": <one sentence for farmer>,
  "weather":     { "symbol": <one of: "☀️" "⛅" "🌧️" "🌩️" "🌫️">, "label": <3-4 words>, "message": <1 simple sentence> },
  "irrigation":  { "symbol": <one of: "💧" "✅" "⛔" "🚿">, "label": <"Irrigate Now" OR "Moisture Good" OR "Skip — Rain Soon" OR "Too Wet">, "urgency": <"high" OR "medium" OR "low">, "liters_per_sqm": <number, 0 if skip>, "message": <1 simple sentence> },
  "disease_risk":{ "symbol": <one of: "⚠️" "✅" "🔴" "🟡">, "label": <"Disease Risk" OR "Crop Healthy" OR "Critical Risk" OR "Monitor Closely">, "risk_level": <"high" OR "medium" OR "low" OR "none">, "disease_name": <likely disease name or null>, "prevention": <1 sentence tip or null> },
  "soil":        { "symbol": <one of: "🌱" "⚠️" "✅" "🔴" "🟡">, "label": <3-4 words>, "ph_status": <"acidic" OR "optimal" OR "alkaline">, "npk_status": <"low" OR "balanced" OR "high" OR "deficient">, "message": <1 sentence fertilizer or soil advice> },
  "sms_alert": <plain English SMS, MAX 160 chars, simple words, start with a symbol>,
  "recommendations": [
    {"priority": 1, "symbol": <emoji>, "action": <5-6 word title>, "detail": <1 sentence>, "timing": <"Today" OR "This week" OR "Urgent — now">},
    {"priority": 2, "symbol": <emoji>, "action": <5-6 word title>, "detail": <1 sentence>, "timing": <...>},
    {"priority": 3, "symbol": <emoji>, "action": <5-6 word title>, "detail": <1 sentence>, "timing": <...>}
  ],
  "alert_type": <"none" OR "info" OR "warning" OR "critical">,
  "confidence_percent": <integer 60-99>,
  "next_check_hours": <integer>
}`;
};

// ============================================================
// SECTION 4: API CALL
// ============================================================
const analyzeWithAI = async (sensorData) => {
  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages:   [{ role: 'user', content: buildAIPrompt(sensorData) }],
    }),
  });

  if (!response.ok) throw new Error(`Proxy error: ${response.status}`);

  const data  = await response.json();
  const text  = data.content[0].text;
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
};

// ============================================================
// SECTION 5: THRESHOLDS & UTILITIES
// ============================================================
const THRESHOLDS = {
  temperature_celsius:   { min: 15,    max: 32,    unit: '°C',    label: 'Temperature'   },
  humidity_percent:      { min: 40,    max: 80,    unit: '%',     label: 'Humidity'      },
  soil_moisture_percent: { min: 30,    max: 70,    unit: '%',     label: 'Soil Moisture' },
  soil_ph:               { min: 5.5,   max: 7.0,   unit: '',      label: 'Soil pH'       },
  nitrogen_ppm:          { min: 100,   max: 280,   unit: ' ppm',  label: 'Nitrogen'      },
  phosphorus_ppm:        { min: 20,    max: 80,    unit: ' ppm',  label: 'Phosphorus'    },
  potassium_ppm:         { min: 120,   max: 300,   unit: ' ppm',  label: 'Potassium'     },
  light_lux:             { min: 10000, max: 80000, unit: ' lux',  label: 'Light'         },
  rainfall_mm_24h:       { min: 0,     max: 15,    unit: ' mm',   label: 'Rainfall'      },
  wind_speed_kmh:        { min: 0,     max: 25,    unit: ' km/h', label: 'Wind'          },
  co2_ppm:               { min: 350,   max: 450,   unit: ' ppm',  label: 'CO2'           },
};

const getSensorStatus = (key, value) => {
  const t = THRESHOLDS[key];
  if (!t) return 'normal';
  return (value < t.min || value > t.max) ? 'warning' : 'normal';
};

const formatValue = (key, value) => {
  const t = THRESHOLDS[key];
  const unit = t?.unit ?? '';
  return typeof value === 'number'
    ? `${Number.isInteger(value) ? value : value.toFixed(1)}${unit}`
    : String(value);
};

const signalStrength = (dbm) => {
  if (dbm > -60) return { bars: '▂▄▆█', label: 'Strong', color: '#4ade80' };
  if (dbm > -70) return { bars: '▂▄▆░', label: 'Good',   color: '#86efac' };
  if (dbm > -80) return { bars: '▂▄░░', label: 'Weak',   color: '#fbbf24' };
  return              { bars: '▂░░░', label: 'Poor',   color: '#f87171' };
};

const healthColor = (score) => {
  if (!score) return '#6b7280';
  if (score >= 80) return '#4ade80';
  if (score >= 65) return '#86efac';
  if (score >= 50) return '#fbbf24';
  if (score >= 35) return '#f97316';
  return '#f87171';
};

const alertColors = {
  none:     { bg: 'rgba(74,222,128,0.1)',  border: '#4ade80', text: '#86efac' },
  info:     { bg: 'rgba(96,165,250,0.1)',  border: '#60a5fa', text: '#93c5fd' },
  warning:  { bg: 'rgba(251,191,36,0.1)',  border: '#fbbf24', text: '#fcd34d' },
  critical: { bg: 'rgba(248,113,113,0.1)', border: '#f87171', text: '#fca5a5' },
};

// ============================================================
// SECTION 6: SHARED STYLES
// ============================================================
const COLORS = {
  bg:       '#0b1a0b',
  panel:    'rgba(255,255,255,0.04)',
  panelAlt: 'rgba(255,255,255,0.03)',
  border:   'rgba(74,222,128,0.15)',
  borderS:  'rgba(74,222,128,0.2)',
  green:    '#4ade80',
  greenL:   '#86efac',
  text:     '#d1fae5',
  red:      '#f87171',
  amber:    '#fbbf24',
};

const card = {
  backgroundColor: COLORS.panel,
  borderWidth:     1,
  borderColor:     COLORS.border,
  borderRadius:    12,
  padding:         16,
};

const sectionLabel = {
  fontSize:      11,
  fontWeight:    '700',
  letterSpacing: 1.2,
  color:         COLORS.green,
  textTransform: 'uppercase',
  marginBottom:  10,
  opacity:       0.8,
};

// ============================================================
// SECTION 7: SUB-COMPONENTS
// ============================================================

function DeviceStatusBar({ data }) {
  if (!data) return null;
  const sig  = signalStrength(data.device_status.signal_strength_dbm);
  const batt = data.device_status.battery_percent;
  const battIcon = batt > 60 ? '🔋' : batt > 20 ? '🪫' : '🔴';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
      <Text style={{ fontSize: 11, color: COLORS.greenL }}>📟 {data.device_id}</Text>
      <Text style={{ fontSize: 11, color: COLORS.greenL }}>{battIcon} {batt}%</Text>
      <Text style={{ fontSize: 11, color: sig.color }}>{sig.bars} {sig.label}</Text>
      <Text style={{ fontSize: 11, color: COLORS.greenL }}>🌽 {data.location.crop}</Text>
      <Text style={{ fontSize: 11, color: COLORS.greenL }}>📍 {data.location.village}</Text>
    </View>
  );
}

function SymbolCard({ symbol, label, message, subtext, borderColor, loading }) {
  return (
    <View style={{
      flexBasis:         '48%',
      flexGrow:          1,
      backgroundColor:   borderColor ? `${borderColor}08` : COLORS.panel,
      borderWidth:       1,
      borderColor:       borderColor ? `${borderColor}40` : COLORS.borderS,
      borderRadius:      16,
      paddingVertical:   20,
      paddingHorizontal: 12,
      alignItems:        'center',
    }}>
      <Text style={{ fontSize: 40, marginBottom: 6 }}>{loading ? '⏳' : symbol}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 4, textAlign: 'center' }}>
        {loading ? 'Analyzing...' : label}
      </Text>
      {message ? (
        <Text style={{ fontSize: 11, color: COLORS.greenL, lineHeight: 16, opacity: 0.85, textAlign: 'center' }}>
          {loading ? 'Getting AI results' : message}
        </Text>
      ) : null}
      {subtext && !loading ? (
        <View style={{
          marginTop:         8,
          backgroundColor:   'rgba(74,222,128,0.08)',
          borderRadius:      6,
          paddingHorizontal: 8,
          paddingVertical:   4,
        }}>
          <Text style={{ fontSize: 11, color: COLORS.green, fontWeight: '600' }}>{subtext}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SensorRow({ sensorKey, value }) {
  const t = THRESHOLDS[sensorKey];
  if (!t) return null;
  const isWarning = getSensorStatus(sensorKey, value) === 'warning';
  const barPct = Math.min(100, Math.max(0,
    t.max > t.min ? ((value - t.min) / (t.max - t.min)) * 100 : 50
  ));
  return (
    <View style={{
      flexDirection:     'row',
      alignItems:        'center',
      gap:               10,
      paddingVertical:   10,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(74,222,128,0.07)',
    }}>
      <Text style={{ width: 110, fontSize: 12, color: COLORS.greenL }}>{t.label}</Text>
      <Text style={{
        width: 70, fontSize: 13, fontWeight: '700',
        color: isWarning ? COLORS.red : COLORS.text,
      }}>
        {formatValue(sensorKey, value)}
      </Text>
      <View style={{
        flex: 1, height: 4,
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 2, overflow: 'hidden',
      }}>
        <View style={{
          width: `${barPct}%`,
          height: '100%',
          backgroundColor: isWarning ? COLORS.red : COLORS.green,
          borderRadius: 2,
        }} />
      </View>
      <Text style={{ fontSize: 14 }}>{isWarning ? '⚠️' : '✅'}</Text>
    </View>
  );
}

function RecommendationItem({ rec }) {
  const timingColor = {
    'Urgent — now': COLORS.red,
    'Today':        COLORS.amber,
    'This week':    COLORS.greenL,
  };
  const tColor = timingColor[rec.timing] ?? COLORS.greenL;
  return (
    <View style={{
      flexDirection:   'row',
      gap:             12,
      alignItems:      'flex-start',
      padding:         14,
      backgroundColor: COLORS.panelAlt,
      borderWidth:     1,
      borderColor:     'rgba(74,222,128,0.1)',
      borderRadius:    10,
      marginBottom:    8,
    }}>
      <Text style={{ fontSize: 26, width: 36, textAlign: 'center' }}>{rec.symbol}</Text>
      <View style={{ flex: 1 }}>
        <View style={{
          flexDirection:  'row',
          justifyContent: 'space-between',
          alignItems:     'flex-start',
          gap:            8,
          marginBottom:   4,
        }}>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: COLORS.text }}>
            {rec.action}
          </Text>
          <View style={{
            backgroundColor:   `${tColor}20`,
            paddingHorizontal: 8,
            paddingVertical:   2,
            borderRadius:      20,
          }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: tColor }}>
              {rec.timing ?? 'Soon'}
            </Text>
          </View>
        </View>
        <Text style={{ fontSize: 12, color: COLORS.greenL, lineHeight: 18 }}>{rec.detail}</Text>
      </View>
    </View>
  );
}

function SMSCard({ log }) {
  const typeColor = alertColors[log.type] ?? alertColors.info;
  return (
    <View style={{
      backgroundColor: COLORS.panelAlt,
      borderWidth:     1,
      borderColor:     `${typeColor.border}30`,
      borderRadius:    12,
      padding:         14,
      marginBottom:    10,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ fontSize: 11, color: COLORS.greenL, opacity: 0.7 }}>
          📱 {log.farmers} farmers · {log.village}
        </Text>
        <Text style={{ fontSize: 11, color: COLORS.greenL, opacity: 0.7 }}>
          🕐 {log.time}
        </Text>
      </View>
      <View style={{
        backgroundColor:        '#1a2f1a',
        borderWidth:            1,
        borderColor:            COLORS.borderS,
        borderRadius:           16,
        borderBottomLeftRadius: 4,
        padding:                12,
      }}>
        <Text style={{ fontSize: 13, lineHeight: 20, color: COLORS.text }}>{log.message}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Text style={{ fontSize: 11, color: COLORS.green }}>✓ Delivered</Text>
        <Text style={{ fontSize: 11, color: COLORS.greenL, opacity: 0.6 }}>|</Text>
        <Text style={{ fontSize: 11, color: COLORS.greenL, opacity: 0.7 }}>
          Type: {log.type.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

function HealthRing({ score }) {
  const r     = 42;
  const circ  = 2 * Math.PI * r;
  const pct   = score ? score / 100 : 0;
  const color = healthColor(score);
  return (
    <View>
      <Svg width={110} height={110} viewBox="0 0 110 110">
        <Circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <Circle
          cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform="rotate(-90 55 55)"
        />
        <SvgText x="55" y="50" textAnchor="middle" fill={color} fontSize="22" fontWeight="700">
          {score ? String(score) : '--'}
        </SvgText>
        <SvgText x="55" y="65" textAnchor="middle" fill={COLORS.greenL} fontSize="9" opacity="0.7">
          / 100
        </SvgText>
      </Svg>
    </View>
  );
}

function GuidePanel() {
  const steps = [
    {
      step: '01', icon: '🛒', title: 'Buy ESP32 + Sensors',
      items: [
        'ESP32 DevKit (DOIT or NodeMCU-32S) — ~Nu 800',
        'DHT22 (temperature + humidity) — ~Nu 250',
        'Capacitive soil moisture sensor — ~Nu 150',
        'BH1750 light sensor module — ~Nu 200',
        'pH sensor module (SEN0169) — ~Nu 1,200',
        'NPK soil sensor (RS485) — ~Nu 3,500 [optional]',
        'Rechargeable 18650 battery + small solar panel',
      ],
    },
    {
      step: '02', icon: '💻', title: 'Flash ESP32 Firmware',
      items: [
        'Install Arduino IDE + ESP32 board package',
        'Install libraries: WiFi, HTTPClient, DHT, BH1750',
        'Add your WiFi credentials and backend API URL to the sketch',
        'ESP32 should POST a JSON payload every 30 seconds',
        'Verify with Arduino Serial Monitor that data is sending',
      ],
    },
    {
      step: '03', icon: '🖥️', title: 'Set Up Backend',
      items: [
        'Deploy a Node.js/Express server (Railway or Render — free tier)',
        'POST /api/sensor-data → saves reading to database',
        'GET /api/sensor/latest → returns most recent reading',
        'Use SQLite locally or PostgreSQL for cloud deployment',
        'Replace generateESP32Data() in this file with fetch(CONFIG API)',
      ],
    },
    {
      step: '04', icon: '📱', title: 'Real SMS Alerts',
      items: [
        'Sign up at console.twilio.com — free trial credits available',
        'npm install twilio in your server.js backend',
        'Send twilio.messages.create when alert_type is warning or critical',
        'For voice calls: use Twilio TwiML to read the SMS text aloud',
        'Store farmer phone numbers in your database',
      ],
    },
    {
      step: '05', icon: '🚀', title: 'Build APK',
      items: [
        'Run: npx eas build -p android — creates a real APK',
        'Install Expo Go on phones for instant testing during dev',
        'Update CONFIG.API_HOST to your deployed backend URL',
        'Sign up at expo.dev — free builds and over-the-air updates',
      ],
    },
    {
      step: '06', icon: '🌾', title: 'Field Deployment',
      items: [
        'Mount ESP32 in a weatherproof IP65 enclosure (~Nu 300)',
        'Bury soil sensors 10–15 cm deep near crop roots',
        'Use a GSM module (SIM800L) for areas without WiFi',
        'Label each device with its field_id for multi-farm tracking',
        'Train one farmer per village as the local tech contact',
      ],
    },
  ];

  return (
    <View style={{ paddingBottom: 32 }}>
      <View style={{ ...card, marginBottom: 16, borderColor: 'rgba(74,222,128,0.3)' }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.green, marginBottom: 6 }}>
          📋 Integration Roadmap
        </Text>
        <Text style={{ fontSize: 13, color: COLORS.greenL, lineHeight: 20 }}>
          This prototype uses simulated data. Follow these 6 steps to connect real
          ESP32 sensors and deploy to farmers in {CONFIG.DISTRICT} district.
          Estimated hardware cost per unit: ~Nu 7,000–9,000.
        </Text>
      </View>
      {steps.map((s) => (
        <View key={s.step} style={{ ...card, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <View style={{
              width: 38, height: 38,
              backgroundColor: 'rgba(74,222,128,0.1)',
              borderRadius: 10,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 20 }}>{s.icon}</Text>
            </View>
            <View>
              <Text style={{ fontSize: 10, color: COLORS.green, fontWeight: '700', letterSpacing: 1 }}>
                STEP {s.step}
              </Text>
              <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.text }}>{s.title}</Text>
            </View>
          </View>
          {s.items.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', marginBottom: 4 }}>
              <Text style={{ fontSize: 12, color: COLORS.greenL, marginRight: 6 }}>•</Text>
              <Text style={{ flex: 1, fontSize: 12, color: COLORS.greenL, lineHeight: 20 }}>{item}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ============================================================
// SECTION 8: MAIN APP
// ============================================================
export default function App() {
  // ── Auth state ─────────────────────────────────────────────
  const [user,      setUser]      = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!isConfigured()) {
      // Firebase env not filled in yet — show LoginScreen so the user sees the
      // helpful "configure .env" message instead of a blank dashboard.
      setAuthReady(true);
      return;
    }
    const auth = getAuthInstance();
    if (!auth) { setAuthReady(true); return; }
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  // ── Dashboard state ────────────────────────────────────────
  const [sensorData,  setSensorData]  = useState(null);
  const [aiResult,    setAiResult]    = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [analyzing,   setAnalyzing]   = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [smsLog,      setSmsLog]      = useState([]);
  const [activeTab,   setActiveTab]   = useState('dashboard');
  const [error,       setError]       = useState(null);

  const refreshSensors = useCallback(() => {
    setLoading(true);
    setError(null);
    setTimeout(() => {
      try {
        const data = generateESP32Data();
        setSensorData(data);
        setLastUpdated(new Date());
      } catch (e) {
        setError('Sensor read failed.');
      } finally {
        setLoading(false);
      }
    }, 500);
  }, []);

  const runAnalysis = useCallback(async (data) => {
    if (!data) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeWithAI(data);
      setAiResult(result);
      if (result.sms_alert && result.alert_type !== 'none') {
        setSmsLog(prev => [{
          id:      Date.now(),
          time:    new Date().toLocaleTimeString(),
          message: result.sms_alert,
          type:    result.alert_type,
          village: data.location.village,
          farmers: Math.round(8 + Math.random() * 18),
        }, ...prev].slice(0, 8));
      }
    } catch (err) {
      setError(`AI error: ${err.message} — Is server.js running at ${PROXY_URL}?`);
    } finally {
      setAnalyzing(false);
    }
  }, []);

  useEffect(() => { refreshSensors(); }, [refreshSensors]);

  useEffect(() => {
    const interval = setInterval(refreshSensors, CONFIG.SENSOR_REFRESH_MS);
    return () => clearInterval(interval);
  }, [refreshSensors]);

  const s  = sensorData?.sensors;
  const ai = aiResult;

  const tabs = [
    { id: 'dashboard', label: '🌾 Dashboard' },
    { id: 'sensors',   label: '📡 Sensors' },
    { id: 'sms',       label: `📱 SMS${smsLog.length > 0 ? ` (${smsLog.length})` : ''}` },
    { id: 'guide',     label: '📋 Guide' },
  ];

  const banner = ai ? (alertColors[ai.alert_type] ?? alertColors.none) : null;
  const topPad = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 44;

  // ── Auth gate ────────────────────────────────────────────
  // While Firebase is rehydrating the session, show a spinner.
  if (!authReady) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.green} />
      </View>
    );
  }
  // No user → show the login screen instead of the dashboard.
  if (!user) {
    return <LoginScreen />;
  }

  const handleLogout = async () => {
    const auth = getAuthInstance();
    if (auth) await signOut(auth);
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* HEADER */}
      <View style={{
        backgroundColor:   'rgba(15,30,15,0.97)',
        borderBottomWidth: 1,
        borderBottomColor: COLORS.borderS,
        paddingHorizontal: 16,
        paddingBottom:     12,
        paddingTop:        topPad + 10,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: COLORS.green, letterSpacing: 0.5 }}>
              🌾 SMART CROP AI
            </Text>
            <Text style={{ fontSize: 11, color: COLORS.greenL, opacity: 0.7, marginTop: 1 }}>
              {user.phoneNumber ?? user.uid.slice(0, 8)} · {CONFIG.DISTRICT}
            </Text>
          </View>
          <Pressable
            onPress={handleLogout}
            style={{
              borderWidth: 1,
              borderColor: 'rgba(74,222,128,0.3)',
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 6,
            }}>
            <Text style={{ color: COLORS.greenL, fontSize: 11 }}>↪ Sign out</Text>
          </Pressable>
        </View>
        <DeviceStatusBar data={sensorData} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {lastUpdated ? (
            <Text style={{ flex: 1, fontSize: 11, color: COLORS.greenL, opacity: 0.6 }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </Text>
          ) : <View style={{ flex: 1 }} />}
          <Pressable
            onPress={refreshSensors}
            disabled={loading}
            style={{
              borderWidth:       1,
              borderColor:       'rgba(74,222,128,0.3)',
              borderRadius:      8,
              paddingHorizontal: 12,
              paddingVertical:   7,
            }}>
            <Text style={{ color: COLORS.greenL, fontSize: 12 }}>
              {loading ? '⏳ Refresh' : '🔄 Refresh'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => runAnalysis(sensorData)}
            disabled={analyzing || !sensorData}
            style={{
              backgroundColor:   (analyzing || !sensorData) ? 'rgba(74,222,128,0.2)' : 'rgba(74,222,128,0.85)',
              borderRadius:      8,
              paddingHorizontal: 14,
              paddingVertical:   8,
            }}>
            <Text style={{
              color:      (analyzing || !sensorData) ? '#6b7280' : '#052e16',
              fontWeight: '700',
              fontSize:   12,
            }}>
              {analyzing ? '⏳ Analyzing' : '🤖 Run AI'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* TAB BAR */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{
          flexGrow:          0,
          backgroundColor:   'rgba(10,20,10,0.95)',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(74,222,128,0.15)',
        }}
        contentContainerStyle={{ paddingHorizontal: 12 }}
      >
        {tabs.map(tab => {
          const active = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              onPress={() => setActiveTab(tab.id)}
              style={{
                paddingHorizontal: 14,
                paddingVertical:   12,
                borderBottomWidth: 2,
                borderBottomColor: active ? COLORS.green : 'transparent',
              }}>
              <Text style={{
                fontSize:   13,
                fontWeight: active ? '700' : '400',
                color:      active ? COLORS.green : COLORS.greenL,
              }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ERROR BANNER */}
      {error ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          <View style={{
            backgroundColor:   alertColors.warning.bg,
            borderWidth:       1,
            borderColor:       alertColors.warning.border,
            borderRadius:      12,
            paddingHorizontal: 14,
            paddingVertical:   10,
          }}>
            <Text style={{ fontSize: 12, color: alertColors.warning.text }}>⚠️ {error}</Text>
          </View>
        </View>
      ) : null}

      {/* MAIN SCROLL */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      >
        {/* ════════ DASHBOARD ════════ */}
        {activeTab === 'dashboard' && (
          <View>
            {ai && banner ? (
              <View style={{
                backgroundColor: banner.bg,
                borderWidth:     1,
                borderColor:     banner.border,
                borderRadius:    12,
                padding:         14,
                marginBottom:    16,
              }}>
                <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: banner.text, marginBottom: 4 }}>
                  AI ANALYSIS — {ai.alert_type?.toUpperCase()}
                </Text>
                <Text style={{ fontSize: 13, color: COLORS.text, lineHeight: 19 }}>{ai.summary}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginTop: 12 }}>
                  <View style={{ alignItems: 'center' }}>
                    <HealthRing score={ai.health_score} />
                    <Text style={{ fontSize: 11, color: COLORS.greenL, marginTop: 2 }}>Crop Health</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, color: COLORS.greenL }}>AI Confidence</Text>
                    <Text style={{ fontSize: 22, fontWeight: '800', color: COLORS.green }}>
                      {ai.confidence_percent}%
                    </Text>
                    <Text style={{ fontSize: 11, color: COLORS.greenL }}>
                      Re-check in {ai.next_check_hours}h
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}

            {/* Symbol Cards (2 columns on phone) */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              <SymbolCard
                symbol={ai?.weather?.symbol ?? '☀️'}
                label={ai?.weather?.label ?? 'Weather'}
                message={ai?.weather?.message ?? 'Run AI analysis'}
                loading={analyzing}
              />
              <SymbolCard
                symbol={ai?.irrigation?.symbol ?? '💧'}
                label={ai?.irrigation?.label ?? 'Irrigation'}
                message={ai?.irrigation?.message ?? 'Waiting...'}
                subtext={
                  ai?.irrigation?.urgency === 'high'
                    ? '⚡ URGENT'
                    : ai?.irrigation?.liters_per_sqm > 0
                      ? `${ai.irrigation.liters_per_sqm} L/m²`
                      : null
                }
                borderColor={ai?.irrigation?.urgency === 'high' ? '#60a5fa' : undefined}
                loading={analyzing}
              />
              <SymbolCard
                symbol={ai?.disease_risk?.symbol ?? '✅'}
                label={ai?.disease_risk?.label ?? 'Disease'}
                message={ai?.disease_risk?.prevention ?? 'No data yet'}
                subtext={ai?.disease_risk?.disease_name}
                borderColor={ai?.disease_risk?.risk_level === 'high' ? '#f87171' : undefined}
                loading={analyzing}
              />
              <SymbolCard
                symbol={ai?.soil?.symbol ?? '🌱'}
                label={ai?.soil?.label ?? 'Soil'}
                message={ai?.soil?.message ?? 'Run analysis'}
                subtext={ai?.soil?.ph_status ? `pH: ${ai.soil.ph_status}` : null}
                loading={analyzing}
              />
            </View>

            {/* Quick sensor tiles (3 per row) */}
            {s ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {[
                  { icon: '🌡️', val: `${s.temperature_celsius}°C`,   lbl: 'Temp'     },
                  { icon: '💦', val: `${s.humidity_percent}%`,        lbl: 'Humidity' },
                  { icon: '🌍', val: `${s.soil_moisture_percent}%`,   lbl: 'Soil'     },
                  { icon: '⚗️', val: `pH ${s.soil_ph}`,              lbl: 'pH'       },
                  { icon: '🌧️', val: `${s.rainfall_mm_24h}mm`,       lbl: 'Rain'     },
                  { icon: '💨', val: `${s.wind_speed_kmh}km/h`,       lbl: 'Wind'     },
                ].map(({ icon, val, lbl }) => (
                  <View key={lbl} style={{
                    flexBasis:         '31%',
                    flexGrow:          1,
                    backgroundColor:   COLORS.panelAlt,
                    borderWidth:       1,
                    borderColor:       'rgba(74,222,128,0.1)',
                    borderRadius:      10,
                    paddingVertical:   10,
                    paddingHorizontal: 6,
                    alignItems:        'center',
                  }}>
                    <Text style={{ fontSize: 18 }}>{icon}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.text, marginTop: 4 }}>{val}</Text>
                    <Text style={{ fontSize: 10, color: COLORS.greenL, opacity: 0.7 }}>{lbl}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Recommendations */}
            {ai?.recommendations?.length > 0 ? (
              <View style={{ marginBottom: 16 }}>
                <Text style={sectionLabel}>📌 Recommended Actions</Text>
                {ai.recommendations.map((rec, i) => <RecommendationItem key={i} rec={rec} />)}
              </View>
            ) : null}

            {/* SMS preview */}
            {ai?.sms_alert ? (
              <View style={{ marginBottom: 16 }}>
                <Text style={sectionLabel}>📱 SMS Alert Preview</Text>
                <View style={{ ...card, borderColor: 'rgba(96,165,250,0.3)' }}>
                  <Text style={{ fontSize: 11, color: COLORS.greenL, marginBottom: 8, opacity: 0.7 }}>
                    This message would be sent to farmers' phones:
                  </Text>
                  <View style={{
                    backgroundColor:        '#1a2f1a',
                    borderWidth:            1,
                    borderColor:            COLORS.borderS,
                    borderRadius:           16,
                    borderBottomLeftRadius: 4,
                    padding:                12,
                  }}>
                    <Text style={{ fontSize: 13, lineHeight: 20, color: COLORS.text }}>{ai.sms_alert}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, color: COLORS.greenL }}>
                      {ai.sms_alert.length}/160 characters
                    </Text>
                    <Pressable
                      onPress={() => {
                        setSmsLog(prev => [{
                          id:      Date.now(),
                          time:    new Date().toLocaleTimeString(),
                          message: ai.sms_alert,
                          type:    ai.alert_type,
                          village: sensorData?.location?.village ?? 'Unknown',
                          farmers: Math.round(5 + Math.random() * 15),
                        }, ...prev].slice(0, 8));
                        setActiveTab('sms');
                      }}
                      style={{
                        borderWidth:       1,
                        borderColor:       'rgba(74,222,128,0.3)',
                        borderRadius:      8,
                        paddingHorizontal: 10,
                        paddingVertical:   4,
                      }}>
                      <Text style={{ color: COLORS.greenL, fontSize: 11 }}>📤 Simulate Send</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ) : null}

            {!ai && !analyzing ? (
              <View style={{
                ...card,
                alignItems:      'center',
                paddingVertical: 40,
                borderStyle:     'dashed',
                borderColor:     COLORS.borderS,
              }}>
                <Text style={{ fontSize: 44, marginBottom: 10 }}>🤖</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 8 }}>
                  Ready to Analyze
                </Text>
                <Text style={{ fontSize: 12, color: COLORS.greenL, opacity: 0.8, textAlign: 'center', marginBottom: 16 }}>
                  ESP32 sensor data is loaded. Tap below to get crop{'\n'}
                  recommendations, disease warnings, and SMS alerts.
                </Text>
                <Pressable
                  onPress={() => runAnalysis(sensorData)}
                  style={{
                    backgroundColor:   'rgba(74,222,128,0.85)',
                    borderRadius:      8,
                    paddingHorizontal: 22,
                    paddingVertical:   10,
                  }}>
                  <Text style={{ color: '#052e16', fontWeight: '700', fontSize: 14 }}>
                    🤖 Analyze Sensor Data
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {analyzing ? (
              <View style={{ ...card, alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ fontSize: 44, marginBottom: 10 }}>⏳</Text>
                <Text style={{ fontSize: 14, color: COLORS.green, fontWeight: '700' }}>
                  AI is analyzing your crop data...
                </Text>
                <Text style={{ fontSize: 12, color: COLORS.greenL, marginTop: 6, opacity: 0.7 }}>
                  Checking temperature, soil, nutrients, disease risk...
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {/* ════════ SENSORS ════════ */}
        {activeTab === 'sensors' && (
          <View>
            {sensorData ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {[
                  { label: 'Device ID',   value: sensorData.device_id,                        icon: '📟' },
                  { label: 'Firmware',    value: sensorData.firmware_version,                 icon: '⚙️' },
                  { label: 'Field',       value: sensorData.location.field_id,                icon: '🗺️' },
                  { label: 'Altitude',    value: `${sensorData.location.altitude_m}m`,        icon: '⛰️' },
                  { label: 'Uptime',      value: `${sensorData.device_status.uptime_hours}h`, icon: '⏱️' },
                  { label: 'Calibration', value: sensorData.device_status.last_calibration,   icon: '📅' },
                ].map(({ label, value, icon }) => (
                  <View key={label} style={{
                    flexBasis:       '48%',
                    flexGrow:        1,
                    backgroundColor: COLORS.panelAlt,
                    borderWidth:     1,
                    borderColor:     'rgba(74,222,128,0.1)',
                    borderRadius:    10,
                    padding:         12,
                  }}>
                    <Text style={{ fontSize: 11, color: COLORS.greenL, opacity: 0.7 }}>{icon} {label}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.text, marginTop: 3 }}>
                      {value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={card}>
              <Text style={sectionLabel}>📡 Raw Sensor Readings</Text>
              <Text style={{ fontSize: 11, color: COLORS.greenL, marginBottom: 10, opacity: 0.7 }}>
                ✅ = normal range for {CONFIG.CROP_TYPE} · ⚠️ = outside optimal range
              </Text>
              {s ? Object.entries(s).map(([key, value]) => (
                <SensorRow key={key} sensorKey={key} value={value} />
              )) : null}
            </View>

            <View style={{ ...card, marginTop: 12 }}>
              <Text style={sectionLabel}>🔍 Full JSON Payload</Text>
              <ScrollView style={{ maxHeight: 320, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 8 }}>
                <Text style={{
                  fontSize:   11,
                  color:      COLORS.green,
                  lineHeight: 16,
                  padding:    12,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                }}>
                  {sensorData ? JSON.stringify(sensorData, null, 2) : 'Loading...'}
                </Text>
              </ScrollView>
            </View>
          </View>
        )}

        {/* ════════ SMS ════════ */}
        {activeTab === 'sms' && (
          <View>
            <View style={{ ...card, borderColor: 'rgba(96,165,250,0.3)', marginBottom: 16 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#93c5fd', marginBottom: 10 }}>
                📱 SMS & Voice Alert Integration
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[
                  { icon: '📨', title: 'Twilio SMS',      desc: 'Send texts to any Bhutan number. Works on all phones.' },
                  { icon: '📞', title: 'Automated Voice', desc: 'Twilio reads the alert aloud. Best for illiterate farmers.' },
                  { icon: '💬', title: 'WhatsApp API',    desc: 'WhatsApp Business API. Very common in Bhutan.' },
                  { icon: '📻', title: 'Community Radio', desc: 'Partner with BBS Radio for broadcast alerts.' },
                ].map(({ icon, title, desc }) => (
                  <View key={title} style={{
                    flexBasis:       '48%',
                    flexGrow:        1,
                    backgroundColor: 'rgba(96,165,250,0.06)',
                    borderRadius:    10,
                    padding:         12,
                  }}>
                    <Text style={{ fontSize: 18, marginBottom: 4 }}>{icon}</Text>
                    <Text style={{ fontWeight: '700', color: '#93c5fd', fontSize: 12, marginBottom: 4 }}>
                      {title}
                    </Text>
                    <Text style={{ color: '#bfdbfe', opacity: 0.85, fontSize: 11, lineHeight: 16 }}>
                      {desc}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <Text style={sectionLabel}>📋 Alert Log</Text>
            {smsLog.length === 0 ? (
              <View style={{ ...card, alignItems: 'center', paddingVertical: 40, borderStyle: 'dashed' }}>
                <Text style={{ fontSize: 36, marginBottom: 10 }}>📭</Text>
                <Text style={{ color: COLORS.greenL, fontSize: 14 }}>No SMS alerts yet.</Text>
                <Text style={{ color: COLORS.greenL, fontSize: 12, marginTop: 6, opacity: 0.7, textAlign: 'center' }}>
                  Run an AI analysis to generate the first alert.
                </Text>
              </View>
            ) : (
              smsLog.map(log => <SMSCard key={log.id} log={log} />)
            )}
          </View>
        )}

        {/* ════════ GUIDE ════════ */}
        {activeTab === 'guide' && <GuidePanel />}

        {/* FOOTER */}
        <View style={{
          alignItems:      'center',
          paddingVertical: 20,
          marginTop:       20,
          borderTopWidth:  1,
          borderTopColor:  'rgba(74,222,128,0.1)',
        }}>
          <Text style={{ fontSize: 11, color: COLORS.greenL, opacity: 0.5, textAlign: 'center' }}>
            Smart Crop AI · Bhutan Precision Agriculture{'\n'}
            ESP32 + Claude/Groq AI · Refresh every {CONFIG.SENSOR_REFRESH_MS / 1000}s
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
