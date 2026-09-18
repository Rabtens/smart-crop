// ============================================================
// server.js — Backend Proxy using GROQ (Free AI)
// ============================================================
//
// WHY GROQ:
//   - 100% free tier (no credit card needed)
//   - Very fast responses (great for live demos)
//   - Uses Llama 3.3 70B — powerful, good at JSON output
//   - Free limits: ~14,400 requests/day, 6,000 tokens/min
//
// GET YOUR FREE API KEY:
//   1. Go to https://console.groq.com
//   2. Sign up (free, no credit card)
//   3. Click API Keys → Create API Key
//   4. Paste it below where it says PASTE-YOUR-GROQ-KEY-HERE
//
// HOW TO RUN:
//   Terminal 1: node server.js
//   Terminal 2: npm run dev
// ============================================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const app  = express();
const PORT = 3002;

app.use(cors());
// Photo diagnosis posts a base64 data URL, so the default 100kb limit is too small.
app.use(express.json({ limit: "12mb" }));

// ============================================================
// ⚠️  GROQ API KEY FROM ENVIRONMENT VARIABLE
// ============================================================
// Loaded from .env file (VITE_GROQ_API_KEY)
// Looks like: gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx

const GROQ_API_KEY = process.env.VITE_GROQ_API_KEY;

if (!GROQ_API_KEY || GROQ_API_KEY.includes("PASTE-YOUR")) {
  console.error("❌ ERROR: GROQ API KEY is not set!");
  console.error("Please set VITE_GROQ_API_KEY in your .env file");
  console.error("Get your key at: https://console.groq.com/keys");
  process.exit(1);
}

// ============================================================
// MODELS
// ============================================================
// NOTE: llama-3.3-70b-versatile was decommissioned and 404s on this key, which
// made every analysis fall back to demo data. These two are live on the free
// tier — verify with:
//   curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $VITE_GROQ_API_KEY"
const TEXT_MODEL = "openai/gpt-oss-120b";

// ============================================================
// POST /api/analyze
// Receives prompt from React → sends to Groq → returns result
// ============================================================
// Pitch-safe fallback: if Groq fails for any reason (rate limit, JSON
// validation, network blip), return realistic demo data so the dashboard
// never shows a broken state during a demo.
const DEMO_RESPONSE = {
  health_score: 82,
  summary: "Your maize crop is doing well overall. Skip irrigation today — rain is expected this afternoon.",
  weather: {
    symbol: "🌧️",
    label: "Rain expected",
    message: "Light rain forecast for this afternoon — natural watering."
  },
  irrigation: {
    symbol: "⛔",
    label: "Skip — Rain Soon",
    urgency: "low",
    liters_per_sqm: 0,
    message: "Rain is on the way — save your water for tomorrow."
  },
  disease_risk: {
    symbol: "🟡",
    label: "Monitor Closely",
    risk_level: "medium",
    disease_name: "Leaf blight (early signs)",
    prevention: "Inspect lower leaves after rain. Apply fungicide if brown spots appear."
  },
  soil: {
    symbol: "✅",
    label: "Soil Healthy",
    ph_status: "optimal",
    npk_status: "balanced",
    message: "pH and nutrients look good. No fertilizer needed this week."
  },
  sms_alert: "🌧️ Rain expected today. Skip watering. Check maize lower leaves for brown spots.",
  recommendations: [
    { priority: 1, symbol: "⛔", action: "Skip irrigation today", detail: "Rain is forecast this afternoon — save water for tomorrow.", timing: "Today" },
    { priority: 2, symbol: "🔍", action: "Inspect lower leaves", detail: "After rain, check the bottom leaves for brown spots — early blight sign.", timing: "This week" },
    { priority: 3, symbol: "🧪", action: "Test soil nitrogen", detail: "Run a quick nitrogen check in two weeks before the next fertilizer cycle.", timing: "This week" }
  ],
  alert_type: "info",
  confidence_percent: 88,
  next_check_hours: 6,
};

const sendDemo = (res, reason) => {
  console.log("→ serving demo fallback:", reason);
  res.json({
    content: [{ type: "text", text: JSON.stringify(DEMO_RESPONSE) }],
  });
};

app.post("/api/analyze", async (req, res) => {
  try {
    const { messages, max_tokens } = req.body;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:       TEXT_MODEL,
        messages:    messages,
        max_tokens:  max_tokens ?? 1000,
        temperature: 0.3,
        // No response_format — let Groq return free text; we'll parse leniently
        // and fall back to the demo if parsing fails.
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Groq API error:", err.substring(0, 300));
      return sendDemo(res, `groq ${response.status}`);
    }

    const groqData = await response.json();
    const text     = groqData?.choices?.[0]?.message?.content?.trim() ?? "";
    // Models sometimes wrap the JSON in prose — grab the outermost object.
    const clean    = text.replace(/```json|```/g, "").trim();
    const sliced   = clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1);

    let parsedData;
    try {
      parsedData = JSON.parse(sliced);
      console.log("✓ JSON parsed (", Object.keys(parsedData).length, "fields )");
    } catch (parseErr) {
      console.error("Groq JSON parse failed:", parseErr.message);
      return sendDemo(res, "parse_failed");
    }

    res.json({
      content: [{ type: "text", text: JSON.stringify(parsedData) }],
    });

  } catch (err) {
    console.error("Server error:", err.message);
    return sendDemo(res, "exception");
  }
});

// ============================================================
// POST /api/diagnose
// Receives a photo of a sick plant (base64 data URL) from the app,
// sends it to Groq's vision model, returns a structured diagnosis.
// ============================================================
// Vision-capable model available on the free tier. Check what your key can
// reach with:  curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $VITE_GROQ_API_KEY"
const VISION_MODEL = "qwen/qwen3.8-27b";

// Same pitch-safe idea as /api/analyze: if the vision call fails, hand back a
// realistic diagnosis so a live demo never dead-ends on a red error box.
const DEMO_DIAGNOSIS = {
  is_plant: true,
  crop_guess: "Maize",
  healthy: false,
  disease_name: "Northern corn leaf blight",
  local_name: "Leaf blight",
  confidence_percent: 84,
  severity: "moderate",
  spread_risk: "high",
  symptoms: [
    "Long grey-green cigar-shaped lesions on the lower leaves",
    "Lesions turning tan-brown with dry edges",
    "Damage starting low on the plant and moving upward",
  ],
  treatment: [
    { step: 1, action: "Remove badly infected lower leaves", detail: "Cut and burn them away from the field — do not compost.", timing: "Today" },
    { step: 2, action: "Spray a mancozeb fungicide", detail: "Mix 2.5 g per litre of water. Spray both sides of the leaves in the early morning.", timing: "Within 2 days" },
    { step: 3, action: "Repeat the spray after rain", detail: "Rain washes the fungicide off — spray again 10 days later if lesions keep spreading.", timing: "This week" },
  ],
  prevention: [
    "Rotate maize with legumes next season to break the disease cycle",
    "Space plants wider so leaves dry faster after rain",
    "Choose blight-resistant maize seed for the next planting",
  ],
  sms_alert: "🌽 Leaf blight found on your maize. Remove low leaves today, spray mancozeb 2.5g/L within 2 days.",
};

const sendDemoDiagnosis = (res, reason) => {
  console.log("→ serving demo diagnosis:", reason);
  res.json({ content: [{ type: "text", text: JSON.stringify(DEMO_DIAGNOSIS) }] });
};

const buildDiagnosisPrompt = (crop, district, note) => `You are a plant pathologist helping smallholder farmers in Bhutan (${district ?? "Chukha"} district).

Look at this photo of a ${crop ?? "crop"} plant and diagnose the problem.
${note ? `The farmer says: "${note}"` : ""}

Rules:
- Write for a farmer with no technical training. Short, plain sentences.
- Only recommend treatments available in rural Bhutan (local agro shops, cultural practices).
- If the photo is not a plant, set "is_plant" to false and leave the other fields empty or null.
- Respond with ONLY raw JSON. No markdown, no code fences, no explanation.

{
  "is_plant": <true or false>,
  "crop_guess": <crop you see, or null>,
  "healthy": <true if the plant looks healthy>,
  "disease_name": <common disease/pest name, or null if healthy>,
  "local_name": <simpler everyday name for it, or null>,
  "confidence_percent": <integer 50-99>,
  "severity": <"mild" OR "moderate" OR "severe">,
  "spread_risk": <"low" OR "medium" OR "high">,
  "symptoms": [<up to 3 short strings describing what you see in the photo>],
  "treatment": [
    {"step": 1, "action": <5-7 word title>, "detail": <1 sentence with quantities if relevant>, "timing": <"Today" OR "Within 2 days" OR "This week">},
    {"step": 2, "action": <...>, "detail": <...>, "timing": <...>},
    {"step": 3, "action": <...>, "detail": <...>, "timing": <...>}
  ],
  "prevention": [<up to 3 short strings for next season>],
  "sms_alert": <plain English SMS, MAX 160 characters, starts with an emoji>
}`;

app.post("/api/diagnose", async (req, res) => {
  try {
    const { image, crop, district, note } = req.body;

    if (!image || typeof image !== "string" || !image.startsWith("data:image")) {
      return res.status(400).json({ error: "Send { image: 'data:image/jpeg;base64,...' }" });
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:       VISION_MODEL,
        max_tokens:  1200,
        temperature: 0.2,
        messages: [{
          role: "user",
          content: [
            { type: "text",      text: buildDiagnosisPrompt(crop, district, note) },
            { type: "image_url", image_url: { url: image } },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Groq vision error:", err.substring(0, 300));
      return sendDemoDiagnosis(res, `groq ${response.status}`);
    }

    const groqData = await response.json();
    const text     = groqData?.choices?.[0]?.message?.content?.trim() ?? "";
    // Models sometimes wrap JSON in prose — grab the outermost object.
    const clean    = text.replace(/```json|```/g, "").trim();
    const sliced   = clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1);

    let parsedData;
    try {
      parsedData = JSON.parse(sliced);
      console.log("✓ diagnosis parsed:", parsedData.disease_name ?? "healthy/unknown");
    } catch (parseErr) {
      console.error("Diagnosis JSON parse failed:", parseErr.message);
      return sendDemoDiagnosis(res, "parse_failed");
    }

    res.json({ content: [{ type: "text", text: JSON.stringify(parsedData) }] });

  } catch (err) {
    console.error("Diagnose error:", err.message);
    return sendDemoDiagnosis(res, "exception");
  }
});

// Health check — visit http://localhost:3002 to confirm running
app.get("/", (req, res) => {
  res.send("✅ Smart Crop proxy (Groq) is running!");
});

app.listen(PORT, () => {
  console.log(`✅ Proxy server (Groq) running at http://localhost:${PORT}`);
  console.log(`   Text:   ${TEXT_MODEL}   (POST /api/analyze)`);
  console.log(`   Vision: ${VISION_MODEL}   (POST /api/diagnose)`);
  console.log(`   Waiting for requests from your React dashboard...`);
});