import { Router } from "express";

const router: Router = Router();

/**
 * POST /api/verify-credentials
 * Body: { type: "xtream", host, username, password }
 * Hits the provider's player_api.php and checks auth === 1.
 * Returns { ok: true } or { ok: false, error: string }.
 */
router.post("/verify-credentials", async (req, res): Promise<void> => {
  const { type, host, username, password } = req.body ?? {};

  if (type !== "xtream") {
    // M3U can't be verified server-side without fetching the whole playlist
    res.json({ ok: true, skipped: true });
    return;
  }

  if (!host || !username || !password) {
    res.status(400).json({ ok: false, error: "host, username and password are required" });
    return;
  }

  // Normalise scheme to lowercase
  const normHost = (host as string)
    .replace(/^([a-zA-Z][a-zA-Z0-9+\-.]*):\/\//, (_: string, s: string) => `${s.toLowerCase()}://`)
    .replace(/\/+$/, "");

  const url = `${normHost}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const upstream = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!upstream.ok) {
      res.json({ ok: false, error: `Provider returned HTTP ${upstream.status}` });
      return;
    }

    const data = await upstream.json() as any;

    if (data?.user_info?.auth === 1 || data?.user_info?.auth === "1") {
      res.json({ ok: true });
    } else {
      res.json({ ok: false, error: "Invalid username or password" });
    }
  } catch (err: any) {
    if (err?.name === "AbortError") {
      res.json({ ok: false, error: "Provider timed out — check the host URL" });
    } else {
      res.json({ ok: false, error: "Could not reach provider — check the host URL" });
    }
  }
});

export default router;
