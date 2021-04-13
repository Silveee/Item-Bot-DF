'use strict';

class OperatorStack {
	constructor() {
		this.stack = [];
		// key = operand, value = priority
		this.operators = { '+': 1, '-': 1, '*': 2, '/': 2 };
	}
	insert(item) {
		const popped = [];
		if (item === '(') {
			this.stack.push(item);
		} else if (item === ')') {
			while (this.stack.length > 0 && this.stack[this.stack.length - 1] !== '(') {
				popped.push(this.stack.pop());
			}
			this.stack.pop(); // remove the '('
		} else if (item in this.operators) {
			const priority = this.operators[item];
			let top = this.stack.slice(-1)[0];
			// pop all operators with higher precedence than current
			while (top in this.operators && priority <= this.operators[top]) {
				popped.push(this.stack.pop());
				top = this.stack.slice(-1)[0];
			}
			this.stack.push(item);
		}
		return popped;
	}
	// isEmpty() {
	// 	return this.stack.length === 0;
	// }
}

module.exports = { OperatorStack };