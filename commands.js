'use strict';

const { capitalize, embed, formatTag, formatBoosts, sanitizeText, validTypes } = require('./utils');

const connect = require('./db');
const { ExpressionParser, ProblematicExpressionError } = require('./expression-evaluation');

const aliases = {
	'adl': 'ancient dragonlord helm',
	'adsoe': 'ancient dragon amulet scythe of the elements',
	'ancient': 'ancient dragon amulet scythe of the elements',
	'aya': 'summon gem ayauhnqui ex',
	'ba': 'baltaels aventail',
	'blod': 'blinding light of destiny',
	'boa': 'blade of awe',
	'bod': 'blade of destiny',
	'bsw': 'baltaels aventail',
	'c7': 'the corrupted seven',
	'ddb': 'defenders dragon belt',
	'ddn': 'defenders dragon necklace',
	'ddr': 'defenders dragon ring',
	'ddsoe': 'doomed dragon amulet scythe of elementals',
	'ddv': 'distorted doom visage',
	'dm cannon': 'defender cannon',
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
	'scc': 'sea chickens conquest',
	'sf': 'soulforged scythe',
	'ublod': 'ultimate blinding light of destiny',
	'ultimate scythe': 'ultimate dragon amulet scythe of elementals',
	'uok': 'ultra omniknight blade',
	'ur mom': 'unsqueakable farce',
	'vik': 'vanilla ice katana',
	'vile rose': 'vile infused rose',
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
	// existingQuery.name = itemName;
	existingQuery.$text = { $search: '"' + itemName + '"' };

	const db = await connect();
	const items = await db.collection(process.env.DB_COLLECTION);

	const pipeline = [
		{ $match: existingQuery },
		// Temporary items are given least priority, followed by special offer, DC, and then rare items
		{
			$addFields: {
				priority: {
					$switch: {
						branches: [
							{ case: { $in: ['temp', '$tagSet.tags'] }, then: -4 },
							{ case: { $in: ['so', '$tagSet.tags'] }, then: -3 },
							{ case: { $in: ['dc', '$tagSet.tags'] }, then: -2 },
							{ case: { $in: ['rare', '$tagSet.tags'] }, then: -1 },
						],
						default: 0
					}
				},
				score: {
					$sum: [
						{ $sum: '$bonuses.v' },
						{ $multiply: ['$level', { $meta: 'textScore' }] }
					]
				}
			}
		},
		{ $sort: { score: -1, priority: -1 } },
		{ $limit: 1 }
	];
	let results = items.aggregate(pipeline);
	let item = await results.next();

	return item;
}

exports.commands = {
	wep: 'item',
	weap: 'item',
	weapon: 'item',
	sword: 'item',
	axe: 'item',
	mace: 'item',
	staff: 'item',
	wand: 'item',
	dagger: 'item',
	scythe: 'item',
	acc: 'item',
	accessory: 'item',
	belt: 'item',
	cape: 'item',
	wings: 'item',
	wing: 'item',
	helm: 'item',
	helmet: 'item',
	necklace: 'item',
	ring: 'item',
	trinket: 'item',
	bracer: 'item',
	item: async function ({ channel }, input, commandName) {
		if (!input) {
			return channel.send(embed(
				`Usage: ${CT}${commandName} \`[name]\` - Fetches the details of an item\n` +
				'_or_' +
				`${CT}${commandName} \`[name]\` \`(operator)\` \`level\` - Fetches the details of an item ` +
				'and filters based on `level`\n' +
				'`level` should be between 0 and 90 and `operator` must be one of the following: ' +
				'`=`, `<`, `>`, `<=`, `>=`, `!= or =/=`'
			));
		}

		const query = {};

		const mongoOperatorMapping = {
			'=': '$eq', '==': '$eq', '===': '$eq',
			'<': '$lt', '>': '$gt',
			'<=': '$lte', '/': '$lte', '=<': '$lte',
			'>=': '$gte', '=>': '$gte',
			'!=': '$ne', '=/=': '$ne'
		};
		const operators = Object.keys(mongoOperatorMapping).sort((a, b) => b.length - a.length);
		const opRegexp = new RegExp(operators.map(op => `(?:${op})`).join('|'));
		const opMatch = input.match(opRegexp);

		let itemName = input;
		if (opMatch) {
			const operator = opMatch ? opMatch[0] : null;
			itemName = input.slice(0, opMatch.index).trim();
			let levelFilter = input.slice(opMatch.index + operator.length).trim();

			if (!levelFilter || isNaN(levelFilter)) {
				return channel.send(embed('Either the operator you used or the number you entered is invalid.'));
			}

			levelFilter = Number(levelFilter);
			if (levelFilter < 0 || levelFilter > 90) {
				return channel.send(embed('The `level` filter must be between 0 and 90.'));
			}

			query.level = { [mongoOperatorMapping[operator]]: levelFilter };
		}

		if (commandName !== 'item') {
			query.category = 'weapon';
			if (commandName in { 'sword': 1, 'mace': 1, 'axe': 1 }) query.type = { $in: ['sword', 'mace', 'axe'] };
			else if (commandName in { 'staff': 1, 'wand': 1 }) query.type = { $in: ['staff', 'wand'] };
			else if (commandName in { 'dagger': 1, 'scythe': 1 }) query.type = commandName;

			else if (!(commandName in { 'wep': 1, 'weap': 1, 'weapon': 1 })) {
				query.category = 'accessory';

				if (commandName === 'helmet') query.type = 'helm';
				else if (commandName in { 'cape': 1, 'wings': 1, 'wing': 1 }) query.type = { $in: ['cape', 'wings'] };
				else if (!(commandName in { 'acc': 1, 'accessory': 1 })) query.type = commandName;
			}
		}

		const item = await getItem(itemName, query);
		if (!item) return channel.send('No item was found');

		const embedFields = [];
		let description = null;

		const isCosmetic = item.tags && item.tags.includes('cosmetic');
		const tagSet = item.tagSet
			.map(({ tags }) =>
				`\`${tags.map(formatTag).join(', ') || 'None'}\``
			)
			.join(' __or__ ');
		if (item.category === 'weapon') {
			description = [
				`**Tags:** ${tagSet}`,
				`**Level:** ${item.level}`,
				`**Type:** ${capitalize(item.type)}`,
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
				`**Tags:** ${tagSet}`,
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
