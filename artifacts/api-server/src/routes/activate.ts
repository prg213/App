import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, devicesTable } from "@workspace/db";

const router: Router = Router();

router.get("/activate", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const mac = (req.query.mac as string)?.toUpperCase();

  console.log(`[activate] mac=${mac ?? "(missing)"}`);

  if (!mac) {
    res.status(400).json({ error: "mac query parameter is required" });
    return;
  }

  const [device] = await db
    .select()
    .from(devicesTable)
    .where(eq(devicesTable.macAddress, mac));

  const result = device?.type ? "active" : "pending";
  console.log(`[activate] mac=${mac} → ${result}`);

  if (!device || !device.type) {
    res.json({ status: "pending" });
    return;
  }

  res.json({
    status: "active",
    type: device.type,
    host: device.host ?? null,
    username: device.username ?? null,
    password: device.password ?? null,
    m3u_url: device.m3uUrl ?? null,
    telegram_channel: device.telegramChannel ?? null,
  });
});

export default router;
