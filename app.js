"use strict";

require("dotenv").config();

const bot = require("./bot");
const searchBuilder = require("./search-builder");
const connection = require("./db");

connection.then(async (db) => {
  const items = await db.collection(process.env.DB_COLLECTION);
  const results = await items
    .aggregate([{ $group: { _id: null, names: { $addToSet: "$name" } } }])
    .next();
  for (const name of results.names) {
    searchBuilder.add({ name });
  }

  const commands = require("./commands").commands;

  bot.on("message", async (message) => {
    if (
      !(message.channel.type in { text: 1 }) ||
      !message.content.startsWith(process.env.COMMAND_TOKEN) ||
      message.author.bot
    )
      return;

    let commandName = message.content.split(" ")[0].slice(1);
    const args = message.content.slice(commandName.length + 2).trim();
    if (commandName in commands) {
      let command = commands[commandName];
      if (typeof command === "string") command = commands[command]; // Alias
      try {
        await command(message, args, commandName);
      } catch (err) {
        console.error("An error occurred:\n" + err.stack);
        message.channel.send(
          "An error occurred." +
            (process.env.DEV_ID ? ` <@${process.env.DEV_ID}>` : "")
        );
      }
    }
  });

  console.log("Logging in...");
  bot
    .login(process.env.BOT_TOKEN)
    .then(() => console.log(`Logged in as ${bot.user.tag}.`))
    .catch((err) => {
      console.log("Bot Error:", err);
      process.exit();
    });
});
