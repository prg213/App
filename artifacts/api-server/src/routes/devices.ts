import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, devicesTable } from "@workspace/db";

const router: Router = Router();

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

router.get("/devices", async (req, res): Promise<void> => {
  const devices = await db
    .select()
    .from(devicesTable)
    .orderBy(devicesTable.createdAt);
  res.json(devices.map(formatDevice));
});

router.post("/devices", async (req, res): Promise<void> => {
  const { mac_address, name, type, host, username, password, m3u_url } =
    req.body;

  if (!mac_address || !type) {
    res
      .status(400)
      .json({ error: "mac_address and type are required" });
    return;
  }

  const [device] = await db
    .insert(devicesTable)
    .values({
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

router.put("/devices/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id)
    ? req.params.id[0]
    : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { name, type, host, username, password, m3u_url } = req.body;

  const updateData: Partial<typeof devicesTable.$inferInsert> = {};
  if (name !== undefined) updateData.name = name;
  if (type !== undefined) updateData.type = type;
  if (host !== undefined) updateData.host = host;
  if (username !== undefined) updateData.username = username;
  if (password !== undefined) updateData.password = password;
  if (m3u_url !== undefined) updateData.m3uUrl = m3u_url;

  const [device] = await db
    .update(devicesTable)
    .set(updateData)
    .where(eq(devicesTable.id, id))
    .returning();

  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }

  res.json(formatDevice(device));
});

router.delete("/devices/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id)
    ? req.params.id[0]
    : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db.delete(devicesTable).where(eq(devicesTable.id, id));
  res.sendStatus(204);
});

export default router;
