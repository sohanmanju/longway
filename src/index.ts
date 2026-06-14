import { Hono } from "hono";
import { InteractionResponseType, InteractionType, verifyKey } from "discord-interactions";
import { canRequestDirections, claimedDirectionsForUser, directionsForTrip, renderBoard, renderRideCard, type Direction, type TripType } from "./carpool";
import {
  addRequests,
  activateOffer,
  closeCurrentCycleIfWindowClosed,
  cancelOffer,
  cancelUserRequestsForOffer,
  closeExpiredCycles,
  createOffer,
  deleteCar,
  editCar,
  failCreatingOffer,
  getCar,
  getCarByName,
  getCycle,
  getOfferSummary,
  getOrCreateCycle,
  hasActiveClaims,
  hasActiveOffer,
  isOfferWindowOpen,
  listCars,
  listActiveOfferIdsForCar,
  listCycleOffers,
  manageOfferRequest,
  newId,
  registerCar,
  setCycleBoardMessage,
} from "./db";
import {
  boardComponents,
  createChannelMessage,
  createPublicThread,
  CUSTOM_IDS,
  deferredEphemeral,
  discordFetch,
  editChannelMessage,
  editWebhookMessage,
  ephemeral,
  messageWithComponents,
  modal,
  postThreadMessage,
  renameThread,
  rideCardComponents,
  selectMenu,
  textInput,
} from "./discord";
import type { AppBindings } from "./env";

type AppVariables = { Bindings: AppBindings };

type DiscordInteraction = {
  id: string;
  token: string;
  type: number;
  guild_id?: string;
  channel_id?: string;
  channel?: { id: string; parent_id?: string | null };
  member?: { user?: { id: string }; permissions?: string };
  user?: { id: string };
  data?: {
    name?: string;
    custom_id?: string;
    options?: Array<{ name: string; value: string | number }>;
    values?: string[];
    components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }>;
  };
};

const app = new Hono<AppVariables>();

app.get("/health", (c) => c.text("ok"));

app.post("/interactions", async (c) => {
  const signature = c.req.header("X-Signature-Ed25519");
  const timestamp = c.req.header("X-Signature-Timestamp");
  const rawBody = await c.req.text();
  if (!signature || !timestamp || !(await verifyKey(rawBody, signature, timestamp, c.env.DISCORD_PUBLIC_KEY))) {
    return c.text("invalid request signature", 401);
  }

  const interaction = JSON.parse(rawBody) as DiscordInteraction;
  if (interaction.type === InteractionType.PING) {
    return c.json({ type: InteractionResponseType.PONG });
  }

  if (!isConfiguredChannel(c.env, interaction)) {
    return c.json(ephemeral("Use Longway only in the configured carpool channel or its ride threads."));
  }

  try {
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      return c.json(await handleCommand(c.env, interaction));
    }
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      if (shouldDeferComponent(interaction)) {
        c.executionCtx.waitUntil(handleDeferredComponent(c.env, interaction));
        return c.json(deferredEphemeral());
      }
      return c.json(await handleComponent(c.env, interaction));
    }
    if (interaction.type === InteractionType.MODAL_SUBMIT) {
      c.executionCtx.waitUntil(handleModalSubmit(c.env, interaction).catch(async (error: unknown) => {
        console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        await editWebhookMessage(c.env, interaction.token, error instanceof Error ? error.message : "Something went wrong.");
      }));
      return c.json(deferredEphemeral());
    }
    return c.json(ephemeral("Unsupported interaction."));
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    return c.json(ephemeral(error instanceof Error ? error.message : "Something went wrong."));
  }
});

async function handleDeferredComponent(env: AppBindings, interaction: DiscordInteraction) {
  try {
    const response = await handleComponent(env, interaction);
    const content = responseContent(response) ?? "Done.";
    await editWebhookMessage(env, interaction.token, content);
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    await editWebhookMessage(env, interaction.token, error instanceof Error ? error.message : "Something went wrong.");
  }
}

function responseContent(response: unknown): string | null {
  if (!response || typeof response !== "object" || !("data" in response)) return null;
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== "object" || !("content" in data)) return null;
  const content = (data as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function shouldDeferComponent(interaction: DiscordInteraction): boolean {
  const customId = interaction.data?.custom_id ?? "";
  return customId.startsWith("manage_action:")
    || customId.startsWith("request_direction:")
    || customId.startsWith("cancel_mine:")
    || customId.startsWith("cancel_ride:");
}

async function handleCommand(env: AppBindings, interaction: DiscordInteraction) {
  const commandName = interaction.data?.name;
  const guildId = requireGuild(interaction);
  const userId = requireUser(interaction);

  if (commandName === "register-car") {
    const name = stringOption(interaction, "name");
    const seats = numberOption(interaction, "seats");
    if (!name || !seats) return ephemeral("Provide car name and passenger seats.");
    await registerCar(env, guildId, userId, name, seats);
    return ephemeral(`Registered ${name} with ${seats} passenger seats.`);
  }

  if (commandName === "edit-car") {
    const carName = stringOption(interaction, "car");
    if (!carName) return ephemeral("Provide the car name to edit.");
    const car = await getCarByName(env, guildId, userId, carName);
    if (!car) return ephemeral("Car not found.");
    await editCar(env, car.id, userId, stringOption(interaction, "name"), optionalNumberOption(interaction, "seats"));
    for (const offerId of await listActiveOfferIdsForCar(env, car.id)) {
      await safeRefreshOfferAndBoard(env, guildId, offerId);
    }
    await safeRefreshCurrentBoard(env, guildId);
    const updatedCar = await getCar(env, car.id);
    if (updatedCar) await renameActiveThreadsForCar(env, car.id, updatedCar.name);
    return ephemeral("Car updated. Active offers were refreshed too.");
  }

  if (commandName === "delete-car") {
    const carName = stringOption(interaction, "car");
    if (!carName) return ephemeral("Provide the car name to delete.");
    const car = await getCarByName(env, guildId, userId, carName);
    if (!car) return ephemeral("Car not found.");
    await deleteCar(env, car.id, userId);
    return ephemeral("Car deleted.");
  }

  if (commandName === "start-board") {
    if (!hasAdminPermission(interaction)) return ephemeral("Only server/channel admins can start the board manually.");
    const cycle = await ensureDailyBoard(env, guildId);
    return ephemeral(cycle.board_message_id ? `Board is ready: https://discord.com/channels/${guildId}/${env.CARPOOL_CHANNEL_ID}/${cycle.board_message_id}` : "Board created.");
  }

  return ephemeral("Unknown command.");
}

async function handleComponent(env: AppBindings, interaction: DiscordInteraction) {
  const customId = interaction.data?.custom_id ?? "";
  const guildId = requireGuild(interaction);
  const userId = requireUser(interaction);
  const cycle = await getOrCreateCycle(env, guildId, env.CARPOOL_CHANNEL_ID);

  if (customId === CUSTOM_IDS.offerRide) {
    if (cycle.status !== "open" || !isOfferWindowOpen()) return ephemeral("Today’s board is closed for new ride offers.");
    if (await hasActiveOffer(env, cycle.id, userId)) return ephemeral("You already offered a ride for this cycle.");
    if (await hasActiveClaims(env, cycle.id, userId)) return ephemeral("Cancel existing ride requests/seats before offering your car.");
    const cars = await listCars(env, guildId, userId);
    if (cars.length === 0) return ephemeral("Register a car first with /register-car.");
    if (cars.length === 1) return offerModal(cars[0].id);
    return messageWithComponents("Choose which car to offer.", selectMenu(CUSTOM_IDS.offerCarSelect, "Choose car", cars.map((car) => ({ label: car.name, value: car.id, description: `${car.seats} passenger seats` }))));
  }

  if (customId === CUSTOM_IDS.offerCarSelect) {
    const carId = interaction.data?.values?.[0];
    if (!carId) return ephemeral("Choose a car.");
    return offerModal(carId);
  }

  if (customId.startsWith("request_seat:")) {
    if (cycle.status !== "open" || !isOfferWindowOpen()) return ephemeral("Today’s board is closed for new ride requests.");
    const offerId = customId.split(":")[1];
    const offer = await getOfferSummary(env, offerId);
    if (!offer || offer.status !== "active") return ephemeral("Ride is not active.");
    if (offer.ownerUserId === userId) return ephemeral("Drivers cannot request seats in their own ride.");
    if (await hasActiveOffer(env, cycle.id, userId)) return ephemeral("Drivers cannot request rides in the same cycle.");
    const directions = directionsForTrip(offer.tripType);
    if (directions.length === 1) {
      await requestDirections(env, interaction, cycle.id, offerId, userId, directions);
      return ephemeral("Request added.");
    }
    return messageWithComponents("Which direction do you need?", selectMenu(CUSTOM_IDS.requestDirectionSelect(offerId), "Choose direction", [
      { label: "Morning only", value: "morning" },
      { label: "Return only", value: "return" },
      { label: "Both ways", value: "both" },
    ]));
  }

  if (customId.startsWith("request_direction:")) {
    const offerId = customId.split(":")[1];
    const value = interaction.data?.values?.[0];
    const directions: Direction[] = value === "both" ? ["morning", "return"] : [value as Direction];
    await requestDirections(env, interaction, cycle.id, offerId, userId, directions);
    return ephemeral("Request added.");
  }

  if (customId.startsWith("cancel_mine:")) {
    const offerId = customId.split(":")[1];
    const offer = await getOfferSummary(env, offerId);
    if (!offer) return ephemeral("Ride not found.");
    if (offer.cycleId !== cycle.id) return ephemeral("This ride belongs to a different carpool cycle.");
    await cancelUserRequestsForOffer(env, offerId, userId);
    await safeRefreshOfferAndBoard(env, guildId, offerId);
    return ephemeral("Your request/seat was cancelled.");
  }

  if (customId.startsWith("manage_requests:")) {
    const offerId = customId.split(":")[1];
    const offer = await getOfferSummary(env, offerId);
    if (!offer || offer.ownerUserId !== userId) return ephemeral("Only the driver can manage requests.");
    if (offer.cycleId !== cycle.id) return ephemeral("This ride belongs to a different carpool cycle.");
    const pending = offer.requests.filter((request) => request.status === "pending").sort((a, b) => a.queuePosition - b.queuePosition);
    if (pending.length === 0) return ephemeral("No pending requests.");
    const names = await displayNamesForUsers(env, guildId, pending.map((request) => request.riderUserId));
    const options = pending.flatMap((request) => {
      const name = names.get(request.riderUserId) ?? request.riderUserId;
      return [
        { label: truncateOptionLabel(`Accept ${request.direction} - ${name}`), value: `accept:${request.id}` },
        { label: truncateOptionLabel(`Reject ${request.direction} - ${name}`), value: `reject:${request.id}` },
      ];
    });
    return messageWithComponents("Manage pending requests in FCFS order. You may skip if needed.", selectMenu(CUSTOM_IDS.manageActionSelect(offerId), "Choose action", options));
  }

  if (customId.startsWith("manage_action:")) {
    const offerId = customId.split(":")[1];
    const [action, requestId] = interaction.data?.values?.[0]?.split(":") ?? [];
    if ((action !== "accept" && action !== "reject") || !requestId) return ephemeral("Choose a valid action.");
    const offer = await getOfferSummary(env, offerId);
    if (!offer || offer.ownerUserId !== userId) return ephemeral("Only the driver can manage requests.");
    if (offer.cycleId !== cycle.id) return ephemeral("This ride belongs to a different carpool cycle.");
    await manageOfferRequest(env, offerId, requestId, userId, action);
    await safeRefreshOfferAndBoard(env, guildId, offerId);
    return ephemeral(`Request ${action}ed.`);
  }

  if (customId.startsWith("cancel_ride:")) {
    const offerId = customId.split(":")[1];
    const offer = await getOfferSummary(env, offerId);
    if (!offer || offer.ownerUserId !== userId) return ephemeral("Only the driver can cancel this ride.");
    if (offer.cycleId !== cycle.id) return ephemeral("This ride belongs to a different carpool cycle.");
    await cancelOffer(env, offerId, userId);
    await safeRefreshOfferAndBoard(env, guildId, offerId);
    return ephemeral("Ride cancelled.");
  }

  return ephemeral("Unknown action.");
}

async function handleModalSubmit(env: AppBindings, interaction: DiscordInteraction) {
  const customId = interaction.data?.custom_id ?? "";
  if (!customId.startsWith("offer_modal:")) return;
  const guildId = requireGuild(interaction);
  const userId = requireUser(interaction);
  const carId = customId.split(":")[1];
  const car = await getCar(env, carId);
  if (!car || car.owner_user_id !== userId) {
    await editWebhookMessage(env, interaction.token, "Car not found.");
    return;
  }

  const tripType = parseTripType(modalValue(interaction, "trip_type"));
  const morningTime = modalValue(interaction, "morning_time") || null;
  const returnTime = modalValue(interaction, "return_time") || null;
  if ((tripType === "morning" || tripType === "both") && !morningTime) throw new Error("Morning time is required for this trip type.");
  if ((tripType === "return" || tripType === "both") && !returnTime) throw new Error("Return time is required for this trip type.");

  const cycle = await getOrCreateCycle(env, guildId, env.CARPOOL_CHANNEL_ID);
  if (cycle.status !== "open" || !isOfferWindowOpen()) {
    await editWebhookMessage(env, interaction.token, "Today’s board is closed for new ride offers.");
    return;
  }
  if (await hasActiveOffer(env, cycle.id, userId)) {
    await editWebhookMessage(env, interaction.token, "You already offered a ride for this cycle.");
    return;
  }
  if (await hasActiveClaims(env, cycle.id, userId)) {
    await editWebhookMessage(env, interaction.token, "Cancel existing ride requests/seats before offering your car.");
    return;
  }

  const offerId = newId("offer");
  let offerCreated = false;
  let threadId: string | null = null;
  let cardId: string | null = null;
  let liveCardRendered = false;
  try {
    await createOffer(env, {
      id: offerId,
      cycleId: cycle.id,
      car,
      ownerUserId: userId,
      tripType,
      morningTime,
      returnTime,
    });
    offerCreated = true;

    await ensureDailyBoard(env, guildId);
    const thread = await createPublicThread(env, env.CARPOOL_CHANNEL_ID, car.name);
    if (!thread?.id) throw new Error("Discord did not return a thread ID.");
    threadId = String(thread.id);
    const card = await postThreadMessage(env, threadId, "Creating ride card...");
    if (!card?.id) throw new Error("Discord did not return a ride card message ID.");
    cardId = String(card.id);

    await activateOffer(env, offerId, threadId, String(card.id));
    await editChannelMessage(env, threadId, cardId, renderRideCard({
      id: offerId,
      cycleId: cycle.id,
      ownerUserId: userId,
      carName: car.name,
      seats: car.seats,
      tripType,
      morningTime,
      returnTime,
      status: "active",
      threadId,
      requests: [],
    }), rideCardComponents(offerId));
    liveCardRendered = true;
  } catch (error) {
    if (!liveCardRendered && threadId && cardId) {
      try {
        await editChannelMessage(env, threadId, cardId, "Ride setup failed. Please try offering again.", []);
      } catch (cleanupError) {
        console.error(JSON.stringify({ error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), operation: "markRideSetupFailed", offerId }));
      }
    }
    if (offerCreated && !liveCardRendered) await failCreatingOffer(env, offerId);
    throw error;
  }

  await safeRefreshCurrentBoard(env, guildId);
  await safeEditWebhookMessage(env, interaction.token, `Ride offered in <#${threadId}>.`);
}

async function requestDirections(env: AppBindings, interaction: DiscordInteraction, cycleId: string, offerId: string, userId: string, requested: Direction[]) {
  const guildId = requireGuild(interaction);
  const cycle = await getCycle(env, cycleId);
  if (!cycle || cycle.status !== "open" || !isOfferWindowOpen()) throw new Error("Today’s board is closed for new ride requests.");
  if (await hasActiveOffer(env, cycleId, userId)) throw new Error("Drivers cannot request rides in the same cycle.");
  const offer = await getOfferSummary(env, offerId);
  if (!offer) throw new Error("Ride not found.");
  if (offer.cycleId !== cycleId) throw new Error("This ride belongs to a different carpool cycle.");
  if (offer.status !== "active") throw new Error("Ride is not active.");
  if (offer.ownerUserId === userId) throw new Error("Drivers cannot request seats in their own ride.");
  const cycleOffers = await listCycleOffers(env, cycleId);
  const claims = claimedDirectionsForUser(cycleOffers.flatMap((item) => item.requests), userId);
  const result = canRequestDirections({ requested, offered: directionsForTrip(offer.tripType), existingClaims: claims });
  if (!result.ok) throw new Error(result.reason);
  await addRequests(env, cycleId, offerId, userId, result.directions);
  await safeRefreshOfferAndBoard(env, guildId, offerId);
}

async function ensureDailyBoard(env: AppBindings, guildId: string) {
  const cycle = await getOrCreateCycle(env, guildId, env.CARPOOL_CHANNEL_ID);
  if (cycle.board_message_id) return cycle;
  const message = await createChannelMessage(env, env.CARPOOL_CHANNEL_ID, renderBoard(cycle.cycle_date, []), boardComponents());
  if (!message?.id) throw new Error("Discord did not return a board message ID.");
  const messageId = String(message.id);
  await setCycleBoardMessage(env, cycle.id, messageId);
  return { ...cycle, board_message_id: messageId };
}

async function refreshCurrentBoard(env: AppBindings, guildId: string) {
  const cycle = await getOrCreateCycle(env, guildId, env.CARPOOL_CHANNEL_ID);
  if (!cycle.board_message_id) return;
  const offers = await listCycleOffers(env, cycle.id);
  await editChannelMessage(env, env.CARPOOL_CHANNEL_ID, cycle.board_message_id, renderBoard(cycle.cycle_date, offers), boardComponents());
}

async function safeRefreshCurrentBoard(env: AppBindings, guildId: string) {
  try {
    await refreshCurrentBoard(env, guildId);
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), operation: "refreshCurrentBoard", guildId }));
  }
}

async function refreshOfferAndBoard(env: AppBindings, guildId: string, offerId: string) {
  const offer = await getOfferSummary(env, offerId);
  if (offer?.threadId) {
    const cardId = await getRideCardMessageId(env, offerId);
    if (cardId) {
      try {
        await editChannelMessage(env, offer.threadId, cardId, renderRideCard(offer), rideCardComponents(offerId, offer.status === "cancelled"));
      } catch (error) {
        console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), operation: "refreshRideCard", offerId }));
      }
    }
  }
  await refreshCurrentBoard(env, guildId);
}

async function safeRefreshOfferAndBoard(env: AppBindings, guildId: string, offerId: string) {
  try {
    await refreshOfferAndBoard(env, guildId, offerId);
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), operation: "refreshOfferAndBoard", guildId, offerId }));
  }
}

async function safeEditWebhookMessage(env: AppBindings, interactionToken: string, content: string) {
  try {
    await editWebhookMessage(env, interactionToken, content);
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), operation: "editWebhookMessage" }));
  }
}

async function displayNamesForUsers(env: AppBindings, guildId: string, userIds: string[]): Promise<Map<string, string>> {
  const uniqueUserIds = [...new Set(userIds)];
  const entries = await Promise.all(uniqueUserIds.map(async (userId) => {
    try {
      const member = await discordFetch(env, `/guilds/${guildId}/members/${userId}`) as {
        nick?: string | null;
        user?: { global_name?: string | null; username?: string | null };
      };
      return [userId, member.nick ?? member.user?.global_name ?? member.user?.username ?? userId] as const;
    } catch (error) {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), operation: "displayNameLookup", guildId, userId }));
      return [userId, userId] as const;
    }
  }));
  return new Map(entries);
}

function truncateOptionLabel(label: string): string {
  return label.length <= 100 ? label : `${label.slice(0, 97)}...`;
}

async function getRideCardMessageId(env: AppBindings, offerId: string) {
  const row = await env.DB.prepare("SELECT ride_card_message_id FROM ride_offers WHERE id = ?").bind(offerId).first<{ ride_card_message_id: string | null }>();
  return row?.ride_card_message_id ?? null;
}

async function renameActiveThreadsForCar(env: AppBindings, carId: string, name: string) {
  const rows = await env.DB.prepare("SELECT thread_id FROM ride_offers WHERE car_id = ? AND status = 'active' AND thread_id IS NOT NULL")
    .bind(carId)
    .all<{ thread_id: string }>();
  for (const row of rows.results) {
    try {
      await renameThread(env, row.thread_id, name);
    } catch (error) {
      console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), threadId: row.thread_id }));
    }
  }
}

function offerModal(carId: string) {
  return modal("Offer ride", CUSTOM_IDS.offerModal(carId), [
    textInput("trip_type", "Trip type: morning, return, or both", true, "both"),
    textInput("morning_time", "Morning departure time", false, "8:15 AM"),
    textInput("return_time", "Return departure time", false, "6:30 PM"),
  ]);
}

function parseTripType(value: string): TripType {
  const normalized = value.trim().toLowerCase();
  if (normalized === "morning" || normalized === "return" || normalized === "both") return normalized;
  throw new Error("Trip type must be morning, return, or both.");
}

function isConfiguredChannel(env: AppBindings, interaction: DiscordInteraction): boolean {
  return interaction.channel_id === env.CARPOOL_CHANNEL_ID || interaction.channel?.parent_id === env.CARPOOL_CHANNEL_ID;
}

function requireGuild(interaction: DiscordInteraction): string {
  if (!interaction.guild_id) throw new Error("Longway only works inside a server.");
  return interaction.guild_id;
}

function requireUser(interaction: DiscordInteraction): string {
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!userId) throw new Error("Could not identify Discord user.");
  return userId;
}

function stringOption(interaction: DiscordInteraction, name: string): string | null {
  const value = interaction.data?.options?.find((option) => option.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function numberOption(interaction: DiscordInteraction, name: string): number | null {
  const value = optionalNumberOption(interaction, name);
  return value && value > 0 ? value : null;
}

function optionalNumberOption(interaction: DiscordInteraction, name: string): number | null {
  const value = interaction.data?.options?.find((option) => option.name === name)?.value;
  return typeof value === "number" ? value : null;
}

function modalValue(interaction: DiscordInteraction, customId: string): string {
  for (const row of interaction.data?.components ?? []) {
    const input = row.components?.find((component) => component.custom_id === customId);
    if (input?.value) return input.value.trim();
  }
  return "";
}

function hasAdminPermission(interaction: DiscordInteraction): boolean {
  const permissions = BigInt(interaction.member?.permissions ?? "0");
  const manageGuild = 1n << 5n;
  const manageChannels = 1n << 4n;
  return (permissions & manageGuild) !== 0n || (permissions & manageChannels) !== 0n;
}

function requireBoardMessage(cycle: { board_message_id: string | null }): string {
  if (!cycle.board_message_id) throw new Error("Daily board is missing a Discord message.");
  return cycle.board_message_id;
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: AppBindings, _ctx: ExecutionContext) {
    await closeExpiredCycles(env);
    await closeCurrentCycleIfWindowClosed(env);
    const channel = await discordFetch(env, `/channels/${env.CARPOOL_CHANNEL_ID}`);
    if (!channel?.guild_id) throw new Error("Configured channel did not return a guild ID.");
    const guildId = String(channel.guild_id);
    if (isOfferWindowOpen()) await ensureDailyBoard(env, guildId);
    await refreshCurrentBoard(env, guildId);
  },
};
