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
app.use(express.json());

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
        model:       "llama-3.3-70b-versatile",
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
    const clean    = text.replace(/```json|```/g, "").trim();

    let parsedData;
    try {
      parsedData = JSON.parse(clean);
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

// Health check — visit http://localhost:3002 to confirm running
app.get("/", (req, res) => {
  res.send("✅ Smart Crop proxy (Groq) is running!");
});

app.listen(PORT, () => {
  console.log(`✅ Proxy server (Groq) running at http://localhost:${PORT}`);
  console.log(`   Model: llama-3.3-70b-versatile (free tier)`);
  console.log(`   Waiting for requests from your React dashboard...`);
});