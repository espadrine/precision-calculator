class Calculator {
  constructor() {
    this.parser = new Parser();
    this.evaluator = new Evaluator(this.parser);
  }
  compute(input) {
    const syntax = this.parser.parse(input);
    if (syntax.errors.length > 0) {
      return { result: null, tree: syntax.tree, errors: syntax.errors };
    }
    return this.evaluator.eval(syntax.tree);
  }
}

class Parser {
  parse(input) {
    const tree = new SyntaxTree(input);
    return { tree, errors: tree.errors };
  }
}

class SyntaxTree {
  constructor(input) {
    this.text = input;
    this.cursor = 0;
    this.line = 1;
    this.column = 1;
    this.errors = [];
    this.root = this.parseRoot();
  }

  parseRoot() {
    const expr = this.parseExpr();
    this.skipWhitespace();
    if (!this.endReached()) {
      this.addError('Trailing characters');
    }
    return expr;
  }

  parseExpr() {
    this.skipWhitespace();
    let node = this.newNode(SyntaxTreeNode.type.expr);

    const rest = this.read(this.text.length);
    const type = SyntaxTreeNode.nameFromType.findIndex(type =>
      SyntaxTreeNode.token[type].test(rest));
    switch (type) {
      case SyntaxTreeNode.type.number:
        node = this.parseNumber();
        break;
      case SyntaxTreeNode.type.paren:
        node = this.parseParen();
        break;
      case SyntaxTreeNode.type.sep:
        break;  // End of the expression.
      case SyntaxTreeNode.type.prefixOp:
        node.type = type;
        node.operator = SyntaxTreeNode.funcFromOperator[this.read()];
        this.advance();
        const prefixExpr = this.parseExpr();
        node.children = [prefixExpr];
        break;
      case SyntaxTreeNode.type.binFunc:
      case SyntaxTreeNode.type.unaFunc:
        node.children.push(this.parseFunction(type));
        break;
      default:
        this.addError("Invalid expression");
        this.advance();
    }
    this.closeNode(node);

    // Infix operators.
    this.skipWhitespace();
    if (SyntaxTreeNode.token.infixOp.test(this.read())) {
      const operator = SyntaxTreeNode.funcFromOperator[this.read()];
      if (!operator) {
        throw new Error(`Invalid operator type ${this.read()}`);
      }

      // The expression to return is an infix operation.
      const firstOperand = node;
      this.closeNode(firstOperand);

      node = this.newNode(SyntaxTreeNode.type.infixOp);
      node.startAlong(firstOperand);
      node.operator = operator;
      this.advance();

      const secondOperand = this.parseExpr();
      node.children = [firstOperand, secondOperand];

      // Handle associativity.
      if (secondOperand.type === SyntaxTreeNode.token.infixOp &&
          SyntaxTreeNode.operatorAssociativity.get(              operator) >
          SyntaxTreeNode.operatorAssociativity.get(secondOperand.operator)) {
        // In this situation, we must promote the second operator to toplevel.
        //    [firstOperand <operator> [second[0] <secondOperator> second[1]]]
        // → [[firstOperand <operator> second[0]] <secondOperator> second[1]]
        const newFirstOperand = this.newNode(SyntaxTreeNode.type.infixOp);
        newFirstOperand.startAlong(firstOperand);
        newFirstOperand.endAlong(secondOperand.children[0]);
        newFirstOperand.operator = operator;
        newFirstOperand.children = [firstOperand, secondOperand.children[0]];
        node.operator = secondOperand.operator;
        node.children = [newFirstOperand, secondOperand.children[1]];
      }
      this.closeNode(node);
    }

    // Postfix operators.

    return node;
  }

  // Expression of the form "12.5"
  parseNumber() {
    this.skipWhitespace();
    const node = this.newNode(SyntaxTreeNode.type.number);

    const rest = this.read(this.text.length);
    const match = SyntaxTreeNode.token.number.exec(rest);
    this.advance(match[0].length);
    node.number = Number(match[0].replace(/_/g, ''));

    this.closeNode(node);
    return node;
  }

  // Expression of the form "(…, …)"
  parseParen() {
    this.skipWhitespace();
    const node = this.newNode(SyntaxTreeNode.type.paren);

    if (this.read() !== '(') {  // We only throw when it should never happen.
      throw new Error("Invalid paren does not start with a parenthesis");
    }
    this.advance();
    this.skipWhitespace();

    let closingParenReached = false;
    while (!closingParenReached && this.cursor < this.text.length) {
      node.children.push(this.parseExpr());
      this.skipWhitespace();
      switch (this.read()) {
        case ',':
          this.advance();
          this.skipWhitespace();
          break;
        case ')':
          this.advance();
          closingParenReached = true;
          break;
        default:
          this.addError("Invalid character in parenthesized expression");
          this.advance();
      }
    }
    this.closeNode(node);
    return node;
  }

  // Read the next n characters.
  read(n = 1) {
    return this.text.slice(this.cursor, this.cursor + n);
  }

  // Advance the cursor by n characters.
  advance(n = 1) {
    for (let i = this.cursor; i < this.cursor + n; i++) {
      if (this.text[i] === '\n') {
        this.line++;
        this.column = 1;
      } else {
        this.column++;
      }
    }
    this.cursor += n;
  }

  skipWhitespace() {
    while (/^[ \t\n]/.test(this.read())) {
      this.advance();
    }
  }

  endReached() {
    return this.cursor >= this.text.length;
  }

  newNode(type) {
    return new SyntaxTreeNode(
      type, this.cursor, this.cursor + 1, this.line, this.column, this.text);
  }

  closeNode(node) {
    node.end = this.cursor;
    node.endLine = this.line;
    node.endColumn = this.column;
    node.text = this.text.slice(node.start, node.end);
  }

  addError(message) {
    this.errors.push(new SyntaxTreeError(message, this.line, this.column));
  }

  toString() {
    return this.root.toString();
  }
}

class SyntaxTreeNode {
  constructor(type, start, end, startLine, startColumn, text) {
    this.type = type;
    this.text = text;
    this.children = [];
    this.operator = null;
    this.number = null;
    this.start = start;
    this.end = end;
    this.startLine = this.endLine = startLine;
    this.startColumn = this.endColumn = startColumn;
  }

  startAlong(node) {
    this.start = node.start;
    this.startLine = node.startLine;
    this.startColumn = node.startColumn;
  }

  endAlong(node) {
    this.end = node.end;
    this.endLine = node.endLine;
    this.endColumn = node.endColumn;
  }

  toString() {
    const info =
      (this.type === SyntaxTreeNode.type.number)?       this.number   + ' ':
      (this.type === SyntaxTreeNode.type.prefixOp)?     this.operator + ' ':
      (this.type === SyntaxTreeNode.type.infixOp)?      this.operator + ' ':
      (this.type === SyntaxTreeNode.type.postfixOp)?    this.operator + ' ':
      '';
    const curText =
      `${this.startLine}:${this.startColumn}-` +
      `${this.endLine}:${this.endColumn} ` +
      `${SyntaxTreeNode.nameFromType[this.type]} ` +
      `${info}${JSON.stringify(this.text)}`;
    const childrenText = this.children.map(c =>
      c.toString().split('\n')
      .map(line => `  ${line}`)
      .join('\n'))
    .join('\n');
    return curText + ((this.children.length > 0)? `\n${childrenText}`: "");
  }
}

class SyntaxTreeError {
  constructor(message, line, column) {
    this.message = message;
    this.line = line;
    this.column = column;
  }
  toString() {
    return `${this.line}:${this.column}: ${this.message}`;
  }
}

// Node types.
SyntaxTreeNode.type = {
  root:         0,
  expr:         1,
  number:       2,
  paren:        3,
  sep:          4,
  prefixOp:     5,
  infixOp:      6,
  postfixOp:    7,
  binFunc:      8,
  unaFunc:      9,
};
SyntaxTreeNode.nameFromType = Object.keys(SyntaxTreeNode.type);

SyntaxTreeNode.token = {
  root:         /[]/,
  expr:         /[]/,
  number:       /^[0-9_]+(\.[0-9_]+)?([eE][0-9_]+)?/,
  paren:        /^\(/,
  sep:          /^,/,
  prefixOp:     /^[+-]/,
  infixOp:      /^([+\-*×/÷%^]|\*\*)/,  // If you add an operator, add its precedence in operatorAssociativity.
  postfixOp:    /^[!]/,
  binFunc:      /^(rootn|dim|atan2|gammaInc|beta|jn|yn|agm|hypot|fmod|remainder|min|max)\b/,
  unaFunc:      /^(sqr|sqrt|recSqrt|cbrt|neg|abs|log|ln|log2|log10|log1p|exp|exp2|exp10|expm1|cos|sin|tan|sec|csc|cot|acos|asin|atan|cosh|sinh|tanh|sech|csch|coth|acosh|asinh|atanh|fac|factorial|eint|li2|gamma|lngamma|digamma|zeta|erf|erfc|j0|j1|y0|y1|rint|rintCeil|rintFloor|rintRound|rintRoundeven|rintTrunc|frac)\b/,
};

SyntaxTreeNode.operators = [..."+-*×/÷%^", "**", "!"];
SyntaxTreeNode.operatorAssociativity =
  SyntaxTreeNode.operators.reduce((a, o, i) => a.set(o, i), new Map());
SyntaxTreeNode.funcFromOperator = {
  '+':  "add",
  '-':  "sub",
  '*':  "mul",
  '×':  "mul",
  '/':  "div",
  '÷':  "div",
  '%':  "remainder",
  '^':  "pow",
  '**': "pow",
  '!':  "fac",
};

class Evaluator {
  constructor(mpf = this.mpf) { this.mpf = mpf; }

  eval(tree) {
    const result = null, errors = [];
    return { result, tree, errors };
  }
}

export default Calculator;
