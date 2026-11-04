import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDecartClient } from "@decartai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8788;
const MODEL = process.env.DECART_MODEL || "lucy-vton-latest";

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

/** Health / setup probe. Never returns the key itself. */
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    model: MODEL,
    keyConfigured: Boolean(process.env.DECART_API_KEY),
  });
});

/**
 * Mint a short-lived Decart client token for the browser.
 * Key priority:
 *   1) key supplied in the request body (user pastes their own key in the UI —
 *      used for the published "bring your own key" mode)
 *   2) DECART_API_KEY from the environment (local/dev / server-configured)
 * The permanent key never reaches the browser; only a 60s client token does.
 */
app.post("/api/realtime-token", async (req, res) => {
  const bodyKey = req.body && typeof req.body.apiKey === "string" ? req.body.apiKey.trim() : "";
  const key = bodyKey || process.env.DECART_API_KEY || "";

  if (!key) {
    return res.status(424).json({
      error: "NO_API_KEY",
      message:
        "未配置 Decart API Key。请点右上角「设置」粘贴你的 key（platform.decart.ai 获取），或在 .env 写入 DECART_API_KEY=...",
    });
  }

  try {
    const client = createDecartClient({ apiKey: key });
    const origin = req.headers.origin;
    const opts = {
      allowedModels: [MODEL],
      expiresIn: 60,
    };
    // Defense-in-depth: bind the token to the page origin when the browser sends one.
    if (origin && /^https?:\/\//.test(origin)) opts.allowedOrigins = [origin];

    const { apiKey } = await client.tokens.create(opts);
    res.set("Cache-Control", "no-store");
    res.json({ apiKey, model: MODEL });
  } catch (e) {
    console.error("[token] mint failed:", e?.message || e);
    res.status(502).json({
      error: "TOKEN_MINT_FAILED",
      message: e?.message || String(e),
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  const hasKey = Boolean(process.env.DECART_API_KEY);
  console.log(`Cleanfit · Decart VTON listening on http://0.0.0.0:${PORT}`);
  console.log(`  model: ${MODEL}`);
  console.log(`  env key: ${hasKey ? "configured" : "MISSING (paste key in UI or set DECART_API_KEY)"}`);
});
