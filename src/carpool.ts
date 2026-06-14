export type Direction = "morning" | "return";
export type TripType = Direction | "both";
export type RequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

export type RideRequest = {
  id: string;
  riderUserId: string;
  direction: Direction;
  status: RequestStatus;
  queuePosition: number;
  acceptedOrder: number | null;
};

export type RideOfferSummary = {
  id: string;
  cycleId: string;
  ownerUserId: string;
  carName: string;
  seats: number;
  tripType: TripType;
  morningTime: string | null;
  returnTime: string | null;
  status: "active" | "cancelled";
  threadId: string | null;
  requests: RideRequest[];
};

export type DirectionState = {
  accepted: RideRequest[];
  pending: RideRequest[];
  seatsLeft: number;
};

export function directionsForTrip(tripType: TripType): Direction[] {
  return tripType === "both" ? ["morning", "return"] : [tripType];
}

export function directionState(offer: Pick<RideOfferSummary, "seats" | "requests">, direction: Direction): DirectionState {
  const accepted = offer.requests
    .filter((request) => request.direction === direction && request.status === "accepted")
    .sort((a, b) => (a.acceptedOrder ?? 0) - (b.acceptedOrder ?? 0));
  const pending = offer.requests
    .filter((request) => request.direction === direction && request.status === "pending")
    .sort((a, b) => a.queuePosition - b.queuePosition);

  return {
    accepted,
    pending,
    seatsLeft: Math.max(0, offer.seats - accepted.length),
  };
}

export function claimedDirectionsForUser(
  requests: RideRequest[],
  userId: string,
): Set<Direction> {
  return new Set(
    requests
      .filter((request) => request.riderUserId === userId && (request.status === "pending" || request.status === "accepted"))
      .map((request) => request.direction),
  );
}

export function canRequestDirections(params: {
  requested: Direction[];
  offered: Direction[];
  existingClaims: Set<Direction>;
}): { ok: true; directions: Direction[] } | { ok: false; reason: string } {
  const directions = params.requested.filter((direction) => params.offered.includes(direction));
  if (directions.length === 0) {
    return { ok: false, reason: "This ride does not offer that direction." };
  }

  const duplicate = directions.find((direction) => params.existingClaims.has(direction));
  if (duplicate) {
    return { ok: false, reason: `You already have a ${duplicate} request or seat for this cycle.` };
  }

  return { ok: true, directions };
}

export function ridersToDropAfterSeatChange(
  requests: RideRequest[],
  direction: Direction,
  newSeats: number,
): RideRequest[] {
  const accepted = requests
    .filter((request) => request.direction === direction && request.status === "accepted")
    .sort((a, b) => (b.acceptedOrder ?? 0) - (a.acceptedOrder ?? 0));

  return accepted.slice(0, Math.max(0, accepted.length - newSeats));
}

export function renderBoard(cycleDate: string, offers: RideOfferSummary[]): string {
  const lines = [
    `**Longway carpool board - ${cycleDate} IST**`,
    "Offer rides and request seats from this single daily board. New offers/requests close at 7:00 AM IST.",
    "",
  ];

  if (offers.length === 0) {
    lines.push("No rides offered yet.");
  } else {
    for (const offer of offers) {
      const status = offer.status === "cancelled" ? "cancelled" : "active";
      const pieces = directionsForTrip(offer.tripType).map((direction) => {
        const state = directionState(offer, direction);
        return `${direction}: ${state.seatsLeft} left, ${state.pending.length} pending`;
      });
      const thread = offer.threadId ? ` <#${offer.threadId}>` : "";
      const line = `${offer.carName} by <@${offer.ownerUserId}> (${status}) - ${pieces.join(" | ")}${thread}`;
      lines.push(`- ${offer.status === "cancelled" ? `~~${line}~~` : line}`);
    }
  }

  lines.push("", "Use the button below to offer your ride.");
  return lines.join("\n");
}

export function renderRideCard(offer: RideOfferSummary): string {
  const lines = [`**${offer.carName} - <@${offer.ownerUserId}>**`];
  if (offer.morningTime) lines.push(`Morning: ${offer.morningTime} IST`);
  if (offer.returnTime) lines.push(`Return: ${offer.returnTime} IST`);
  if (offer.status === "cancelled") lines.push("Status: cancelled");

  for (const direction of directionsForTrip(offer.tripType)) {
    const state = directionState(offer, direction);
    lines.push("");
    lines.push(`**${capitalize(direction)}**`);
    lines.push(`Seats left: ${state.seatsLeft}`);
    lines.push(`Accepted: ${formatMentions(state.accepted.map((request) => request.riderUserId))}`);
    lines.push(`Pending: ${formatMentions(state.pending.map((request) => request.riderUserId))}`);
  }

  return lines.join("\n");
}

function formatMentions(userIds: string[]): string {
  return userIds.length === 0 ? "none" : userIds.map((userId) => `<@${userId}>`).join(", ");
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
