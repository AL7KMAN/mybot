const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class LuaLexer {
    constructor(code) {
        this.code = code;
        this.pos = 0;
        this.len = code.length;
        this.tokens = [];
        this.line = 1;
        this.column = 1;
        this.keywords = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
        this.symbols = new Set(['+', '-', '*', '/', '%', '^', '#', '==', '~=', '<=', '>=', '<', '>', '=', '(', ')', '{', '}', '[', ']', ';', ':', ',', '.', '..', '...', '//', '::']);
    }
    peek(offset = 0) { return this.code[this.pos + offset]; }
    advance() {
        const char = this.code[this.pos++];
        if (char === '\n') { this.line++; this.column = 1; } 
        else { this.column++; }
        return char;
    }
    match(str) {
        if (this.code.startsWith(str, this.pos)) {
            for (let i = 0; i < str.length; i++) this.advance();
            return true;
        }
        return false;
    }
    error(msg) { throw new Error(`Lexer Error at ${this.line}:${this.column} - ${msg}`); }
    tokenize() {
        while (this.pos < this.len) {
            let char = this.peek();
            if (/\s/.test(char)) { this.advance(); continue; }
            if (char === '#' && this.pos === 0) { while (this.pos < this.len && this.peek() !== '\n') this.advance(); continue; }
            if (char === '-' && this.peek(1) === '-') { this.readComment(); continue; }
            if (char === '"' || char === "'") { this.readString(char); continue; }
            if (char === '[') {
                let eq = 0, p = this.pos + 1;
                while (this.code[p] === '=') { eq++; p++; }
                if (this.code[p] === '[') { this.readLongString(eq); continue; }
            }
            if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(this.peek(1)))) { this.readNumber(); continue; }
            if (/[a-zA-Z_]/.test(char)) { this.readIdentifier(); continue; }
            this.readSymbol();
        }
        this.tokens.push({ type: 'EOF', value: null, line: this.line, column: this.column });
        return this.tokens;
    }
    readComment() {
        this.advance(); this.advance();
        if (this.peek() === '[') {
            let eq = 0, p = this.pos + 1;
            while (this.code[p] === '=') { eq++; p++; }
            if (this.code[p] === '[') {
                const closeStr = ']' + '='.repeat(eq) + ']';
                const end = this.code.indexOf(closeStr, p + 1);
                if (end !== -1) { while (this.pos <= end + closeStr.length) this.advance(); return; }
            }
        }
        while (this.pos < this.len && this.peek() !== '\n') this.advance();
    }
    readString(quote) {
        this.advance();
        let start = this.pos, startLine = this.line, startCol = this.column;
        while (this.pos < this.len) {
            let char = this.advance();
            if (char === '\\') { this.advance(); continue; }
            if (char === quote) break;
            if (char === '\n') this.error("Unterminated string");
        }
        this.tokens.push({ type: 'String', value: this.code.slice(start, this.pos - 1), quote: quote, line: startLine, column: startCol });
    }
    readLongString(eq) {
        const open = '[' + '='.repeat(eq) + '[', close = ']' + '='.repeat(eq) + ']';
        let startLine = this.line, startCol = this.column;
        for (let i = 0; i < open.length; i++) this.advance();
        let start = this.pos, end = this.code.indexOf(close, this.pos);
        if (end === -1) this.error("Unterminated long string");
        let value = this.code.slice(start, end);
        while (this.pos <= end + close.length) this.advance();
        this.tokens.push({ type: 'String', value: value, quote: open, isLong: true, line: startLine, column: startCol });
    }
    readNumber() {
        let start = this.pos, startLine = this.line, startCol = this.column;
        if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
            this.advance(); this.advance();
            while (/[0-9a-fA-F]/.test(this.peek())) this.advance();
        } else {
            while (/[0-9.]/.test(this.peek())) this.advance();
            if (this.peek() === 'e' || this.peek() === 'E') {
                this.advance();
                if (this.peek() === '+' || this.peek() === '-') this.advance();
                while (/[0-9]/.test(this.peek())) this.advance();
            }
        }
        this.tokens.push({ type: 'Number', value: this.code.slice(start, this.pos), line: startLine, column: startCol });
    }
    readIdentifier() {
        let start = this.pos, startLine = this.line, startCol = this.column;
        while (/[a-zA-Z0-9_]/.test(this.peek())) this.advance();
        let word = this.code.slice(start, this.pos);
        this.tokens.push({ type: this.keywords.has(word) ? 'Keyword' : 'Identifier', value: word, line: startLine, column: startCol });
    }
    readSymbol() {
        let startLine = this.line, startCol = this.column;
        if (this.match('...')) { this.tokens.push({ type: 'Symbol', value: '...', line: startLine, column: startCol }); return; }
        const twoChar = this.code.slice(this.pos, this.pos + 2);
        if (['==', '~=', '<=', '>=', '..', '//', '::'].includes(twoChar)) {
            this.advance(); this.advance();
            this.tokens.push({ type: 'Symbol', value: twoChar, line: startLine, column: startCol }); return;
        }
        const char = this.advance();
        this.tokens.push({ type: 'Symbol', value: char, line: startLine, column: startCol });
    }
}

class LuaParser {
    constructor(tokens) { this.tokens = tokens; this.pos = 0; }
    peek(offset = 0) { return this.tokens[this.pos + offset] || { type: 'EOF', value: null, line: 0, column: 0 }; }
    advance() { return this.tokens[this.pos++]; }
    match(type, value) {
        const t = this.peek();
        if (t.type === type && (value === undefined || t.value === value)) return this.advance();
        return null;
    }
    expect(type, value) {
        const t = this.match(type, value);
        if (!t) throw new Error(`Parser Error at ${this.peek().line}:${this.peek().column} - Expected ${type} ${value || ''}`);
        return t;
    }
    parse() { const body = this.parseBlock(); this.expect('EOF'); return { type: 'Chunk', body }; }
    parseBlock() {
        const statements = [];
        const terminators = new Set(['end', 'else', 'elseif', 'until', 'EOF']);
        while (this.peek().type !== 'EOF' && !terminators.has(this.peek().value)) {
            if (this.match('Symbol', ';')) continue;
            statements.push(this.parseStatement());
        }
        return statements;
    }
    parseStatement() {
        const t = this.peek();
        if (t.type === 'Keyword') {
            switch (t.value) {
                case 'local': return this.parseLocal();
                case 'function': return this.parseFunctionStatement();
                case 'if': return this.parseIf();
                case 'for': return this.parseFor();
                case 'while': return this.parseWhile();
                case 'repeat': return this.parseRepeat();
                case 'do': return this.parseDo();
                case 'return': return this.parseReturn();
                case 'break': this.advance(); return { type: 'BreakStatement', line: t.line };
            }
        }
        return this.parseAssignmentOrCall();
    }
    parseLocal() {
        const t = this.expect('Keyword', 'local');
        if (this.peek().type === 'Keyword' && this.peek().value === 'function') {
            this.advance();
            return { type: 'LocalFunctionStatement', name: this.expect('Identifier').value, func: this.parseFunctionBody(), line: t.line };
        }
        const names = [];
        do { names.push(this.expect('Identifier').value); } while (this.match('Symbol', ','));
        let init = [];
        if (this.match('Symbol', '=')) init = this.parseExpressionList();
        return { type: 'LocalStatement', names, init, line: t.line };
    }
    parseFunctionStatement() {
        const t = this.expect('Keyword', 'function');
        let name = this.expect('Identifier').value;
        while (this.match('Symbol', '.')) name += '.' + this.expect('Identifier').value;
        let isMethod = false;
        if (this.match('Symbol', ':')) { name += ':' + this.expect('Identifier').value; isMethod = true; }
        return { type: 'FunctionStatement', name, func: this.parseFunctionBody(isMethod), line: t.line };
    }
    parseFunctionBody(isMethod = false) {
        this.expect('Symbol', '(');
        const params = [];
        if (isMethod) params.push('self');
        if (this.peek().value !== ')') {
            do { params.push(this.peek().value === '...' ? this.advance().value : this.expect('Identifier').value); } while (this.match('Symbol', ','));
        }
        this.expect('Symbol', ')');
        const body = this.parseBlock();
        this.expect('Keyword', 'end');
        return { type: 'FunctionExpression', params, body };
    }
    parseIf() {
        const t = this.expect('Keyword', 'if');
        const clauses = [{ cond: this.parseExpression(), body: (this.expect('Keyword', 'then'), this.parseBlock()) }];
        while (this.peek().value === 'elseif') {
            this.advance();
            clauses.push({ cond: this.parseExpression(), body: (this.expect('Keyword', 'then'), this.parseBlock()) });
        }
        let elseBody = null;
        if (this.match('Keyword', 'else')) elseBody = this.parseBlock();
        this.expect('Keyword', 'end');
        return { type: 'IfStatement', clauses, elseBody, line: t.line };
    }
    parseFor() {
        const t = this.expect('Keyword', 'for');
        const name1 = this.expect('Identifier').value;
        if (this.match('Symbol', '=')) {
            const start = this.parseExpression();
            this.expect('Symbol', ',');
            const end = this.parseExpression();
            let step = null;
            if (this.match('Symbol', ',')) step = this.parseExpression();
            this.expect('Keyword', 'do');
            const body = this.parseBlock();
            this.expect('Keyword', 'end');
            return { type: 'NumericForStatement', name: name1, start, end, step, body, line: t.line };
        }
        const names = [name1];
        while (this.match('Symbol', ',')) names.push(this.expect('Identifier').value);
        this.expect('Keyword', 'in');
        const exprs = this.parseExpressionList();
        this.expect('Keyword', 'do');
        const body = this.parseBlock();
        this.expect('Keyword', 'end');
        return { type: 'GenericForStatement', names, exprs, body, line: t.line };
    }
    parseWhile() {
        const t = this.expect('Keyword', 'while');
        const cond = this.parseExpression();
        this.expect('Keyword', 'do');
        const body = this.parseBlock();
        this.expect('Keyword', 'end');
        return { type: 'WhileStatement', cond, body, line: t.line };
    }
    parseRepeat() {
        const t = this.expect('Keyword', 'repeat');
        const body = this.parseBlock();
        this.expect('Keyword', 'until');
        return { type: 'RepeatStatement', body, cond: this.parseExpression(), line: t.line };
    }
    parseDo() {
        const t = this.expect('Keyword', 'do');
        const body = this.parseBlock();
        this.expect('Keyword', 'end');
        return { type: 'DoStatement', body, line: t.line };
    }
    parseReturn() {
        const t = this.expect('Keyword', 'return');
        let exprs = [];
        const next = this.peek();
        if (next.type !== 'EOF' && !['end', 'else', 'elseif', 'until', ';'].includes(next.value)) exprs = this.parseExpressionList();
        this.match('Symbol', ';');
        return { type: 'ReturnStatement', exprs, line: t.line };
    }
    parseAssignmentOrCall() {
        const t = this.peek();
        const expr = this.parsePrimaryExpression();
        if (this.peek().type === 'Symbol' && (this.peek().value === '=' || this.peek().value === ',')) {
            const targets = [expr];
            while (this.match('Symbol', ',')) targets.push(this.parsePrimaryExpression());
            this.expect('Symbol', '=');
            return { type: 'AssignmentStatement', targets, values: this.parseExpressionList(), line: t.line };
        }
        return { type: 'CallStatement', expression: expr, line: t.line };
    }
    parseExpressionList() {
        const exprs = [this.parseExpression()];
        while (this.match('Symbol', ',')) exprs.push(this.parseExpression());
        return exprs;
    }
    parseExpression() { return this.parseOr(); }
    parseOr() {
        let expr = this.parseAnd();
        while (this.match('Keyword', 'or')) expr = { type: 'BinaryExpression', operator: 'or', left: expr, right: this.parseAnd() };
        return expr;
    }
    parseAnd() {
        let expr = this.parseComparison();
        while (this.match('Keyword', 'and')) expr = { type: 'BinaryExpression', operator: 'and', left: expr, right: this.parseComparison() };
        return expr;
    }
    parseComparison() {
        let expr = this.parseConcat();
        while (this.peek().type === 'Symbol' && ['<', '>', '<=', '>=', '~=', '=='].includes(this.peek().value)) {
            expr = { type: 'BinaryExpression', operator: this.advance().value, left: expr, right: this.parseConcat() };
        }
        return expr;
    }
    parseConcat() {
        let expr = this.parseAdd();
        while (this.match('Symbol', '..')) expr = { type: 'BinaryExpression', operator: '..', left: expr, right: this.parseAdd() };
        return expr;
    }
    parseAdd() {
        let expr = this.parseMul();
        while (this.peek().type === 'Symbol' && ['+', '-'].includes(this.peek().value)) {
            expr = { type: 'BinaryExpression', operator: this.advance().value, left: expr, right: this.parseMul() };
        }
        return expr;
    }
    parseMul() {
        let expr = this.parseUnary();
        while (this.peek().type === 'Symbol' && ['*', '/', '%', '//'].includes(this.peek().value)) {
            expr = { type: 'BinaryExpression', operator: this.advance().value, left: expr, right: this.parseUnary() };
        }
        return expr;
    }
    parseUnary() {
        if (this.match('Keyword', 'not')) return { type: 'UnaryExpression', operator: 'not', argument: this.parseUnary() };
        if (this.peek().type === 'Symbol' && ['-', '#'].includes(this.peek().value)) {
            return { type: 'UnaryExpression', operator: this.advance().value, argument: this.parseUnary() };
        }
        return this.parsePower();
    }
    parsePower() {
        let expr = this.parsePrimaryExpression();
        if (this.match('Symbol', '^')) expr = { type: 'BinaryExpression', operator: '^', left: expr, right: this.parseUnary() };
        return expr;
    }
    parsePrimaryExpression() {
        const t = this.peek();
        if (t.type === 'Keyword') {
            if (t.value === 'nil') { this.advance(); return { type: 'NilLiteral' }; }
            if (t.value === 'true' || t.value === 'false') { this.advance(); return { type: 'BooleanLiteral', value: t.value === 'true' }; }
            if (t.value === 'function') { this.advance(); return this.parseFunctionBody(); }
        }
        if (t.type === 'Number') { this.advance(); return { type: 'NumberLiteral', value: t.value }; }
        if (t.type === 'String') { this.advance(); return { type: 'StringLiteral', value: t.value, quote: t.quote, isLong: t.isLong }; }
        if (t.type === 'Identifier') { this.advance(); return this.parseSuffixes({ type: 'Identifier', name: t.value }); }
        if (t.type === 'Symbol') {
            if (t.value === '(') {
                this.advance();
                const expr = this.parseExpression();
                this.expect('Symbol', ')');
                return this.parseSuffixes(expr);
            }
            if (t.value === '{') return this.parseTableConstructor();
            if (t.value === '...') { this.advance(); return { type: 'VarargLiteral' }; }
        }
        throw new Error(`Parser Error at ${t.line}:${t.column} - Unexpected token: ${t.type} ${t.value}`);
    }
    parseSuffixes(expr) {
        while (true) {
            if (this.match('Symbol', '.')) expr = { type: 'MemberExpression', object: expr, property: this.expect('Identifier').value };
            else if (this.match('Symbol', '[')) {
                const prop = this.parseExpression();
                this.expect('Symbol', ']');
                expr = { type: 'IndexExpression', object: expr, index: prop };
            } else if (this.match('Symbol', ':')) {
                expr = { type: 'MethodCallExpression', object: expr, method: this.expect('Identifier').value, args: this.parseCallArguments() };
            } else if (this.peek().value === '(' || this.peek().value === '{' || this.peek().type === 'String') {
                expr = { type: 'CallExpression', base: expr, args: this.parseCallArguments() };
            } else break;
        }
        return expr;
    }
    parseCallArguments() {
        if (this.match('Symbol', '(')) {
            const args = [];
            if (this.peek().value !== ')') { do { args.push(this.parseExpression()); } while (this.match('Symbol', ',')); }
            this.expect('Symbol', ')');
            return args;
        }
        if (this.peek().value === '{') return [this.parseTableConstructor()];
        if (this.peek().type === 'String') return [this.parsePrimaryExpression()];
        throw new Error("Parser Error - Expected call arguments");
    }
    parseTableConstructor() {
        this.expect('Symbol', '{');
        const fields = [];
        while (this.peek().value !== '}') {
            if (this.match('Symbol', '[')) {
                const key = this.parseExpression();
                this.expect('Symbol', ']');
                this.expect('Symbol', '=');
                fields.push({ type: 'TableKey', key, value: this.parseExpression() });
            } else if (this.peek().type === 'Identifier' && this.peek(1).value === '=') {
                const key = this.advance().value;
                this.advance();
                fields.push({ type: 'TableKeyString', key, value: this.parseExpression() });
            } else fields.push({ type: 'TableValue', value: this.parseExpression() });
            if (!this.match('Symbol', ',') && !this.match('Symbol', ';')) break;
        }
        this.expect('Symbol', '}');
        return { type: 'TableConstructor', fields };
    }
}

class LuaTransformer {
    constructor() {
        this.scopes = [new Map()];
        this.counters = { var: 1, table: 1, func: 1, param: 1, global: 1, index: 1, value: 1 };
        this.typeInference = new Map();
    }
    enterScope() { this.scopes.push(new Map()); }
    exitScope() { this.scopes.pop(); }
    declare(name, newNameBase) {
        let finalName = newNameBase, counter = 1;
        const currentScope = this.scopes[this.scopes.length - 1];
        while (Array.from(currentScope.values()).includes(finalName) || Array.from(this.scopes[0].values()).includes(finalName)) {
            finalName = newNameBase + '_' + counter++;
        }
        currentScope.set(name, finalName);
        return finalName;
    }
    lookup(name) {
        for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(name)) return this.scopes[i].get(name);
        return null;
    }
    transform(ast) { this.inferTypes(ast); this.transformChunk(ast); return ast; }
    inferTypes(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'LocalStatement' && node.init.length === 1 && node.init[0].type === 'CallExpression') {
            const call = node.init[0];
            if (call.base.type === 'MemberExpression' && call.base.object.name === 'game' && call.base.property === 'GetService' && call.args[0]) {
                this.typeInference.set(node.names[0], { type: 'service', value: call.args[0].value });
            } else if (call.base.type === 'MemberExpression' && call.base.object.name === 'Instance' && call.base.property === 'new' && call.args[0]) {
                this.typeInference.set(node.names[0], { type: 'instance', value: call.args[0].value });
            }
        }
        for (let key in node) {
            if (node[key] && typeof node[key] === 'object') {
                if (Array.isArray(node[key])) node[key].forEach(n => this.inferTypes(n));
                else this.inferTypes(node[key]);
            }
        }
    }
    transformChunk(node) { node.body = node.body.map(s => this.transformStatement(s)); }
    transformStatement(node) {
        if (!node) return node;
        switch (node.type) {
            case 'LocalStatement':
                node.init = node.init.map(e => this.transformExpression(e));
                node.names = node.names.map(n => {
                    const inferred = this.typeInference.get(n);
                    if (inferred) {
                        const clean = inferred.value.replace(/[^a-zA-Z0-9_]/g, "");
                        if (inferred.type === 'service') return this.declare(n, clean + '_Service');
                        if (inferred.type === 'instance') return this.declare(n, clean + '_Instance');
                    }
                    if (node.init.length === 1 && node.init[0].type === 'TableConstructor') return this.declare(n, 'Table_' + this.counters.table++);
                    if (node.init.length === 1 && node.init[0].type === 'FunctionExpression') return this.declare(n, 'Function_' + this.counters.func++);
                    return this.declare(n, 'Var_' + this.counters.var++);
                });
                return node;
            case 'LocalFunctionStatement':
                node.name = this.declare(node.name, 'Function_' + this.counters.func++);
                this.enterScope();
                node.func.params = node.func.params.map(p => this.declare(p, 'Param_' + this.counters.param++));
                node.func.body = node.func.body.map(s => this.transformStatement(s));
                this.exitScope();
                return node;
            case 'FunctionStatement':
                this.enterScope();
                node.func.params = node.func.params.map(p => this.declare(p, 'Param_' + this.counters.param++));
                node.func.body = node.func.body.map(s => this.transformStatement(s));
                this.exitScope();
                return node;
            case 'AssignmentStatement':
                node.values = node.values.map(e => this.transformExpression(e));
                node.targets = node.targets.map(e => this.transformExpression(e));
                return node;
            case 'CallStatement': node.expression = this.transformExpression(node.expression); return node;
            case 'IfStatement':
                node.clauses = node.clauses.map(c => {
                    c.cond = this.transformExpression(c.cond);
                    this.enterScope();
                    c.body = c.body.map(s => this.transformStatement(s));
                    this.exitScope();
                    return c;
                });
                if (node.elseBody) {
                    this.enterScope();
                    node.elseBody = node.elseBody.map(s => this.transformStatement(s));
                    this.exitScope();
                }
                return node;
            case 'NumericForStatement':
                node.start = this.transformExpression(node.start);
                node.end = this.transformExpression(node.end);
                if (node.step) node.step = this.transformExpression(node.step);
                this.enterScope();
                node.name = this.declare(node.name, 'Index_' + this.counters.index++);
                node.body = node.body.map(s => this.transformStatement(s));
                this.exitScope();
                return node;
            case 'GenericForStatement':
                node.exprs = node.exprs.map(e => this.transformExpression(e));
                this.enterScope();
                node.names = node.names.map(n => this.declare(n, 'Value_' + this.counters.value++));
                node.body = node.body.map(s => this.transformStatement(s));
                this.exitScope();
                return node;
            case 'WhileStatement':
                node.cond = this.transformExpression(node.cond);
                this.enterScope();
                node.body = node.body.map(s => this.transformStatement(s));
                this.exitScope();
                return node;
            case 'RepeatStatement':
                this.enterScope();
                node.body = node.body.map(s => this.transformStatement(s));
                node.cond = this.transformExpression(node.cond);
                this.exitScope();
                return node;
            case 'DoStatement':
                this.enterScope();
                node.body = node.body.map(s => this.transformStatement(s));
                this.exitScope();
                return node;
            case 'ReturnStatement': node.exprs = node.exprs.map(e => this.transformExpression(e)); return node;
        }
        return node;
    }
    transformExpression(node) {
        if (!node) return node;
        switch (node.type) {
            case 'Identifier':
                const mapped = this.lookup(node.name);
                return mapped ? { type: 'Identifier', name: mapped } : node;
            case 'BinaryExpression': node.left = this.transformExpression(node.left); node.right = this.transformExpression(node.right); return node;
            case 'UnaryExpression': node.argument = this.transformExpression(node.argument); return node;
            case 'MemberExpression': node.object = this.transformExpression(node.object); return node;
            case 'IndexExpression': node.object = this.transformExpression(node.object); node.index = this.transformExpression(node.index); return node;
            case 'CallExpression': node.base = this.transformExpression(node.base); node.args = node.args.map(a => this.transformExpression(a)); return node;
            case 'MethodCallExpression': node.object = this.transformExpression(node.object); node.args = node.args.map(a => this.transformExpression(a)); return node;
            case 'TableConstructor': node.fields = node.fields.map(f => { if (f.key) f.key = this.transformExpression(f.key); f.value = this.transformExpression(f.value); return f; }); return node;
            case 'FunctionExpression':
                this.enterScope();
                node.params = node.params.map(p => this.declare(p, 'Param_' + this.counters.param++));
                node.body = node.body.map(s => this.transformStatement(s));
                this.exitScope();
                return node;
        }
        return node;
    }
}

class LuaGenerator {
    constructor() { this.indentStr = '    '; }
    generate(ast) { return this.printBlock(ast.body, 0); }
    printBlock(body, indent) { return body.map(stmt => this.printStatement(stmt, indent)).join('\n'); }
    printStatement(node, indent) {
        const ind = this.indentStr.repeat(indent);
        if (!node) return '';
        switch (node.type) {
            case 'LocalStatement':
                let lstr = ind + 'local ' + node.names.join(', ');
                if (node.init.length > 0) lstr += ' = ' + node.init.map(e => this.printExpression(e)).join(', ');
                return lstr;
            case 'LocalFunctionStatement':
                return ind + 'local function ' + node.name + '(' + node.func.params.join(', ') + ')\n' + this.printBlock(node.func.body, indent + 1) + '\n' + ind + 'end';
            case 'FunctionStatement':
                return ind + 'function ' + node.name + '(' + node.func.params.join(', ') + ')\n' + this.printBlock(node.func.body, indent + 1) + '\n' + ind + 'end';
            case 'AssignmentStatement':
                return ind + node.targets.map(e => this.printExpression(e)).join(', ') + ' = ' + node.values.map(e => this.printExpression(e)).join(', ');
            case 'CallStatement': return ind + this.printExpression(node.expression);
            case 'IfStatement':
                let istr = ind + 'if ' + this.printExpression(node.clauses[0].cond) + ' then\n' + this.printBlock(node.clauses[0].body, indent + 1);
                for (let i = 1; i < node.clauses.length; i++) istr += '\n' + ind + 'elseif ' + this.printExpression(node.clauses[i].cond) + ' then\n' + this.printBlock(node.clauses[i].body, indent + 1);
                if (node.elseBody) istr += '\n' + ind + 'else\n' + this.printBlock(node.elseBody, indent + 1);
                return istr + '\n' + ind + 'end';
            case 'NumericForStatement':
                let nfstr = ind + 'for ' + node.name + ' = ' + this.printExpression(node.start) + ', ' + this.printExpression(node.end);
                if (node.step) nfstr += ', ' + this.printExpression(node.step);
                return nfstr + ' do\n' + this.printBlock(node.body, indent + 1) + '\n' + ind + 'end';
            case 'GenericForStatement':
                return ind + 'for ' + node.names.join(', ') + ' in ' + node.exprs.map(e => this.printExpression(e)).join(', ') + ' do\n' + this.printBlock(node.body, indent + 1) + '\n' + ind + 'end';
            case 'WhileStatement':
                return ind + 'while ' + this.printExpression(node.cond) + ' do\n' + this.printBlock(node.body, indent + 1) + '\n' + ind + 'end';
            case 'RepeatStatement':
                return ind + 'repeat\n' + this.printBlock(node.body, indent + 1) + '\n' + ind + 'until ' + this.printExpression(node.cond);
            case 'DoStatement': return ind + 'do\n' + this.printBlock(node.body, indent + 1) + '\n' + ind + 'end';
            case 'ReturnStatement': return ind + 'return' + (node.exprs.length > 0 ? ' ' + node.exprs.map(e => this.printExpression(e)).join(', ') : '');
            case 'BreakStatement': return ind + 'break';
        }
        return '';
    }
    printExpression(node) {
        if (!node) return '';
        switch (node.type) {
            case 'NilLiteral': return 'nil';
            case 'BooleanLiteral': return node.value ? 'true' : 'false';
            case 'NumberLiteral': return node.value;
            case 'StringLiteral': return node.quote + node.value + node.quote;
            case 'VarargLiteral': return '...';
            case 'Identifier': return node.name;
            case 'BinaryExpression':
                const left = this.printExpression(node.left);
                const right = this.printExpression(node.right);
                if (node.operator === '..') return left + ' .. ' + right;
                return '(' + left + ' ' + node.operator + ' ' + right + ')';
            case 'UnaryExpression': return node.operator + (node.operator === 'not' ? ' ' : '') + this.printExpression(node.argument);
            case 'MemberExpression': return this.printExpression(node.object) + '.' + node.property;
            case 'IndexExpression': return this.printExpression(node.object) + '[' + this.printExpression(node.index) + ']';
            case 'CallExpression': return this.printExpression(node.base) + '(' + node.args.map(a => this.printExpression(a)).join(', ') + ')';
            case 'MethodCallExpression': return this.printExpression(node.object) + ':' + node.method + '(' + node.args.map(a => this.printExpression(a)).join(', ') + ')';
            case 'FunctionExpression': return 'function(' + node.params.join(', ') + ')\n' + this.printBlock(node.body, 1) + '\nend';
            case 'TableConstructor':
                if (node.fields.length === 0) return '{}';
                return '{\n' + node.fields.map(f => {
                    let fstr = this.indentStr;
                    if (f.type === 'TableKey') fstr += '[' + this.printExpression(f.key) + '] = ' + this.printExpression(f.value);
                    else if (f.type === 'TableKeyString') fstr += f.key + ' = ' + this.printExpression(f.value);
                    else fstr += this.printExpression(f.value);
                    return fstr;
                }).join(',\n') + '\n}';
        }
        return '';
    }
}

class MoonsecBridge {
    static async run(inputFile) {
        const dllResult = await MoonsecBridge.tryDll(inputFile);
        if (dllResult.success) {
            const decompileResult = await MoonsecBridge.tryDecompress(dllResult.luacFile);
            if (!decompileResult.isBytecode) {
                let finalCode = decompileResult.text;
                try { finalCode = MoonsecBridge.fixArabicStrings(finalCode); } catch (e) {}
                try {
                    const lexer = new LuaLexer(finalCode);
                    const tokens = lexer.tokenize();
                    const parser = new LuaParser(tokens);
                    const ast = parser.parse();
                    const transformer = new LuaTransformer();
                    transformer.transform(ast);
                    const generator = new LuaGenerator();
                    finalCode = generator.generate(ast);
                } catch (e) {
                    finalCode = MoonsecBridge.fallbackCleanup(finalCode);
                }
                return { text: finalCode, urls: MoonsecBridge.extractUrls(finalCode), decompiler: decompileResult.decompiler };
            }
            return { error: `Pipeline failed. Reason: ${decompileResult.error}` };
        }
        return { error: `DLL failed: ${dllResult.error}` };
    }
    
    static async tryDll(inputFile) {
        return new Promise((resolve) => {
            const luacFile = inputFile + ".luac";
            const dllPath = path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll");
            const proc = spawn("dotnet", [dllPath, "-dev", "-i", inputFile, "-o", luacFile], { timeout: 180000, killSignal: 'SIGKILL' });
            let stderr = "";
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            proc.on("error", (err) => resolve({ success: false, error: `spawn failed: ${err.message}` }));
            proc.on("close", (code, signal) => {
                if (fs.existsSync(luacFile) && fs.statSync(luacFile).size > 10) return resolve({ success: true, luacFile });
                if (signal === "SIGKILL") return resolve({ success: false, error: `DLL killed by timeout after 180s. ${stderr.slice(-200)}` });
                resolve({ success: false, error: `DLL exit ${code}: ${stderr.slice(-300)}` });
            });
        });
    }

    static async tryDecompress(luacFile) {
        const unluacRsPath = "/root/.cargo/bin/unluac-cli";
        const rsResult = await MoonsecBridge.tryRun(unluacRsPath, ["-i", luacFile], 60000);
        if (rsResult.success && rsResult.out.length > 50) return { text: rsResult.out, decompiler: "unluac-rs (Rust)" };
        const unluacJavaPath = path.join(__dirname, "unluac.jar");
        const javaResult = await MoonsecBridge.tryRun("java", ["-jar", unluacJavaPath, luacFile], 60000);
        if (javaResult.success && javaResult.out.length > 50) return { text: javaResult.out, decompiler: "unluac (Java)" };
        return { isBytecode: true, error: `Rust: ${rsResult.error} | Java: ${javaResult.error}` };
    }
    
    static fixArabicStrings(code) {
        if (!code) return code;
        try {
            const decoder = new TextDecoder('windows-1256');
            const reverseMap = {};
            for (let i = 0; i < 256; i++) {
                const char = decoder.decode(new Uint8Array([i]));
                if (char.length === 1) reverseMap[char] = i;
            }
            return code.replace(/(["'])(.*?)\1/g, (match, quote, content) => {
                if (!/ط§|ظ„|طھ|ط£|ط¥|ط­|ط·|ظ…|ط¯|ط©|ï¿½|�/.test(content)) return match;
                let bytes = [];
                for (let i = 0; i < content.length; i++) {
                    const char = content[i];
                    if (reverseMap[char] !== undefined) bytes.push(reverseMap[char]);
                    else if (char === '�' || char === '?') bytes.push(0x3F);
                    else bytes.push(char.charCodeAt(0) & 0xFF);
                }
                try {
                    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
                    return quote + decoded + quote;
                } catch (e) { return match; }
            });
        } catch (e) { return code; }
    }

    static fallbackCleanup(code) {
        let c = code;
        c = c.replace(/^-- file:.*$/gm, '').replace(/^-- dialect:.*$/gm, '').replace(/^-- encoding:.*$/gm, '').replace(/^-- decompiled by.*$/gm, '');
        c = c.replace(/ -- proto#\d+.*$/gm, '').replace(/-- PHASE_BOUNDARY:\w+\s*/g, '').replace(/-- \[\d+\]\s*/g, '').replace(/\[POL\] - /g, '-- ');
        c = c.replace(/\n{3,}/g, '\n\n').trim();
        return c;
    }

    static extractUrls(code) {
        const urls = code.match(/https?:\/\/[^\s"'`]+/g) || [];
        return [...new Set(urls)].filter(u => u.length > 10 && u.length < 250);
    }
    
    static tryRun(cmd, args, timeoutMs) {
        return new Promise((resolve) => {
            try {
                const proc = spawn(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL' });
                let chunks = [];
                let err = "";
                proc.stdout.on("data", (data) => { chunks.push(data); });
                proc.stderr.on("data", (data) => { err += data.toString(); });
                proc.on("error", (e) => resolve({ success: false, out: "", error: e.message }));
                proc.on("close", (code) => {
                    const outStr = Buffer.concat(chunks).toString('binary');
                    if (code === 0 && outStr.length > 50) resolve({ success: true, out: outStr, error: null });
                    else resolve({ success: false, out: outStr, error: err.slice(-500) || `Exit code ${code}` });
                });
            } catch (e) { resolve({ success: false, out: "", error: e.message }); }
        });
    }
}

module.exports = { MoonsecBridge };
