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
        model:           "llama-3.3-70b-versatile",
        messages:        messages,
        max_tokens:      max_tokens ?? 1000,
        temperature:     0.3,
        // JSON mode: forces the model to emit syntactically valid JSON.
        // Without this, llama-3.3 frequently returns unquoted string values.
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Groq API error:", err);
      return res.status(response.status).json({ error: err });
    }

    const groqData     = await response.json();
    const responseText = groqData.choices[0].message.content.trim();

    let parsedData;
    try {
      parsedData = JSON.parse(responseText);
      console.log("✓ JSON parsed (", Object.keys(parsedData).length, "fields )");
    } catch (parseErr) {
      console.error("❌ Groq returned unparseable JSON even with json_object mode:");
      console.error(parseErr.message);
      console.error("Raw response (first 500 chars):", responseText.substring(0, 500));
      return res.status(502).json({
        error: "AI returned malformed JSON",
        detail: parseErr.message,
        raw: responseText.substring(0, 500),
      });
    }

    res.json({
      content: [{
        type: "text",
        text: JSON.stringify(parsedData),
      }],
    });

  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({ error: err.message });
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