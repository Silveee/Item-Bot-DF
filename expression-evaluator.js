'use strict';

const MAX_OPERATORS = 5;
const OPERATORS = {
	'+': { precedence: 1, unary: false, mongoFunc: '$add' },
	'-': { precedence: 1, unary: false, mongoFunc: '$subtract' },
	'u-': { precedence: 2, unary: true, mongoFunc: '$subtract' }
};

const bonuses = new Set([
	'block', 'dodge', 'parry', 'crit', 'magic def', 'pierce def', 'melee def',
	'wis', 'end', 'cha', 'luk', 'int', 'dex', 'str', 'bonus'
]);

class InvalidTokenInExpressionError extends Error {}

class InvalidExpressionError extends Error {
	constructor(message) {
		super(`Your sort expression is invalid. ${message}`);
	}
}

class TooManyOperatorsInExpressionError extends Error {
	constructor() {
		super(`Your sort expression cannot have more than ${MAX_OPERATORS} operators in it.`);
	}
}

function isResist(value) {
	if (bonuses.has(value) || value === 'damage') return false;
	return true;
}

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
function capitalize(text) {
	const fullCapWords = new Set([ // These words are fully capitalized
		'str', 'int', 'dex', 'luk', 'cha', 'dm', 'fs',
		'wis', 'end', 'dm', 'so', 'dc', 'da', 'ak'
	]);
	if (fullCapWords.has(text)) return text.toUpperCase();

	if (!text || !text.trim()) return text;

	return text
		.trim()
		.split(' ')
		.map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function tokenizeExpression(expression) {
	const tokenizedExpression = [];
	let operatorCount = 0;

	for (let i = 0; i < expression.length; ++i) {
		const token = expression[i].toLowerCase();
		if (token === ' ') continue;

		if (token in OPERATORS) {
			operatorCount += 1;
			if (operatorCount >= MAX_OPERATORS) throw new TooManyOperatorsInExpressionError();

			tokenizedExpression.push(token);
		}
		else if (token in { '(': 1, ')': 1 }) {
			tokenizedExpression.push(token);
		}
		else if (token.match(/[a-z?]/)) {
			let operand = '';
			while (i < expression.length && expression[i].toLowerCase().match(/[ a-z?]/)) {
				operand += expression[i].toLowerCase();
				i += 1;
			}
			i -= 1;
			tokenizedExpression.push(operand.trim());
		}
		else throw new InvalidTokenInExpressionError(`'${token}' is an invalid sort expression character.`);
	}
	return tokenizedExpression;
}

function infixToPostfix(expression) {
	const tokenizedExpression = tokenizeExpression(expression);
	const operatorStack = [];
	const result = [];

	const TokenTypes = { OPEN: 0, CLOSE: 1, OPERATOR: 2, OPERAND: 3 };

	let lastTokenType = null;
	for (const token of tokenizedExpression) {
		if (token === '(') {
			if (lastTokenType === TokenTypes.CLOSE) {
				throw new InvalidExpressionError('You cannot have an open bracket right after a close bracket.');
			}
			operatorStack.push(token);
			lastTokenType = TokenTypes.OPEN;

		} else if (token === ')') {
			if (lastTokenType === TokenTypes.OPERATOR) {
				throw new InvalidExpressionError('You cannot have a close bracket right after an operator.');
			}
			if (lastTokenType === TokenTypes.OPEN) {
				throw new InvalidExpressionError('Bracket pairs cannot be empty.');
			}

			// Move all tokens until the last '(' into the result
			while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
				result.push(operatorStack.pop());
			}
			if (operatorStack[operatorStack.length - 1] === '(') operatorStack.pop(); // Remove the '('
			else throw new InvalidExpressionError('Make sure your brackets are balanced correctly.');
			lastTokenType = TokenTypes.CLOSE;

		} else if (token in OPERATORS) {
			// Operator is a unary operator if the previous token was either an open bracket or another operator
			const modifiedToken = [
				TokenTypes.OPEN,
				TokenTypes.OPERATOR,
				null
			].includes(lastTokenType) ? 'u' + token : token;

			if (modifiedToken === 'u+') continue; // Unary + is redundant

			const priority = OPERATORS[modifiedToken];
			let [top] = operatorStack.slice(-1);
			// Pop all operators with higher precedence than current
			while (top && top in OPERATORS && priority <= OPERATORS[top]) {
				result.push(operatorStack.pop());
				[top] = operatorStack.slice(-1);
			}
			operatorStack.push(modifiedToken);
			lastTokenType = TokenTypes.OPERATOR;

		} else {
			if (lastTokenType === TokenTypes.CLOSE) {
				throw new InvalidExpressionError('You cannot have an operand right after a close bracket.');
			}
			lastTokenType = TokenTypes.OPERAND;
			result.push(token);
		}
	}

	while (operatorStack.length) {
		const operator = operatorStack.pop();
		if (operator in { '(': 1, ')': 1 }) {
			throw new InvalidExpressionError('Make sure your parentheses are balanced correctly.');
		}
		result.push(operator);
	}

	return result;
}

function prettifyExpression(postfixExpression) {
	const operandStack = [];
	for (const token of postfixExpression) {
		if (token in OPERATORS) {
			let topOperand = operandStack.pop();

			// Handle unary operators
			if (OPERATORS[token].unary) {
				operandStack.push(`(${token[1]}${topOperand})`);
			}
			// Handle binary operators
			else {
				const previousOperand = operandStack.pop();

				operandStack.push(`(${previousOperand} ${token} ${topOperand})`);
			}
		} else {
			operandStack.push(capitalize(isResist(token) ? `${token} res` : token));
		}
	}
	let result = operandStack.pop(); // There should only be 1 element
	if (result[0] === '(' && result[result.length - 1] === ')') result = result.slice(1, -1);

	return result;
}

function toMongoExpression(postfixExpression) {
	const mongoExpression = [];
	for (const token of postfixExpression) {
		if (token in OPERATORS) {
			const operator = OPERATORS[token];
			let topOperand = mongoExpression.pop();

			// Handle unary operators
			if (operator.unary) {
				mongoExpression.push({ [operator.mongoFunc]: [0, topOperand]});
			}
			// Handle binary operators
			else {
				const previousOperand = mongoExpression.pop();
				mongoExpression.push({ [operator.mongoFunc]: [previousOperand, topOperand] });
			}
		} else {
			if (token === 'damage') mongoExpression.push('$' + token);
			else if (bonuses.has(token)) mongoExpression.push('$bonuses.' + token);
			else mongoExpression.push('$resists.' + token);
		}
	}

	return mongoExpression.pop();
}
