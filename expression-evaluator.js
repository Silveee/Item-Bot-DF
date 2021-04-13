'use strict';

const MAX_OPERATORS = 5;
const OPERATORS = { '+': 1, '-': 1, 'u-': 2, 'u+': 2 };

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

// class TooManyBracketLevels extends Error {
// 	constructor() {
// 		super(`Your sort expression has too many redundant layers of parentheses in it.`);
// 	}
// }

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

			// Move all tokens until the last '(' into the result
			while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
				result.push(operatorStack.pop());
			}
			if (operatorStack[operatorStack.length - 1] === '(') operatorStack.pop(); // Remove the '('
			else throw new InvalidExpressionError('Make sure your brackets are balanced correctly.');
			lastTokenType = TokenTypes.CLOSE;

		} else if (token in OPERATORS) {
			// Operator is a unary operator if the previous token was either an open bracket or another operator
			const modifiedToken = [TokenTypes.OPEN, TokenTypes.OPERATOR].includes(lastTokenType) ? 'u' + token : token;
			const priority = OPERATORS[modifiedToken];
			let [top] = operatorStack.slice(-1);
			// Pop all operators with higher precedence than current
			while (top && top in OPERATORS && priority < OPERATORS[top]) {
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
			throw new InvalidExpressionError(
				'This sort expression is invalid. Make sure your parentheses are balanced correctly.'
			);
		}
		result.push(operator);
	}

	return result;
}
