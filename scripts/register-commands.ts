import { SlashCommandBuilder } from "@discordjs/builders";

const applicationId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_TOKEN;

if (!applicationId) {
  throw new Error("Set DISCORD_APPLICATION_ID in your shell before running npm run register-commands.");
}

if (!token) {
  throw new Error("Set DISCORD_TOKEN in your shell before running npm run register-commands.");
}

const commands = [
  new SlashCommandBuilder()
    .setName("register-car")
    .setDescription("Register a reusable car profile")
    .addStringOption((option) => option.setName("name").setDescription("Car display name, unique to you").setRequired(true))
    .addIntegerOption((option) => option.setName("seats").setDescription("Passenger seats available").setMinValue(1).setMaxValue(20).setRequired(true)),
  new SlashCommandBuilder()
    .setName("edit-car")
    .setDescription("Edit one of your registered cars by name")
    .addStringOption((option) => option.setName("car").setDescription("Current car name").setRequired(true))
    .addStringOption((option) => option.setName("name").setDescription("New car name").setRequired(false))
    .addIntegerOption((option) => option.setName("seats").setDescription("New passenger seat count").setMinValue(1).setMaxValue(20).setRequired(false)),
  new SlashCommandBuilder()
    .setName("delete-car")
    .setDescription("Delete a registered car by name")
    .addStringOption((option) => option.setName("car").setDescription("Car name").setRequired(true)),
  new SlashCommandBuilder()
    .setName("start-board")
    .setDescription("Admin-only: create or find today’s Longway board"),
].map((command) => command.toJSON());

const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

if (!response.ok) {
  throw new Error(`Command registration failed: ${response.status} ${await response.text()}`);
}

console.log(`Registered ${commands.length} commands for application ${applicationId}.`);
