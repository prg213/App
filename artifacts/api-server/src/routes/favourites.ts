import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, favouritesTable, devicesTable } from "@workspace/db";

const router: Router = Router();

/**
 * Resolve the owner key for a MAC address.
 *
 * For a registered device that has a Clerk userId, return the userId so all
 * devices belonging to the same account converge on one favourites record.
 *
 * For unregistered devices (no row in devices, or no userId set), fall back
 * to the uppercased MAC address so per-device persistence still works.
 */
async function resolveOwnerKey(mac: string): Promise<string> {
  const upper = mac.toUpperCase();
  const [device] = await db
    .select({ userId: devicesTable.userId })
    .from(devicesTable)
    .where(eq(devicesTable.macAddress, upper));

  return device?.userId ?? upper;
}

/**
 * GET /api/favourites?mac=XX:XX:XX:XX:XX:XX
 * Returns all three categories of stored favourites for the account/device.
 */
router.get("/favourites", async (req, res): Promise<void> => {
  const mac = req.query.mac as string | undefined;
  if (!mac) {
    res.status(400).json({ error: "mac query parameter is required" });
    return;
  }

  const ownerKey = await resolveOwnerKey(mac);
  const [row] = await db
    .select()
    .from(favouritesTable)
    .where(eq(favouritesTable.ownerKey, ownerKey));

  res.json({
    channels: row?.channels ?? [],
    movies: row?.movies ?? [],
    series: row?.series ?? [],
  });
});

/**
 * PATCH /api/favourites/:kind
 * kind = "channels" | "movies" | "series"
 * Body: { mac, items: [...] }
 *
 * Updates only the specified category for the account/device.  The other two
 * categories are left untouched on the server, preventing one device from
 * inadvertently clobbering favourites set by another device for a different
 * category.
 */
router.patch("/favourites/:kind", async (req, res): Promise<void> => {
  const kind = req.params.kind as string;
  if (!["channels", "movies", "series"].includes(kind)) {
    res.status(400).json({ error: "kind must be channels, movies, or series" });
    return;
  }

  const { mac, items } = req.body as { mac?: string; items?: object[] };
  if (!mac) {
    res.status(400).json({ error: "mac is required" });
    return;
  }
  if (!Array.isArray(items)) {
    res.status(400).json({ error: "items must be an array" });
    return;
  }

  const ownerKey = await resolveOwnerKey(mac);

  // Upsert row, updating only the requested category column.
  const colUpdate: Record<string, object[]> = { [kind]: items };

  await db
    .insert(favouritesTable)
    .values({
      ownerKey,
      channels: kind === "channels" ? items : [],
      movies: kind === "movies" ? items : [],
      series: kind === "series" ? items : [],
    })
    .onConflictDoUpdate({
      target: favouritesTable.ownerKey,
      set: {
        ...colUpdate,
        updatedAt: new Date(),
      },
    });

  res.sendStatus(204);
});

export default router;
