import { describe, expect, it } from "vitest";
import {
  canRequestDirections,
  directionState,
  renderRideCard,
  renderBoard,
  ridersToDropAfterSeatChange,
  type RideOfferSummary,
  type RideRequest,
} from "./carpool";
import { isOfferWindowOpen, istCycleDate } from "./db";

function request(overrides: Partial<RideRequest>): RideRequest {
  return {
    id: "request-1",
    riderUserId: "user-1",
    direction: "morning",
    status: "pending",
    queuePosition: 1,
    acceptedOrder: null,
    ...overrides,
  };
}

describe("carpool domain rules", () => {
  it("anchors cycles to the 6 PM IST offer window", () => {
    expect(istCycleDate(new Date("2026-06-16T12:29:00.000Z"))).toBe("2026-06-15");
    expect(istCycleDate(new Date("2026-06-16T12:30:00.000Z"))).toBe("2026-06-16");
  });

  it("closes new offers and requests at 7 AM IST", () => {
    expect(isOfferWindowOpen(new Date("2026-06-16T01:29:00.000Z"))).toBe(true);
    expect(isOfferWindowOpen(new Date("2026-06-16T01:30:00.000Z"))).toBe(false);
  });

  it("keeps the weekend window open from Friday 6 PM through Monday 7 AM IST", () => {
    expect(isOfferWindowOpen(new Date("2026-06-12T12:29:00.000Z"))).toBe(false);
    expect(isOfferWindowOpen(new Date("2026-06-12T12:30:00.000Z"))).toBe(true);
    expect(isOfferWindowOpen(new Date("2026-06-13T06:30:00.000Z"))).toBe(true);
    expect(isOfferWindowOpen(new Date("2026-06-14T06:30:00.000Z"))).toBe(true);
    expect(isOfferWindowOpen(new Date("2026-06-15T01:29:00.000Z"))).toBe(true);
    expect(isOfferWindowOpen(new Date("2026-06-15T01:30:00.000Z"))).toBe(false);
  });

  it("uses the Friday cycle for the whole weekend window", () => {
    expect(istCycleDate(new Date("2026-06-12T12:30:00.000Z"))).toBe("2026-06-12");
    expect(istCycleDate(new Date("2026-06-13T06:30:00.000Z"))).toBe("2026-06-12");
    expect(istCycleDate(new Date("2026-06-14T06:30:00.000Z"))).toBe("2026-06-12");
    expect(istCycleDate(new Date("2026-06-15T01:29:00.000Z"))).toBe("2026-06-12");
  });

  it("blocks duplicate direction claims while allowing unresolved directions", () => {
    const result = canRequestDirections({
      requested: ["morning", "return"],
      offered: ["morning", "return"],
      existingClaims: new Set(["morning"]),
    });

    expect(result).toEqual({
      ok: false,
      reason: "You already have a morning request or seat for this cycle.",
    });
  });

  it("tracks seats independently per direction", () => {
    const offer: RideOfferSummary = {
      id: "offer-1",
      cycleId: "cycle-1",
      ownerUserId: "driver-1",
      carName: "Civic",
      seats: 2,
      tripType: "both",
      morningTime: "8:15 AM",
      returnTime: "6:30 PM",
      status: "active",
      threadId: "thread-1",
      requests: [
        request({ id: "m1", riderUserId: "a", direction: "morning", status: "accepted", acceptedOrder: 1 }),
        request({ id: "m2", riderUserId: "b", direction: "morning", status: "pending", queuePosition: 2 }),
        request({ id: "r1", riderUserId: "c", direction: "return", status: "accepted", acceptedOrder: 1 }),
        request({ id: "r2", riderUserId: "d", direction: "return", status: "accepted", acceptedOrder: 2 }),
      ],
    };

    expect(directionState(offer, "morning")).toMatchObject({ seatsLeft: 1 });
    expect(directionState(offer, "return")).toMatchObject({ seatsLeft: 0 });
  });

  it("drops latest accepted riders first after seat reduction", () => {
    const requests = [
      request({ id: "first", riderUserId: "a", status: "accepted", acceptedOrder: 1 }),
      request({ id: "second", riderUserId: "b", status: "accepted", acceptedOrder: 2 }),
      request({ id: "third", riderUserId: "c", status: "accepted", acceptedOrder: 3 }),
    ];

    expect(ridersToDropAfterSeatChange(requests, "morning", 1).map((item) => item.id)).toEqual(["third", "second"]);
  });

  it("renders accepted names and hides rejected names from ride card", () => {
    const card = renderRideCard({
      id: "offer-1",
      cycleId: "cycle-1",
      ownerUserId: "driver-1",
      carName: "Civic",
      seats: 2,
      tripType: "morning",
      morningTime: "8:15 AM",
      returnTime: null,
      status: "active",
      threadId: "thread-1",
      requests: [
        request({ id: "accepted", riderUserId: "accepted-user", status: "accepted", acceptedOrder: 1 }),
        request({ id: "rejected", riderUserId: "rejected-user", status: "rejected", queuePosition: 2 }),
      ],
    });

    expect(card).toContain("<@accepted-user>");
    expect(card).not.toContain("rejected-user");
  });

  it("strikes cancelled rides on the board", () => {
    const board = renderBoard("2026-06-12", [{
      id: "offer-1",
      cycleId: "cycle-1",
      ownerUserId: "driver-1",
      carName: "Civic",
      seats: 2,
      tripType: "morning",
      morningTime: "8:15 AM",
      returnTime: null,
      status: "cancelled",
      threadId: "thread-1",
      requests: [],
    }]);

    expect(board).toContain("- ~~Civic by <@driver-1> (cancelled)");
  });
});
