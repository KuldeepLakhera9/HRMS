import { Token } from './types.js';

export class Tokenizer {
  private input: string;
  private pos = 0;

  constructor(input: string) {
    if (input.length > 1000) {
      throw new Error('Formula exceeds maximum allowed length of 1000 characters');
    }
    this.input = input;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (!ch) break;

      // Whitespace
      if (/\s/.test(ch)) {
        this.pos++;
        continue;
      }

      const startPos = this.pos;

      // Numeric literal
      const nextCh = this.input[this.pos + 1] ?? '';
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(nextCh))) {
        let numStr = '';
        while (this.pos < this.input.length) {
          const curr = this.input[this.pos];
          if (curr && /[0-9.]/.test(curr)) {
            numStr += curr;
            this.pos++;
          } else {
            break;
          }
        }
        const val = parseFloat(numStr);
        if (Number.isNaN(val)) {
          throw new Error(`Invalid numeric literal '${numStr}' at position ${startPos}`);
        }
        tokens.push({ type: 'NUMBER', value: val, pos: startPos });
        continue;
      }

      // Identifier or keyword
      if (/[a-zA-Z_]/.test(ch)) {
        let ident = '';
        while (this.pos < this.input.length) {
          const curr = this.input[this.pos];
          if (curr && /[a-zA-Z0-9_]/.test(curr)) {
            ident += curr;
            this.pos++;
          } else {
            break;
          }
        }
        const lower = ident.toLowerCase();
        if (['and', 'or', 'not'].includes(lower)) {
          tokens.push({ type: 'OPERATOR', value: lower, pos: startPos });
        } else {
          tokens.push({ type: 'IDENTIFIER', value: ident, pos: startPos });
        }
        continue;
      }

      // Delimiters
      if (ch === '(') {
        tokens.push({ type: 'LPAREN', value: '(', pos: this.pos++ });
        continue;
      }
      if (ch === ')') {
        tokens.push({ type: 'RPAREN', value: ')', pos: this.pos++ });
        continue;
      }
      if (ch === ',') {
        tokens.push({ type: 'COMMA', value: ',', pos: this.pos++ });
        continue;
      }

      // Operators
      if (['+', '-', '*', '/', '%'].includes(ch)) {
        tokens.push({ type: 'OPERATOR', value: ch, pos: this.pos++ });
        continue;
      }
      if (ch === '=' && this.input[this.pos + 1] === '=') {
        tokens.push({ type: 'OPERATOR', value: '==', pos: this.pos });
        this.pos += 2;
        continue;
      }
      if (ch === '!' && this.input[this.pos + 1] === '=') {
        tokens.push({ type: 'OPERATOR', value: '!=', pos: this.pos });
        this.pos += 2;
        continue;
      }
      if (ch === '<') {
        if (this.input[this.pos + 1] === '=') {
          tokens.push({ type: 'OPERATOR', value: '<=', pos: this.pos });
          this.pos += 2;
        } else {
          tokens.push({ type: 'OPERATOR', value: '<', pos: this.pos++ });
        }
        continue;
      }
      if (ch === '>') {
        if (this.input[this.pos + 1] === '=') {
          tokens.push({ type: 'OPERATOR', value: '>=', pos: this.pos });
          this.pos += 2;
        } else {
          tokens.push({ type: 'OPERATOR', value: '>', pos: this.pos++ });
        }
        continue;
      }

      throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
    }

    tokens.push({ type: 'EOF', value: null, pos: this.pos });
    return tokens;
  }
}
