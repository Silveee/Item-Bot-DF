'use strict';

const { capitalize, formatTag, formatBoosts, sanitizeText, validTypes } = require('./utils');

const connect = require('./db');
const { ExpressionParser, ProblematicExpressionError } = require('./expression-evaluation');

const aliases = {
	'adl': 'ancient dragonlord helm',
	'adsoe': 'ancient dragon amulet scythe of the elements',
	'ancient': 'ancient dragon amulet scythe of the elements',
	'aya': 'summon gem ayauhnqui ex',
	'ba': 'baltaels aventail',
	'boa': 'blade of awe',
	'bod': 'blade of destiny',
	'c7': 'the corrupted seven',
	'ddb': 'defenders dragon belt',
	'ddn': 'defenders dragon necklace',
	'ddr': 'defenders dragon ring',
	'ddsoe': 'doomed dragon amulet scythe of elementals',
	'ddv': 'distorted doom visage',
	'dm cannon': 'defender cannon',
	'doomed': 'doomed dragon amulet scythe of elementals',
	'drgn capacitor': 'drgn c4p4c170r',
	'drgn claw': 'drgn c74w',
	'drgn visor': 'drgn v1z0r',
	'drgn vizor': 'drgn v1z0r',
	'eud': 'elemental unity defender',
	'fc': 'frozen claymore',
	'fdl': 'fierce dragonlord helm',
	'fs': 'frostscythe',
	'gg': 'forgotten gloom glaive',
	'gt': 'grove tender',
	'isis': 'ice scythe',
	'lh': 'lucky hammer',
	'npsb': 'necro paragon soulblade',
	'nsod': 'necrotic sword of doom',
	'nstb': 'not so tiny bubbles',
	'pdl': 'dragons patience',
	'rdl': 'dragons rage',
	'ricterild': 'summon gem ricterild ex',
	'roktoru': 'summon gem roktoru ex',
	'scc': 'sea chickens conquest',
	'sf': 'soulforged scythe',
	'ublod': 'ultimate blinding light of destiny',
	'ultimate scythe': 'ultimate dragon amulet scythe of elementals',
	'uok': 'ultra omniknight blade',
	'ur mom': 'unsqueakable farce',
	'vik': 'vanilla ice katana',
	'your mom': 'unsqueakable farce'
};

const CT = process.env.COMMAND_TOKEN;

/**
 * Get details of an item from the database. The input item name is sanitized and converted to its original form
 * if it is an alias of another item name.
 * If the exact item name is not found in the database, a text search is done in descending order of level.
 * The details of the first result is then returned instead
 *
 * @param {String} itemName
 *   Name of the item to be fetched from the database
 * @param {Object} existingQuery
 *   An existing mongoDB query object to be modified with filter queries before being run
 *
 * @return {Promise<Object>}
 *   Promise that resolves an object containing the details of the item or the closest match.
 *   Resolves null if no item is found
 */
async function getItem(itemName, existingQuery) {
	itemName = sanitizeText(itemName);
	if (itemName in aliases) itemName = aliases[itemName];
	existingQuery.name = itemName;

	const db = await connect();
	const items = await db.collection(process.env.DB_COLLECTION);

	const pipeline = [
		{ $match: existingQuery },
		// Temporary items are to be at the bottom of the search, followed by special offer and DC items
		{
			$addFields: {
				priority: {
					$switch: {
						branches: [
							{ case: { $in: ['temp', { $ifNull: ['$tags', []] }] }, then: -3 },
							{ case: { $in: ['so', { $ifNull: ['$tags', []] }] }, then: -2 },
							{ case: { $in: ['dc', { $ifNull: ['$tags', []] }] }, then: -1 },
						],
						default: 0
					}
				}
			}
		},
		{ $sort: { level: -1, priority: -1 } },
		{ $limit: 1 }
	];
	let results = items.aggregate(pipeline);
	let item = await results.next();
	// Do a text search instead if no exact match is found
	if (!item) {
		delete existingQuery.name;
		existingQuery.$text = { $search: '"' + itemName + '"' };
		results = items.aggregate(pipeline);
		item = await results.next();
	}
	return item;
}

exports.commands = {
	wep: 'item',
	weap: 'item',
	weapon: 'item',
	acc: 'item',
	accessory: 'item',
	item: async function ({ channel }, args, commandName) {
		const [itemName, maxLevel] = args.split('/');
		if (!itemName.trim() || (maxLevel && isNaN(maxLevel))) {
			return channel.send(`Usage: ${CT}${commandName} \`[name]\` / \`[max level (optional)]\``);
		}

		const query = {};
		if (maxLevel) query.level = { $lte: Number(maxLevel) };
		if (commandName in { 'wep': 1, 'weap': 1, 'weapon': 1 }) query.category = 'weapon';
		else if (commandName in { 'acc': 1, 'accessory': 1 }) query.category = 'accessory';

		const item = await getItem(itemName, query);
		if (!item) return channel.send('No item was found');

		const embedFields = [];
		let description = null;
		const isCosmetic = item.tags && item.tags.includes('cosmetic');
		if (item.category === 'weapon') {
			description = [
				`**Tags:** ${(item.tags || []).map(formatTag).join(', ') || 'None'}`,
				`**Level:** ${item.level}`,
				`**Type:** ${item.type.map(capitalize).join(' / ')}`,
				...isCosmetic ? [] : [`**Damage:** ${item.damage.map(String).join('-') || 'Scaled'}`],
				`**Element:** ${item.elements.map(capitalize).join(' / ')}`,
				...isCosmetic ? [] : [`**Bonuses:** ${formatBoosts(item.bonuses)}`],
				...isCosmetic ? [] : [`**Resists:** ${formatBoosts(item.resists)}`],
			];
			for (const special of item.specials || []) {
				embedFields.push({
					name: 'Weapon Special',
					value: [
						`**Activation:** ${capitalize(special.activation)}`,
						`**Effect:** ${special.effect}`,
						...special.elements ? [`**Element:** ${special.elements.map(capitalize).join(' / ')}`] : [],
						...special.activation in { 'specific enemy': 1, 'click weapon': 1 } ?
							// Precision of 5 decimal places
							[] : [`**Rate:** ${Math.round(special.rate * 10**5) / 10**3}%`],
					].join('\n'),
					inline: true
				});
			}
		} else if (item.category === 'accessory') {
			description = [
				`**Tags:** ${(item.tags || []).map(formatTag).join(', ') || 'None'}`,
				`**Level:** ${item.level}`,
				`**Type:** ${capitalize(item.type)}`,
				...isCosmetic ? [] : [`**Bonuses:** ${formatBoosts(item.bonuses)}`],
				...isCosmetic ? [] : [`**Resists:** ${formatBoosts(item.resists)}`],
				...item.modifies ? [`**Modifies:**: ${item.modifies}`]: []
			];
	
			if (item.skill) embedFields.push({
				name: 'Trinket Skill',
				value: [
					`\n**Effect:** ${item.skill.effect}`,
					`**Mana Cost:** ${item.skill.manaCost}`,
					`**Cooldown:** ${item.skill.cooldown}`,
					`**Damage Type:** ${capitalize(item.skill.damageType || 'N/A')}`,
					`**Element:** ${(item.skill.element || []).map(elem => capitalize(elem)).join(' / ') || 'N/A'}`
				],
				inline: true,
			});
		}

		if (item.images && item.images.length > 1)
			embedFields.push({
				name: 'Other Appearances',
				value: item.images
					.slice(1)
					.map((imageLink, index) => `[Appearance ${index + 2}](${imageLink})`)
					.join(', ')
			});
		// else if (item.images && item.images.length === 1 && item.images[0].includes('imgur')) {
		// 	description.push(`[Appearance](${item.images[0]})`);
		// }

		channel.send({ embed:
			{
				title: item.title,
				url: item.link,
				description: description.join('\n'),
				fields: embedFields,
				image: { url: item.images ? item.images[0] : null },
				footer: {
					text: item.colorCustom ?
						`This item is color-custom to your ${item.colorCustom.join(', ')} color`
						: null
				}
			}
		});
	},

	sortascending: 'sort',
	sortdescending: 'sort',
	sortasc: 'sort',
	sortdesc: 'sort',
	sort: async function ({ channel }, args, commandName) {
		const embed = (text, title, footer) => {
			const body = {};
			body.description = text;
			if (title) body.title = title;
			if (footer) body.footer = { text: footer };
			return { embed: body };
		};

		let [itemType, sortExp, maxLevel] = args
			.split(',')
			.map(arg => arg.trim().toLowerCase()) || [];
		if (!itemType || !sortExp)
			return await channel.send(embed(
				`Usage: ${CT}${commandName} \`item type\`, \`sort expression\`, \`max level (optional)\`\n` +
				`\`item type\` - Valid types are: _${[...validTypes].join(', ')}_. ` +
				"Abbreviations such as 'acc' and 'wep' also work.\n" +
				'If you are searching for a weapon, you may prefix the `item type` with an element ' +
				'to only get results for weapons of that element\n' +
				'`sort expression` can either be a single value or multiple values joined together by ' +
				'+ and/or - signs and/or brackets (). These "values" can be any stat bonus or resistance ' +
				'_(eg. STR, Melee Def, Bonus, All, Ice, Health, etc.)_, or in the case of weapons, _Damage_. ' +
				'Examples: _All + Health_, _-Health_, _INT - (DEX + STR)_, etc.\n' +
				`\`${CT}sort\` sorts in descending order. Use \`${CT}sortasc\` to sort in ascending order instead.`
			));
		if (maxLevel && maxLevel.match(/[^\-0-9]/)) {
			return await channel.send(embed(`"${maxLevel}" is not a valid number.`));
		}
		if (sortExp.length > 100) {
			return await channel.send(embed('Your sort expression cannot be longer than 100 characters.'));
		}

		maxLevel = Number(maxLevel);
		if (maxLevel < 0 || maxLevel > 90) {
			return await channel.send(
				embed(`The max level should be between 0 and 90 inclusive. ${maxLevel} is not valid.`)
			);
		}
		let sections = itemType.split(' ');
		[itemType] = sections.slice(-1);
		if (itemType.slice(-1) === 's') itemType = itemType.slice(0, -1); // strip trailing s
		const itemElement = sections.slice(0, -1).join(' ').trim();
		if (itemElement.length > 10) {
			return await channel.send(embed('That element name is too long.'));
		}

		if (itemType === 'wep') itemType = 'weapon';
		// "accessorie" because the trailing s would have been removed
		else if (itemType === 'acc' || itemType === 'accessorie') itemType = 'accessory';
		else if (itemType === 'helmet') itemType = 'helm';
		else if (itemType === 'wing') itemType = 'cape';
		if (!validTypes.has(itemType)) {
			return channel.send(embed(
				`"${itemType}" is not a valid item type. Valid types are: _${[...validTypes].join(', ')}_. ` +
				'"acc" and "wep" are valid abbreviations for accessories and weapons.'
			));
		}

		const db = await connect();
		let items = null;
		items = await db.collection(process.env.DB_COLLECTION);

		const filter = {
			newField: { $exists: true, $ne: 0 },
			category: itemType === 'weapon' ? 'weapon' : 'accessory',
			...!isNaN(maxLevel) && { level: { $lte: maxLevel } },
			$nor: [{ tags: 'default' }, { tags: { $all: ['temp', 'rare'] } }]
		};
		if (itemType === 'cape') filter.type = { $in: ['cape', 'wings'] };
		else if (!(itemType in { 'accessory': 1, 'weapon': 1 })) filter.type = itemType;

		if (itemElement) filter.elements = itemElement;

		const sortOrder = commandName in { 'sortasc': 1, 'sortascending': 1 } ? 1 : -1;

		let expressionParser;
		try {
			expressionParser = new ExpressionParser(sortExp);
		} catch (err) {
			if (err instanceof ProblematicExpressionError) {
				return await channel.send(embed(err.message));
			}
			throw err;
		}
		const mongoSortExp = expressionParser.mongoExpression();

		const pipeline = [
			{
				$addFields: {
					damage: { $avg: '$damage' },
					bonuses: { $arrayToObject: '$bonuses' },
					resists: { $arrayToObject: '$resists' }
				}
			},
			{ $addFields: { newField: mongoSortExp } },
			{ $match: filter },
			{ $sort: { newField: sortOrder, level: -1 } },
			// Remove documents that share the same pedia URL, only keep the max level version
			{ $group: { _id: { link: '$link' }, doc: { $first: '$$CURRENT' } } },
			// Remove documents that share the same item name
			{ $group: { _id: { name: '$doc.name' }, doc: { $first: '$doc' } } },
			// Group documents 
			{
				$group: {
					_id: '$doc.newField', newField: { $first: '$doc.newField' }, 
					items: { $addToSet: { title: '$doc.title', level: '$doc.level', tags: '$doc.tags' } }
				}
			},
			{ $sort: { newField: sortOrder, level: -1 } },
			{ $limit: 8 }
		];
		const results = items.aggregate(pipeline);

		let sorted = '';
		let itemGroup = null;
		let index = 0;
		while ((itemGroup = (await results.next())) !== null) {
			if (index > 1)
				itemGroup.items = itemGroup.items.filter(item => !(item.tags || []).includes('rare'));
			if (!itemGroup.items.length) continue;

			const items = itemGroup.items.map(item => {
				const tags = item.tags ? `[${item.tags.map(capitalize).join(', ')}]` : '';
				return `${item.title} _(lv. ${item.level})_ ${tags}`.trim();
			});
			const message = `**${++index})** ${items.join(' / ')} **_(${itemGroup.newField})_**\n\n`;
			if (message.length + sorted.length > 2048) break;
			sorted += message;
		}

		if (!sorted) return channel.send(embed('No results were found.'));

		let formattedItemType = '';
		if (itemType === 'accessory') formattedItemType = 'accessories';
		else formattedItemType = itemType.slice(-1) === 's' ? itemType : itemType + 's';
		formattedItemType = capitalize(formattedItemType);
		if (itemElement) formattedItemType = capitalize(itemElement) + ' ' + formattedItemType;

		const displayExpression = expressionParser.prettifyExpression();
		channel.send(
			embed(
				sorted.trim(),
				`Sort ${formattedItemType} by ${displayExpression}`,
				!isNaN(maxLevel) && maxLevel < 90 ? `Level capped at ${maxLevel} in results` : null
			)
		).catch(() => channel.send('An error occured'));
	},
};
