import {
  InteractionResponseFlags,
  InteractionResponseType,
} from "discord-interactions";
import type { AppBindings } from "./env";

export const DISCORD_API = "https://discord.com/api/v10";

export const CUSTOM_IDS = {
  offerRide: "offer_ride",
  requestSeat: (offerId: string) => `request_seat:${offerId}`,
  cancelMine: (offerId: string) => `cancel_mine:${offerId}`,
  manageRequests: (offerId: string) => `manage_requests:${offerId}`,
  cancelRide: (offerId: string) => `cancel_ride:${offerId}`,
  offerCarSelect: "offer_car_select",
  requestDirectionSelect: (offerId: string) => `request_direction:${offerId}`,
  manageActionSelect: (offerId: string) => `manage_action:${offerId}`,
  offerModal: (carId: string) => `offer_modal:${carId}`,
};

export type DiscordComponent = Record<string, unknown>;

export function ephemeral(content: string) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: InteractionResponseFlags.EPHEMERAL },
  };
}

export function deferredEphemeral() {
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: InteractionResponseFlags.EPHEMERAL },
  };
}

export function updateMessage(content: string, components: DiscordComponent[] = []) {
  return {
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: { content, components },
  };
}

export function modal(title: string, customId: string, components: DiscordComponent[]) {
  return {
    type: InteractionResponseType.MODAL,
    data: { title, custom_id: customId, components },
  };
}

export function textInput(customId: string, label: string, required: boolean, placeholder?: string): DiscordComponent {
  return {
    type: 1,
    components: [
      {
        type: 4,
        custom_id: customId,
        label,
        style: 1,
        min_length: required ? 1 : 0,
        max_length: 100,
        required,
        placeholder,
      },
    ],
  };
}

export function boardComponents(): DiscordComponent[] {
  return [{ type: 1, components: [{ type: 2, style: 1, label: "Offer ride", custom_id: CUSTOM_IDS.offerRide }] }];
}

export function rideCardComponents(offerId: string, disabled = false): DiscordComponent[] {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: "Request seat", custom_id: CUSTOM_IDS.requestSeat(offerId), disabled },
        { type: 2, style: 2, label: "Cancel mine", custom_id: CUSTOM_IDS.cancelMine(offerId), disabled },
        { type: 2, style: 2, label: "Manage requests", custom_id: CUSTOM_IDS.manageRequests(offerId), disabled },
        { type: 2, style: 4, label: "Cancel ride", custom_id: CUSTOM_IDS.cancelRide(offerId), disabled },
      ],
    },
  ];
}

export function selectMenu(customId: string, placeholder: string, options: Array<{ label: string; value: string; description?: string }>, maxValues = 1): DiscordComponent[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: customId,
          placeholder,
          min_values: 1,
          max_values: maxValues,
          options: options.slice(0, 25),
        },
      ],
    },
  ];
}

export function messageWithComponents(content: string, components: DiscordComponent[]) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, components, flags: InteractionResponseFlags.EPHEMERAL },
  };
}

export async function discordFetch(env: AppBindings, path: string, init: RequestInit = {}) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API ${init.method ?? "GET"} ${path} failed: ${response.status} ${body}`);
  }

  if (response.status === 204) return null;
  return response.json() as Promise<Record<string, unknown>>;
}

export async function createChannelMessage(env: AppBindings, channelId: string, content: string, components: DiscordComponent[]) {
  return discordFetch(env, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, components }),
  });
}

export async function editChannelMessage(env: AppBindings, channelId: string, messageId: string, content: string, components: DiscordComponent[]) {
  return discordFetch(env, `/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ content, components }),
  });
}

export async function createPublicThread(env: AppBindings, channelId: string, name: string) {
  return discordFetch(env, `/channels/${channelId}/threads`, {
    method: "POST",
    body: JSON.stringify({ name, type: 11, auto_archive_duration: 1440 }),
  });
}

export async function renameThread(env: AppBindings, threadId: string, name: string) {
  return discordFetch(env, `/channels/${threadId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function postThreadMessage(env: AppBindings, threadId: string, content: string, components: DiscordComponent[] = []) {
  return createChannelMessage(env, threadId, content, components);
}

export async function editWebhookMessage(env: AppBindings, interactionToken: string, content: string) {
  return discordFetch(env, `/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    body: JSON.stringify({ content }),
  });
}
