import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const devicesTable = pgTable("devices", {
  id: serial("id").primaryKey(),
  macAddress: text("mac_address").notNull().unique(),
  name: text("name"),
  type: text("type"), // 'xtream' | 'm3u'
  host: text("host"),
  username: text("username"),
  password: text("password"),
  m3uUrl: text("m3u_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertDeviceSchema = createInsertSchema(devicesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateDeviceSchema = insertDeviceSchema.partial().omit({
  macAddress: true,
});

export type InsertDevice = z.infer<typeof insertDeviceSchema>;
export type UpdateDevice = z.infer<typeof updateDeviceSchema>;
export type Device = typeof devicesTable.$inferSelect;
