"use strict";

const bonuses = new Set([
  "block",
  "dodge",
  "parry",
  "crit",
  "magic def",
  "pierce def",
  "melee def",
  "wis",
  "end",
  "cha",
  "luk",
  "int",
  "dex",
  "str",
  "bonus",
]);

exports.validTypes = new Set([
  "weapon",
  "accessory",
  "cape",
  "wing",
  "helm",
  "ring",
  "belt",
  "necklace",
  "trinket",
  "bracer",
]);

exports.embed = (text, title, footer) => {
  const body = {};
  body.description = text;
  if (title) body.title = title;
  if (footer) body.footer = { text: footer };
  return { embed: body };
};

exports.isResist = (value) => {
  if (bonuses.has(value) || value === "damage") return false;
  return true;
};

/**
 * Capitalizes the first letter of every other word in the input text, with
 * few exceptions, which are instead capitalized fully
 *
 * @param {String} text
 *   Text to be capitalized
 *
 * @return {String}
 *   String with alternate words in the input text capitalized, or the text
 *   fully capitalized if the text is one of several values
 */
const capitalize = (exports.capitalize = (text) => {
  const fullCapWords = new Set([
    // These words are fully capitalized
    "str",
    "int",
    "dex",
    "luk",
    "cha",
    "dm",
    "fs",
    "wis",
    "end",
    "dm",
    "so",
    "dc",
    "da",
    "ak",
  ]);
  if (fullCapWords.has(text)) return text.toUpperCase();

  if (!text || !text.trim()) return text;

  return text
    .trim()
    .split(" ")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
});

/**
 * Format an input tag
 *
 * @param {String} tag
 *   Tag to be formatted
 *
 * @return {String}
 *   'Seasonal', 'ArchKnight Saga', 'Alexander Saga' if the input tag is 'se', 'ak', or 'alexander'
 *   respectively. The return value is capitalize(tag) otherwise
 */
exports.formatTag = (tag) => {
  return (
    {
      se: "Seasonal",
      ak: "ArchKnight Saga",
      alexander: "Alexander Saga",
      temp: "Temporary",
      fs: "Free Storage",
    }[tag] || capitalize(tag)
  );
};

/**
 * Does the following:
 * - Lowercases input text
 * - Removes leading and trailing whitespace
 * - Removes accents from input text characters
 * - Removes brackets, quotes, and backticks
 * - Replaces all other alphanumeric characters with a single whitespace
 * - Replaces all instances of more than one whitespace with a single whitespace
 * Example: "Alina's Battle-Bouquet Staff" -> "alinas battle bouquet staff"
 *
 * @param {String} text
 *   Input text to be sanitized
 *
 * @return {String}
 *   Sanitized text
 */
exports.sanitizeText = (text) => {
  return (
    text
      .toLowerCase()
      // Replace accented characters with their non-accented versions
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[()'"“”‘’`]/g, "") // Remove brackets, quotes, and backticks
      // Replace all other non-alphanumeric character (other than |, since that is a valid weapon name)
      // sequences with a single whitespace
      .replace(/[^a-z0-9\+\?|]+/g, " ")
      .replace(/ +/g, " ")
      .trim()
  );
};

/**
 * Formats an array of boosts (resistances or stat bonuses) into a comma-separated list
 * Example: [{ k: 'int', v: 3 }, { k: 'melee def', v: -1 }] -> 'INT +3, Melee Def -1'
 *
 * @param {{ k: String, v: Number }[] | null} boosts
 *   An array of objects listing each boost's name (k) and value (v)
 *
 * @return {String}
 *   A comma separated list of boost names and their corresponding values, obtained by:
 *   - Capitalizing each boost name
 *   - Prepending a '+' to the boost's value if it is > 0
 *   - Joining boost's name and value together with a space
 *   - Joining each string of boost name/value pairs with ', '
 */
exports.formatBoosts = (boosts) => {
  return (
    (boosts || [])
      .map((boost) => {
        const name = capitalize(boost.k);
        const value = (boost.v < 0 ? "" : "+") + boost.v;
        return name + " " + value;
      })
      .join(", ") || "None"
  );
};
