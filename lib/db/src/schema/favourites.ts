import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Stores favourites keyed by owner identity.
 *
 * ownerKey is the Clerk userId when the device is registered to an account,
 * otherwise the device MAC address (fallback for unregistered devices).
 * Using userId means all devices that belong to the same account share one
 * record, which is the cross-device sync behaviour we want.
 */
export const favouritesTable = pgTable("favourites", {
  ownerKey: text("owner_key").primaryKey(),
  channels: jsonb("channels").$type<object[]>().notNull().default([]),
  movies: jsonb("movies").$type<object[]>().notNull().default([]),
  series: jsonb("series").$type<object[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Favourites = typeof favouritesTable.$inferSelect;
