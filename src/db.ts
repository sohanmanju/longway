import {
  directionsForTrip,
  ridersToDropAfterSeatChange,
  type Direction,
  type RideOfferSummary,
  type RideRequest,
  type TripType,
} from "./carpool";
import type { AppBindings } from "./env";

type CarRow = {
  id: string;
  guild_id: string;
  owner_user_id: string;
  name: string;
  seats: number;
};

type CycleRow = {
  id: string;
  guild_id: string;
  channel_id: string;
  cycle_date: string;
  status: "open" | "closed";
  board_message_id: string | null;
};

type OfferRow = {
  id: string;
  cycle_id: string;
  car_id: string;
  owner_user_id: string;
  car_name: string;
  seats: number;
  trip_type: TripType;
  morning_time: string | null;
  return_time: string | null;
  status: "creating" | "active" | "cancelled" | "failed";
  thread_id: string | null;
  ride_card_message_id: string | null;
};

type RequestRow = {
  id: string;
  ride_offer_id: string;
  rider_user_id: string;
  direction: Direction;
  status: RideRequest["status"];
  queue_position: number;
  accepted_order: number | null;
};

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function istCycleDate(now = new Date()): string {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const getLocal = (type: string) => local.find((part) => part.type === type)?.value ?? "";
  const localDate = new Date(`${getLocal("year")}-${getLocal("month")}-${getLocal("day")}T00:00:00.000Z`);
  const hour = Number(getLocal("hour"));
  const weekday = getLocal("weekday");

  if (weekday === "Sat") {
    localDate.setUTCDate(localDate.getUTCDate() - 1);
  } else if (weekday === "Sun") {
    localDate.setUTCDate(localDate.getUTCDate() - 2);
  } else if (weekday === "Mon" && hour < 7) {
    localDate.setUTCDate(localDate.getUTCDate() - 3);
  } else if (hour < 18) {
    localDate.setUTCDate(localDate.getUTCDate() - 1);
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(localDate);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isOfferWindowOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun") return true;
  if (weekday === "Mon" && hour < 7) return true;
  return hour >= 18 || hour < 7;
}

export async function getOrCreateCycle(env: AppBindings, guildId: string, channelId: string, cycleDate = istCycleDate()): Promise<CycleRow> {
  const existing = await env.DB.prepare(
    "SELECT * FROM cycles WHERE guild_id = ? AND channel_id = ? AND cycle_date = ?",
  ).bind(guildId, channelId, cycleDate).first<CycleRow>();
  if (existing) return existing;

  const id = newId("cycle");
  const status = isOfferWindowOpen() ? "open" : "closed";
  await env.DB.prepare(
    "INSERT INTO cycles (id, guild_id, channel_id, cycle_date, status) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, guildId, channelId, cycleDate, status).run();
  return { id, guild_id: guildId, channel_id: channelId, cycle_date: cycleDate, status, board_message_id: null };
}

export async function getCycle(env: AppBindings, cycleId: string): Promise<CycleRow | null> {
  return env.DB.prepare("SELECT * FROM cycles WHERE id = ?").bind(cycleId).first<CycleRow>();
}

export async function setCycleBoardMessage(env: AppBindings, cycleId: string, messageId: string) {
  await env.DB.prepare("UPDATE cycles SET board_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(messageId, cycleId)
    .run();
}

export async function closeExpiredCycles(env: AppBindings, cycleDate = istCycleDate()) {
  await env.DB.prepare("UPDATE cycles SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE cycle_date < ? AND status = 'open'")
    .bind(cycleDate)
    .run();
}

export async function closeCurrentCycleIfWindowClosed(env: AppBindings, cycleDate = istCycleDate()) {
  if (isOfferWindowOpen()) return;
  await env.DB.prepare("UPDATE cycles SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE cycle_date = ? AND status = 'open'")
    .bind(cycleDate)
    .run();
}

export async function listCars(env: AppBindings, guildId: string, ownerUserId: string): Promise<CarRow[]> {
  const result = await env.DB.prepare("SELECT * FROM cars WHERE guild_id = ? AND owner_user_id = ? ORDER BY name")
    .bind(guildId, ownerUserId)
    .all<CarRow>();
  return result.results;
}

export async function getCar(env: AppBindings, carId: string): Promise<CarRow | null> {
  return env.DB.prepare("SELECT * FROM cars WHERE id = ?").bind(carId).first<CarRow>();
}

export async function getCarByName(env: AppBindings, guildId: string, ownerUserId: string, name: string): Promise<CarRow | null> {
  return env.DB.prepare("SELECT * FROM cars WHERE guild_id = ? AND owner_user_id = ? AND name_key = ?")
    .bind(guildId, ownerUserId, nameKey(name))
    .first<CarRow>();
}

export async function registerCar(env: AppBindings, guildId: string, ownerUserId: string, name: string, seats: number) {
  const id = newId("car");
  await env.DB.prepare(
    "INSERT INTO cars (id, guild_id, owner_user_id, name, name_key, seats) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, guildId, ownerUserId, name.trim(), nameKey(name), seats).run();
  return id;
}

export async function editCar(env: AppBindings, carId: string, ownerUserId: string, name: string | null, seats: number | null) {
  const car = await getCar(env, carId);
  if (!car || car.owner_user_id !== ownerUserId) throw new Error("Car not found.");
  const nextName = name?.trim() || car.name;
  const nextSeats = seats ?? car.seats;

  await env.DB.batch([
    env.DB.prepare("UPDATE cars SET name = ?, name_key = ?, seats = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(nextName, nameKey(nextName), nextSeats, carId),
    env.DB.prepare("UPDATE ride_offers SET car_name = ?, seats = ?, updated_at = CURRENT_TIMESTAMP WHERE car_id = ? AND status = 'active'")
      .bind(nextName, nextSeats, carId),
  ]);

  const activeOffers = await listActiveOffersForCar(env, carId);
  for (const offer of activeOffers) {
    await moveOverflowAcceptedToPending(env, offer.id, nextSeats);
  }
}

export async function deleteCar(env: AppBindings, carId: string, ownerUserId: string) {
  const active = await env.DB.prepare("SELECT id FROM ride_offers WHERE car_id = ? AND owner_user_id = ? AND status = 'active' LIMIT 1")
    .bind(carId, ownerUserId)
    .first<{ id: string }>();
  if (active) throw new Error("Cancel active ride offers before deleting this car.");
  await env.DB.prepare("DELETE FROM cars WHERE id = ? AND owner_user_id = ?").bind(carId, ownerUserId).run();
}

export async function hasActiveOffer(env: AppBindings, cycleId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM ride_offers WHERE cycle_id = ? AND owner_user_id = ? AND status IN ('creating', 'active') LIMIT 1")
    .bind(cycleId, userId)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function hasActiveClaims(env: AppBindings, cycleId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM ride_requests WHERE cycle_id = ? AND rider_user_id = ? AND status IN ('pending', 'accepted') LIMIT 1")
    .bind(cycleId, userId)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function createOffer(env: AppBindings, params: {
  id?: string;
  cycleId: string;
  car: CarRow;
  ownerUserId: string;
  tripType: TripType;
  morningTime: string | null;
  returnTime: string | null;
  threadId?: string | null;
  rideCardMessageId?: string | null;
}) {
  const id = params.id ?? newId("offer");
  await env.DB.prepare(
    `INSERT INTO ride_offers
      (id, cycle_id, car_id, owner_user_id, car_name, seats, trip_type, morning_time, return_time, status, thread_id, ride_card_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?)`,
  ).bind(
    id,
    params.cycleId,
    params.car.id,
    params.ownerUserId,
    params.car.name,
    params.car.seats,
    params.tripType,
    params.morningTime,
    params.returnTime,
    params.threadId ?? null,
    params.rideCardMessageId ?? null,
  ).run();
  return id;
}

export async function activateOffer(env: AppBindings, offerId: string, threadId: string, rideCardMessageId: string) {
  await env.DB.prepare(
    "UPDATE ride_offers SET status = 'active', thread_id = ?, ride_card_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'creating'",
  ).bind(threadId, rideCardMessageId, offerId).run();
}

export async function failCreatingOffer(env: AppBindings, offerId: string) {
  await env.DB.prepare("UPDATE ride_offers SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('creating', 'active')")
    .bind(offerId)
    .run();
}

export async function listCycleOffers(env: AppBindings, cycleId: string): Promise<RideOfferSummary[]> {
  const offers = await env.DB.prepare("SELECT * FROM ride_offers WHERE cycle_id = ? AND status IN ('active', 'cancelled') ORDER BY created_at")
    .bind(cycleId)
    .all<OfferRow>();
  return hydrateOffers(env, offers.results);
}

export async function getOfferSummary(env: AppBindings, offerId: string): Promise<RideOfferSummary | null> {
  const offer = await env.DB.prepare("SELECT * FROM ride_offers WHERE id = ? AND status IN ('active', 'cancelled')").bind(offerId).first<OfferRow>();
  if (!offer) return null;
  const [summary] = await hydrateOffers(env, [offer]);
  return summary;
}

export async function addRequests(env: AppBindings, cycleId: string, offerId: string, riderUserId: string, directions: Direction[]) {
  const maxQueue = await env.DB.prepare("SELECT COALESCE(MAX(queue_position), 0) AS value FROM ride_requests WHERE ride_offer_id = ?")
    .bind(offerId)
    .first<{ value: number }>();
  const statements = directions.map((direction, index) => env.DB.prepare(
    "INSERT INTO ride_requests (id, cycle_id, ride_offer_id, rider_user_id, direction, status, queue_position) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
  ).bind(newId("request"), cycleId, offerId, riderUserId, direction, (maxQueue?.value ?? 0) + index + 1));
  await env.DB.batch(statements);
}

export async function cancelUserRequestsForOffer(env: AppBindings, offerId: string, userId: string) {
  await env.DB.prepare(
    "UPDATE ride_requests SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE ride_offer_id = ? AND rider_user_id = ? AND status IN ('pending', 'accepted')",
  ).bind(offerId, userId).run();
}

export async function cancelOffer(env: AppBindings, offerId: string, ownerUserId: string) {
  await env.DB.batch([
    env.DB.prepare("UPDATE ride_offers SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_user_id = ?")
      .bind(offerId, ownerUserId),
    env.DB.prepare("UPDATE ride_requests SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE ride_offer_id = ? AND status IN ('pending', 'accepted')")
      .bind(offerId),
  ]);
}

export async function manageOfferRequest(env: AppBindings, offerId: string, requestId: string, ownerUserId: string, action: "accept" | "reject") {
  if (action === "reject") {
    const result = await env.DB.prepare(
      `UPDATE ride_requests
       SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND ride_offer_id = ?
         AND status = 'pending'
         AND EXISTS (SELECT 1 FROM ride_offers WHERE id = ? AND owner_user_id = ?)`,
    ).bind(requestId, offerId, offerId, ownerUserId).run();
    if ((result.meta.changes ?? 0) === 0) throw new Error("Request not found.");
    return;
  }

  const result = await env.DB.prepare(
    `UPDATE ride_requests
     SET status = 'accepted',
         accepted_order = (SELECT COALESCE(MAX(accepted_order), 0) + 1 FROM ride_requests WHERE ride_offer_id = ?),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND ride_offer_id = ?
       AND status = 'pending'
       AND EXISTS (SELECT 1 FROM ride_offers WHERE id = ? AND owner_user_id = ? AND status = 'active')
       AND (
         SELECT COUNT(*)
         FROM ride_requests accepted
         WHERE accepted.ride_offer_id = ?
           AND accepted.direction = (SELECT direction FROM ride_requests WHERE id = ?)
           AND accepted.status = 'accepted'
       ) < (SELECT seats FROM ride_offers WHERE id = ?)`,
  ).bind(offerId, requestId, offerId, offerId, ownerUserId, offerId, requestId, offerId).run();
  if ((result.meta.changes ?? 0) === 0) throw new Error("Request not found or no seats left for that direction.");
}

async function listActiveOffersForCar(env: AppBindings, carId: string): Promise<OfferRow[]> {
  const result = await env.DB.prepare("SELECT * FROM ride_offers WHERE car_id = ? AND status = 'active'").bind(carId).all<OfferRow>();
  return result.results;
}

export async function listActiveOfferIdsForCar(env: AppBindings, carId: string): Promise<string[]> {
  const result = await env.DB.prepare("SELECT id FROM ride_offers WHERE car_id = ? AND status = 'active'").bind(carId).all<{ id: string }>();
  return result.results.map((row) => row.id);
}

async function moveOverflowAcceptedToPending(env: AppBindings, offerId: string, newSeats: number) {
  const offer = await getOfferSummary(env, offerId);
  if (!offer) return;

  for (const direction of directionsForTrip(offer.tripType)) {
    const drops = ridersToDropAfterSeatChange(offer.requests, direction, newSeats);
    if (drops.length === 0) continue;
    const minPending = await env.DB.prepare(
      "SELECT COALESCE(MIN(queue_position), 1) AS value FROM ride_requests WHERE ride_offer_id = ? AND direction = ? AND status = 'pending'",
    ).bind(offerId, direction).first<{ value: number }>();

    const statements = drops.map((request, index) => env.DB.prepare(
      "UPDATE ride_requests SET status = 'pending', accepted_order = NULL, queue_position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind((minPending?.value ?? 1) - drops.length + index, request.id));
    await env.DB.batch(statements);
  }
}

async function hydrateOffers(env: AppBindings, rows: OfferRow[]): Promise<RideOfferSummary[]> {
  if (rows.length === 0) return [];
  const offerIds = rows.map((offer) => offer.id);
  const placeholders = offerIds.map(() => "?").join(",");
  const requests = await env.DB.prepare(`SELECT * FROM ride_requests WHERE ride_offer_id IN (${placeholders}) ORDER BY queue_position`)
    .bind(...offerIds)
    .all<RequestRow>();
  const byOffer = new Map<string, RideRequest[]>();
  for (const request of requests.results) {
    const list = byOffer.get(request.ride_offer_id) ?? [];
    list.push({
      id: request.id,
      riderUserId: request.rider_user_id,
      direction: request.direction,
      status: request.status,
      queuePosition: request.queue_position,
      acceptedOrder: request.accepted_order,
    });
    byOffer.set(request.ride_offer_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    cycleId: row.cycle_id,
    ownerUserId: row.owner_user_id,
    carName: row.car_name,
    seats: row.seats,
    tripType: row.trip_type,
    morningTime: row.morning_time,
    returnTime: row.return_time,
    status: row.status === "cancelled" ? "cancelled" : "active",
    threadId: row.thread_id,
    requests: byOffer.get(row.id) ?? [],
  }));
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}
