import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, devicesTable } from "@workspace/db";

const router: Router = Router();

router.get("/activate", async (req, res): Promise<void> => {
  const mac = (req.query.mac as string)?.toUpperCase();
  if (!mac) {
    res.status(400).json({ error: "mac query parameter is required" });
    return;
  }

  const [device] = await db
    .select()
    .from(devicesTable)
    .where(eq(devicesTable.macAddress, mac));

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
  });
});

export default router;
