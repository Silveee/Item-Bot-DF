'use strict';

require('dotenv').config();

const readline = require('readline');
const cheerio = require('cheerio');
const https = require('https');
const fs = require('fs');
const decode = require('unescape');
const connection = require('./db')();

async function applyAsync(array, operation, ...additionalArguments) {
	const promises = [];
	for (const element of array)
		promises.push(operation(element, ...additionalArguments));
	await Promise.all(promises);
}

function sanitizeName(name) {
	return name.toLowerCase().replace(/[.,\-"()]/g, ' ').replace(/ +/g, ' ').trim();
}

function fetchContent(url) {
	// Sends an HTTPS request to the specified url
	// Resend indefinitely on failure
	return new Promise((resolve, reject) => {
		const req = https.get(url, res => {
			if (res.statusCode === 302)
				return fetchContent('https://forums2.battleon.com/f/' + res.headers.location).then(resolve).catch(reject);
			let body = '';
			res.on('error', () => fetchContent(url).then(resolve).catch(reject));
			res.on('data', chunk => body += chunk);
			res.on('end', () => resolve(body));
		});
		req.on('error', () => fetchContent(url).then(resolve).catch(reject));
	});
}
async function fetchLinks(url, pageIndex) {
	// Fetches all links from the DF pedia page
	const page = await fetchContent(`${url}&p=${pageIndex}`);
	const $ = cheerio.load(page);
	const anchors = $('td.c2 > a[title]');
	if (!anchors.length) return [];

	// Remove the first two links ie the A-Z guide and the other one, found only on the first page of the pedia
	if (pageIndex == 1) return anchors.slice(2);
	return anchors;
}

async function fetchPosts(link) {
	// Fetches all posts within an item's page
	const page = await fetchContent(link);
	const $ = cheerio.load(page);
	const posts = $('td.msg');
	return posts.map((_, post) => $(post));
}

function getTags(body) {
	const tagConversion = { 'guardian':'guardian', 'seasonal':'seasonal', 'da':'da', 'dc':'dc', 'artifact':'artifact', 'rare':'rare', 'warloot':'rare', 'temp':'temporary', 'doomknight':'so', 'specialoffer':'so' };
	const headings = body.match(/(?:<img src=.+? alt> *(?:<br>)? *)?<font.+?(?:(?:sell ?back:?)|(?:sells for:)).+?<br> +<br>/ig);

	const tagList = [];
	for (const heading of headings) {
		const $ = cheerio.load(heading);
		const images = $('img[src*="media.artix.com/encyc/df/tags/"]');
		const tags = new Set();
		images.each((_, image) => {
			let [, tag] = image.attribs.src.match(/media\.artix\.com\/encyc\/df\/tags\/(.+)\..+/);
			tag = tagConversion[tag.toLowerCase()];
			if (tag !== 'dc') {
				if (tag) tags.add(tag);
				return;
			}
			const [, price] = heading.match(/price:? +(.+?) +<br> +<br>/i);
			const [, sellback] = heading.match(/(?:(?:sell ?back:?)|(?:sells for:)) +(.+?) +<br> +<br>/i);
			// Do not add the DC tag if the weapon costs or sells for 0 DC
			if (tags.has('so') || sellback.match(/^0 +dragon +coins/i) || price.match(/^0 +dragon +coins/i)) return;
			tags.add('dc');
		});
		tagList.push([...tags]);
	}
	return tagList;
}

async function getTrinketSkill(link, postNumber) {
	/**
	* Parses a trinket skill's information from the given forum post number in the given DragonFable pedia link.
	* The object returned is stored as a nested structure in an accessory's MongoDB document, if the accessory
	* is a trinket with a skill.
	* @param {String} link - URL to the forum thread containing the trinket's skill information.
	* @param {Number} postNumber - The (0-indexed) number of the post that the trinket's skill corresponds to.
	* @returns {Object} - Object containing .
	*/
	const posts = await fetchPosts(link);
	const body = posts[postNumber].html();
	const [, effect] = body.match(/Effect:? +(.+?) <br>/);
	const [, cooldown] = body.match(/Cooldown:? +(\d+)/);
	const [, damageType] = body.match(/(?:Damage|Attack) Type:? +(.+?) <br>/);
	const [, manaCost] = body.match(/Mana Cost:? +(\d+)/);
	const [, element] = body.match(/Element:? +(.+?) <br>/);
	return { effect: decode(effect), cooldown: Number(cooldown), damageType: damageType.toLowerCase(), manaCost: Number(manaCost), element: element.toLowerCase() };
}

function getItemType(body) {
	let [, itemType] = body.match(/Item Type:? +(.+?) +<br>/i);
	itemType = itemType.toLowerCase();
	if (itemType !== 'artifact') return itemType;

	let [, equipSpot] = body.match(/Equip Spot:? +(\w+) +<br>/i);
	itemType = { 'back':'cape', 'wrist':'bracer', 'head':'helm', 'weapon':'weapon', 'neck':'necklace', 'trinket':'trinket', 'waist': 'belt' }[equipSpot.toLowerCase()];
	return itemType;
}

function getBoosts(body) {
	const possibleBonuses = {'block':'Block', 'dodge':'Dodge', 'parry':'Parry', 'crit':'Crit', 'magic def':'Magic Def', 'pierce def':'Pierce Def', 'melee def':'Melee Def', 'wis':'WIS', 'end':'END', 'cha':'CHA', 'luk':'LUK', 'int':'INT', 'dex':'DEX', 'str':'STR', 'bonus':'Bonus'};
	const bonuses = [];
	const resists = [];
	const [, bonusList] = body.match(/Bonuses:? +(.+?) <br>/);
	if (bonusList !== 'None') {
		for (const bonus of bonusList.split(', ')) {
			const plusOrMinus = bonus.indexOf('+') > -1 ? bonus.indexOf('+') : bonus.indexOf('-');
			const name = bonus.slice(0, plusOrMinus).toLowerCase().trim().replace(/[^a-z? ]/g, '');
			const value = Number(bonus.slice(plusOrMinus).replace(/ /g, ''));
			if (name in possibleBonuses) bonuses.push({ k: name, v: value });
			else resists.push({ k: name, v: value });
		}
	}
	const [, resistList] = body.match(/Resists:? +(.+?) <br>/) || [];
	if (resistList && resistList !== 'None') {
		for (const resist of resistList.split(', ')) {
			const plusOrMinus = resist.indexOf('+') > -1 ? resist.indexOf('+') : resist.indexOf('-');
			const name = resist.slice(0, plusOrMinus).toLowerCase().trim().replace(/[^a-z? ]/g, '');
			const value = Number(resist.slice(plusOrMinus).replace(/ /g, ''));
			resists.push({ k: name, v: value });
		}
	}
	return { bonuses, resists };
}

function getWeaponData(post, link) {
	// Parses a weapon's information from a post and returns an object
	let title = post.find('font[size=3]').first().text();
	title = decode(title);
	if (!title) return []; // Not a weapon

	const body = post.html();
	const [, level] = body.match(/<br> +Level:? +(\d{1,2}) +<br>/) || [];
	if (!level) return []; // Not a weapon

	const tagLists = getTags(body);
	const [, damageRange] = body.match(/<br> +Damage:? +(.+?) +<br>/);
	const damage = damageRange.split('-').filter(num => !isNaN(num)).map(Number);
	const [, elementList] = body.match(/<br> +Element:? +(.+?) +<br>/);
	const elements = [];
	for (const element of elementList.trim().split('/').map(e => e.toLowerCase().trim()))
		elements.push(element);
	const itemType = getItemType(body);
	const { bonuses, resists } = getBoosts(body);
	const specials = [];
	const specialsList = body.match(/Special Activation:.+?Special Rate: .+? +<br>/gi);
	for (const special of specialsList || []) {
		const specialData = {};
		let [, activation] = special.match(/special activation: +(.+?) +<br>/i);
		if (activation.match(/attack/i)) specialData.activation = 'attack button';
		else if (activation.match(/(?:hit)|(?:crit)/i)) specialData.activation = 'on-hit';
		else if (activation.match(/click/i)) specialData.activation = 'click weapon';
		else if (activation.match(/enemies/i)) specialData.activation = 'specific enemy';

		const [, effectText] = special.match(/special (?:(?:effect)|(?:damage)): +(.+?) +<br>/i);
		const effect = cheerio.load(effectText)('body');
		effect.find('s').remove();
		specialData.effect = decode(effect.text().replace(/ +/g, ' '));
		if (specialData.activation === 'specific enemy') specialData.effect += ` (${activation})`;

		specialData.elements = [];
		if (!(specialData.activation in { 'click weapon':1, 'specific enemy':1 })) {
			const [, elementMatch] = special.match(/special element: +(.+?) +<br>/i) || [];
			if (elementMatch && elementMatch !== 'N/A')
				specialData.elements = elementMatch.split('/').map(element => element.trim().toLowerCase());
		}

		const [, rate] = special.match(/special rate: +(.+?)%/i) || [];
		specialData.rate = (Number(rate) || parseInt(rate) || 100) / 100;

		specials.push(specialData);
	}
	return tagLists.map(tags => {
		const weapon = { link, title, tags, name: sanitizeName(title), level: Number(level), damage, elements, type: itemType.split(', '), bonuses, resists, specials };
		return weapon;
	});
}

async function getAccessoryData(post, link) {
	/**
	* Parses an accessory's information from a post and returns an object containing accessory data.
	* This object is then to be stored as document in its respective collection.
	* @param {Object} post - Cheerio object containing the forum post's html data
	* @param {String} link - URL of the forum post
	* @returns {Object} - Object containing accessory information to be stored in the mongoDB database.
	*/
	let title = post.find('font').first().text();
	title = decode(title);
	if (!title) return [];

	const body = post.html();
	let [, level] = body.match(/<br> +Level:? +(\d{1,2}) +<br>/) || [];
	if (!level) return [];

	const tagLists = getTags(body);
	const itemType = getItemType(body);
	const { bonuses, resists } = getBoosts(body);
	let modifies = null;
	const [, modifications] = body.match(/<br> +Modifies:(.+?)<br>/) || [];
	if (modifications) {
		modifies = cheerio.load(modifications)
			.text().split(',')
			.map(armor => armor.replace(/(?:armor)|(?:leathers)|(?:robes)/ig, '').trim())
			.join(', ');
	}
	let skill = null;
	if (itemType === 'trinket') {
		const [, ability] = body.match(/<br> +Ability:? +(.+?) +<br>/i) || [];
		if (ability) {
			const [, link, postNumber] = ability.match(/href="(.+?)">(?:.+?\((\d+?)\)<)?/);
			skill = await getTrinketSkill(link, (Number(postNumber) || 1) - 1);
		}
	}

	return tagLists.map(tags => {
		const accessory = { link, title, tags, name: sanitizeName(title), level: Number(level), type: itemType, bonuses, resists, skill, modifies };
		return accessory;
	});
}

async function fetchItemPage(link, category, collection) {
	// Fetches all accessories from a page and adds them to a mongoDB collection if specified
	const getData = { 'weapons': getWeaponData, 'accessories': getAccessoryData };
	const posts = await fetchPosts(link);
	if (collection) await collection.deleteMany({ link });
	await applyAsync(posts.toArray(), async post => {
		try {
			const items = await getData[category](post, link);
			if (!items.length) return;
			if (collection)
				await collection.insertMany(items);
			console.log(...items);
		} catch (err) {
			console.log(err);
			fs.promises.appendFile('errors.txt', err.stack + '\n' + post + '\n\n');
		}
	});
}

connection.then(async db => {
	console.log('Database connection successful');

	const weapons = await db.collection('weapons');
	const accessories = await db.collection('accessories');

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	const commands = [
		'DF Pedia scraping commands:',
		'commands - Displays this list',
		'addweapon [weapon url]',
		'addaccessory [accessory url]',
		'deleteall - Removes everything from the database',
		'addallweapons - Adds all weapons to the database.',
		'addallaccessories - Adds all accessories to the database.',
		'exit - guess what this does'
	].join('\n');
	console.log(commands);
	let command;
	do {
		const input = await new Promise(resolve => rl.question('', resolve));
		let separator = input.indexOf(' ');
		separator = separator > -1 ? separator: input.length;
		command = input.slice(0, separator);

		if (command === 'commands') console.log(commands);
		else if (command === 'addweapon' || command === 'addaccessory') {
			const type = command === 'addaccessory' ? 'accessories' : 'weapons';
			let links = input.slice(separator + 1).trim();
			if (!links) {
				console.log('Enter the urls.');
				continue;
			}
			links = links.split(',').map(link => link.trim());
			console.log(`Adding ${type} to the database...`);
			await applyAsync(links, fetchItemPage, type, type[0] === 'a' ? accessories : weapons);
			console.log(`${type} added successfully.`);
		}
		else if (command in { 'addallweapons':1, 'addallaccessories':1, 'addall':1 }) {
			let pageIndex = 0;
			if (command in {'addall':1, 'addallweapons':1}) {
				while (true) {
					const anchors = await fetchLinks('https://forums2.battleon.com/f/tt.asp?forumid=119', ++pageIndex);
					if (!anchors.length) break;
					anchors.each(async (_, a) => {
						const link = 'https://forums2.battleon.com/f/' + a.attribs.href;
						fetchItemPage(link, 'weapons', weapons);
					});
				}
			}
			if (command in {'addall':1, 'addallaccessories':1}) {
				pageIndex = 0;
				while (true) {
					const anchors = await fetchLinks('https://forums2.battleon.com/f/tt.asp?forumid=118', ++pageIndex);
					if (!anchors.length) break;
					anchors.each(async (_, a) => {
						const link = 'https://forums2.battleon.com/f/' + a.attribs.href;
						fetchItemPage(link, 'accessories', accessories);
					});
				}
			}
		}
		else if (command === 'deleteall') {
			console.log('Deleting all items..');
			await Promise.all([accessories.deleteMany({}), weapons.deleteMany({})]);
			console.log('All items have been removed from the database.');
		}
		else if (command === 'exit') console.log('bye');
		else
			console.log('Unrecognized command.');

	} while (command !== 'exit');

	process.exit();

}).catch(err => {
	console.log('An error occured while connecting to the database.');
	console.error(err);
	process.exit();
});