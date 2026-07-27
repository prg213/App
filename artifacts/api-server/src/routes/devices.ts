import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { db, devicesTable } from "@workspace/db";

const router: Router = Router();

function requireAuth(req: any, res: any, next: any) {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}

function formatDevice(d: typeof devicesTable.$inferSelect) {
  return {
    id: d.id,
    mac_address: d.macAddress,
    name: d.name ?? null,
    type: d.type ?? null,
    host: d.host ?? null,
    username: d.username ?? null,
    password: d.password ?? null,
    m3u_url: d.m3uUrl ?? null,
    created_at: d.createdAt.toISOString(),
  };
}

router.get("/devices", requireAuth, async (req: any, res): Promise<void> => {
  const devices = await db
    .select()
    .from(devicesTable)
    .where(eq(devicesTable.userId, req.userId))
    .orderBy(devicesTable.createdAt);
  res.json(devices.map(formatDevice));
});

router.post("/devices", requireAuth, async (req: any, res): Promise<void> => {
  const { mac_address, name, type, host, username, password, m3u_url } =
    req.body;

  if (!mac_address || !type) {
    res.status(400).json({ error: "mac_address and type are required" });
    return;
  }

  const [device] = await db
    .insert(devicesTable)
    .values({
      userId: req.userId,
      macAddress: (mac_address as string).toUpperCase(),
      name: name ?? null,
      type,
      host: host ?? null,
      username: username ?? null,
      password: password ?? null,
      m3uUrl: m3u_url ?? null,
    })
    .returning();

  res.status(201).json(formatDevice(device));
});

router.delete("/devices/:id", requireAuth, async (req: any, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db
    .delete(devicesTable)
    .where(and(eq(devicesTable.id, id), eq(devicesTable.userId, req.userId)));
  res.sendStatus(204);
});

export default router;
