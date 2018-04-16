/* jshint globalstrict: true */
'use strict';

var ESCAPES = {
    'n': '\n', 'f': '\f', 'r': '\r', 't': '\t',
    'v': '\v', '\'': '\'', '"': '"'
};

var OPERATORS = {
    '+': true,
    '!': true,
    '-': true,
    '*': true,
    '/': true,
    '%': true,
    '=': true,
    '==': true,
    '!=': true,
    '===': true,
    '!==': true,
    '<': true,
    '>': true,
    '<=': true,
    '>=': true,
    '&&': true,
    '||': true
};

var CALL = Function.prototype.call;
var APPLY = Function.prototype.apply;
var BIND = Function.prototype.bind;


//Parser
function Parser(lexer) {
    this.lexer = lexer;
    this.ast = new AST(this.lexer);
    this.astCompiler = new ASTCompiler(this.ast);
}
Parser.prototype.parse = function (text) {
    return this.astCompiler.compile(text);
};
function parse(expr) {
    var lexer = new Lexer();
    var parser = new Parser(lexer);
    return parser.parse(expr);
}




//Lexer 词法分析器
function Lexer() {
}

Lexer.prototype.lex = function (text) {
    this.text = text;
    this.index = 0;
    this.ch = undefined;
    this.tokens = [];

    while (this.index < this.text.length) {
        this.ch = this.text.charAt(this.index);
        if (this.isNumber(this.ch) || (this.ch == '.' && this.isNumber(this.peek()))) {
            this.readNumber();
        } else if (this.ch === '"' || this.ch === "'") {
            this.readString(this.ch);
        } else if (this.is('[],{}:.()?;')) {
            this.tokens.push({
                text: this.ch
            });
            this.index++;
        } else if (this.isIdentifier(this.ch)) {
            this.readIndentifier();
        } else if (this.isWhitespace(this.ch)) {
            this.index++;
        } else {
            var ch = this.ch;
            var ch2 = this.ch + this.peek();
            var ch3 = this.ch + this.peek() + this.peek(2);
            var op = OPERATORS[ch];
            var op2 = OPERATORS[ch2];
            var op3 = OPERATORS[ch3];
            if (op || op2 || op3) {
                var token = op3 ? ch3 : (op2 ? ch2 : ch);
                this.tokens.push({ text: token });
                this.index += token.length;
            } else {
                throw 'Unexpected next character: ' + this.ch;
            }
        }
    }

    return this.tokens;
};

Lexer.prototype.is = function (chars) {
    return chars.indexOf(this.ch) !== -1;
};

Lexer.prototype.isWhitespace = function (ch) {
    return ch === ' ' || ch === '\r' || ch === '\t' ||
        ch === '\n' || ch === '\v' || ch === '\u00A0';
};

Lexer.prototype.isNumber = function (ch) {
    return '0' <= ch && ch <= '9';
};

Lexer.prototype.isIdentifier = function (ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
        ch === '_' || ch === '$';
};

Lexer.prototype.readIndentifier = function () {
    var text = '';
    while (this.index < this.text.length) {
        var ch = this.text.charAt(this.index);
        if (this.isIdentifier(ch) || this.isNumber(ch)) {
            text += ch;
        } else {
            break;
        }
        this.index++;
    }
    var token = { text: text, identifier: true };
    this.tokens.push(token);
};

Lexer.prototype.readString = function (quote) {
    this.index++;
    var string = '';
    var rawString = quote;
    var escape = false;
    while (this.index < this.text.length) {
        var ch = this.text.charAt(this.index);
        rawString += ch;
        if (escape) {
            if (ch === 'u') {
                var hex = this.text.substring(this.index + 1, this.index + 5);
                //hex应为4位十六进制数
                //即长度为4 每位规定 0-9及a-f  不区分大小写
                if (!hex.match(/[\da-f]{4}/i)) {
                    throw 'Invalid unicode escape sequence';
                }
                this.index += 4;
                string += String.fromCharCode(parseInt(hex, 16));
            } else {
                var replacement = ESCAPES[ch];
                if (replacement) {
                    string += replacement;
                } else {
                    string += ch;
                }
            }
            escape = false;
        } else if (ch === quote) {
            this.index++;
            this.tokens.push({
                text: rawString,
                value: string
            });
            return;
        } else if (ch === '\\') {
            escape = true;
        } else {
            string += ch;
        }
        this.index++;
    }
    throw 'Unmatched quote';
};

//是否指数操作符
Lexer.prototype.isExponentOperator = function (ch) {
    return ch === '-' || ch === '+' || this.isNumber(ch);
};

Lexer.prototype.readNumber = function () {
    var number = '';
    while (this.index < this.text.length) {
        var ch = this.text.charAt(this.index).toLowerCase();
        if (this.isNumber(ch) || ch === '.') {
            number += ch;
        } else {
            var nextChar = this.peek();
            var prevChar = number.charAt(number.length - 1);
            if (ch === 'e' && this.isExponentOperator(nextChar)) {
                number += ch;
            } else if (this.isExponentOperator(ch) && prevChar === 'e' &&
                nextChar && this.isNumber(nextChar)) {
                number += ch;
            } else if (this.isExponentOperator(ch) && prevChar === 'e' &&
                (!nextChar || !this.isNumber(nextChar))) {
                throw "Invalid exponent";
            }
            else {
                break;
            }
        }
        this.index++;
    }

    this.tokens.push({
        text: number,
        value: Number(number)
    });
};

Lexer.prototype.peek = function (n) {
    n = n || 1;
    if (this.index + n < this.text.length) {
        return this.text.charAt(this.index + n);
    } else {
        return false;
    }
};


//AST Abstract Syntax Tree 抽象语法树
function AST(lexer) {
    this.lexer = lexer;
}
AST.Program = 'Program';
AST.Literal = 'Literal';
AST.ArrayExpression = 'ArrayExpression';
AST.ObjectExpression = 'ObjectExpression';
AST.Property = 'Property';
AST.Identifier = 'Identifier';
AST.ThisExpression = 'ThisExpression';
AST.MemberExpression = 'MemberExpression';
AST.CallExpression = 'CallExpression';
AST.AssignmentExpression = 'AssignmentExpression';
AST.UnaryExpression = 'UnaryExpression';
AST.BinaryExpression = 'BinaryExpression';
AST.LogicalExpression = 'LogicalExpression';
AST.ConditionalExpression = 'ConditionalExpression';

AST.prototype.ast = function (text) {
    this.tokens = this.lexer.lex(text);
    return this.program();
    // AST building will be done here
};
AST.prototype.program = function () {
    var body = [];
    while(true){
        if(this.tokens.length){
            body.push(this.assignment());
        }
        if(!this.expect(';')){
            return { type: AST.Program, body: body };
        }
    }
};
AST.prototype.primary = function () {
    var primary;
    if (this.expect('(')) {
        primary = this.assignment();
        this.consume(')');
    } else if (this.expect('[')) {
        primary = this.arrayDeclaration();
    } else if (this.expect('{')) {
        primary = this.object();
    } else if (this.constants.hasOwnProperty(this.tokens[0].text)) {
        primary = this.constants[this.consume().text];
    } else if (this.peek().identifier) {
        primary = this.identifier();
    } else {
        primary = this.constant();
    }
    var next;
    while ((next = this.expect('.', '[', '('))) {
        if (next.text === '[') {
            primary = {
                type: AST.MemberExpression,
                object: primary,
                property: this.primary(),
                computed: true
            };
            this.consume(']');
        } else if (next.text === '.') {
            primary = {
                type: AST.MemberExpression,
                object: primary,
                property: this.identifier(),
                computed: false
            };
        } else if (next.text === '(') {
            primary = { type: AST.CallExpression, callee: primary, arguments: this.parseArguments() };
            this.consume(')');
        }
    }
    return primary;
};

//生成语法树的顺序是
//assignmen->ternary->logicalOR->logicalAND->equality->relational->additive->multiplicative->unary->primary
//在执行解释语法树时 是以相反的顺序解释的 以此实现优先度
AST.prototype.assignment = function () {
    var left = this.ternary();
    if (this.expect('=')) {
        var right = this.ternary();
        return { type: AST.AssignmentExpression, left: left, right: right };
    }
    return left;
};

AST.prototype.ternary = function(){
    var test = this.logicalOR();
    if(this.expect('?')){
        var consequent = this.assignment();
        if(this.consume(':')){
            var alternate = this.assignment();
            return {
                type:AST.ConditionalExpression,
                test : test,
                consequent : consequent,
                alternate : alternate
            };
        }
    }
    return test;
};

AST.prototype.logicalOR = function () {
    var left = this.logicalAND();
    var token;
    while ((token = this.expect('||'))) {
        left = {
            type: AST.LogicalExpression,
            left: left,
            operator: token.text,
            right: this.logicalAND()
        };
    }
    return left;
};

AST.prototype.logicalAND = function () {
    var left = this.equality();
    var token;
    while ((token = this.expect('&&'))) {
        left = {
            type: AST.LogicalExpression,
            left: left,
            operator: token.text,
            right: this.equality()
        };
    }
    return left;
};

AST.prototype.equality = function () {
    var left = this.relational();
    var token;
    while ((token = this.expect('==', '!=', '===', '!=='))) {
        left = {
            type: AST.BinaryExpression,
            left: left,
            operator: token.text,
            right: this.relational()
        };
    }
    return left;
};

AST.prototype.relational = function () {
    var left = this.additive();
    var token;
    while ((token = this.expect('<', '<=', '>', '>='))) {
        left = {
            type: AST.BinaryExpression,
            left: left,
            operator: token.text,
            right: this.additive()
        };
    }
    return left;
};

AST.prototype.additive = function () {
    var left = this.multiplicative();
    var token;
    while ((token = this.expect('+')) || (token = this.expect('-'))) {
        left = {
            type: AST.BinaryExpression,
            left: left,
            operator: token.text,
            right: this.multiplicative()
        };
    }
    return left;
};

AST.prototype.multiplicative = function () {
    var left = this.unary();
    var token;
    while ((token = this.expect('*', '/', '%'))) {
        left = {
            type: AST.BinaryExpression,
            left: left,
            operator: token.text,
            right: this.unary()
        };
    }
    return left;
};

AST.prototype.unary = function () {
    var token;
    if ((token = this.expect('+', '!', '-'))) {
        return {
            type: AST.UnaryExpression,
            operator: token.text,
            argument: this.unary()
        };
    } else {
        return this.primary();
    }
};

AST.prototype.parseArguments = function () {
    var args = [];
    if (!this.peek(')')) {
        do {
            args.push(this.assignment());
        } while (this.expect(','));
    }
    return args;
};
AST.prototype.constant = function () {
    return { type: AST.Literal, value: this.consume().value };
};
AST.prototype.constants = {
    'null': { type: AST.Literal, value: null },
    'true': { type: AST.Literal, value: true },
    'false': { type: AST.Literal, value: false },
    'this': { type: AST.ThisExpression },
};
AST.prototype.identifier = function () {
    return { type: AST.Identifier, name: this.consume().text };
};
AST.prototype.expect = function (e1, e2, e3, e4) {
    var token = this.peek(e1, e2, e3, e4);
    if (token) {
        return this.tokens.shift();
    }
};

AST.prototype.object = function () {
    var properties = [];
    if (!this.peek('}')) {
        do {
            if (this.peek('}')) {//支持trailing comma
                break;
            }
            var property = { type: AST.Property };
            if (this.peek().identifier) {//key可能是标识符
                property.key = this.identifier();
            } else {
                property.key = this.constant();
            }
            this.consume(':');
            property.value = this.assignment();
            properties.push(property);
        } while (this.expect(','));
    }

    this.consume('}');
    return { type: AST.ObjectExpression, properties: properties };
};

AST.prototype.arrayDeclaration = function () {
    var elements = [];
    //如果没有马上闭合 即不为空数组
    if (!this.peek(']')) {
        do {
            if (this.peek(']')) {//支持trailing comma
                break;
            }
            elements.push(this.assignment());
        } while (this.expect(','));
    }
    this.consume(']');
    return { type: AST.ArrayExpression, elements: elements };
};
AST.prototype.consume = function (e) {
    var token = this.expect(e);
    if (!token) {
        throw 'Unexpected. Expecting: ' + e;
    }
    return token;
};
AST.prototype.peek = function (e1, e2, e3, e4) {
    if (this.tokens.length > 0) {
        var text = this.tokens[0].text;
        if (text === e1 || text === e2 || text === e3 || text === e4 ||
            (!e1 && !e2 && !e3 && !e4)) {
            return this.tokens[0];
        }
    }
};

//ASTCompiler
function ASTCompiler(astBuilder) {
    this.astBuilder = astBuilder;
}
ASTCompiler.prototype.compile = function (text) {
    var ast = this.astBuilder.ast(text);
    this.state = { body: [], nextId: 0, vars: [] };
    this.recurse(ast);

    var fnString = 'var fn=function(s,l){' +
        (this.state.vars.length ?
            'var ' + this.state.vars.join(',') + ';' :
            ''
        ) +
        this.state.body.join('') +
        '}; return fn;';

    /* jshint -W054 */
    return new Function(
        'ensureSafeMemberName',
        'ensureSafeObject',
        'ensureSafeFunction',
        'ifDefined',
        fnString)(
        ensureSafeMemberName,
        ensureSafeObject,
        ensureSafeFunction,
        ifDefined);
    /* jshint +W054 */
};

//将AST转化成字符串
//create 标识是否创建不存在的属性
ASTCompiler.prototype.recurse = function (ast, context, create) {
    var intoId;
    switch (ast.type) {
        case AST.Program:    
            let i = 0;
            for(;i<ast.body.length-1;i++){
                this.state.body.push(this.recurse(ast.body[i]), ';');
            }
            this.state.body.push('return ', this.recurse(ast.body[i]), ';');
            break;
        case AST.Literal:
            return this.escape(ast.value);
        case AST.ArrayExpression:
            let elements = [];
            for (let element of ast.elements) {
                elements.push(this.recurse(element));
            }
            return '[' + elements.join(',') + ']';
        case AST.ObjectExpression:
            let properties = [];
            for (let property of ast.properties) {
                var key = property.key.type === AST.Identifier ? property.key.name :
                    this.escape(property.key.value);
                var value = this.recurse(property.value);
                properties.push(key + ':' + value);
            }
            return '{' + properties.join(',') + '}';
        case AST.Identifier:
            ensureSafeMemberName(ast.name);
            intoId = this.nextId();

            this.if_(this.getHasOwnProperty('l', ast.name),
                this.assign(intoId, this.nonComputedMember('l', ast.name)));
            if (create) {
                this.if_(this.not(this.getHasOwnProperty('l', ast.name)) +
                    ' && s && ' +
                    this.not(this.getHasOwnProperty('s', ast.name)),
                    this.assign(this.nonComputedMember('s', ast.name), '{}'));
            }
            this.if_(this.not(this.getHasOwnProperty('l', ast.name)) + "&& s",
                this.assign(intoId, this.nonComputedMember('s', ast.name)));

            if (context) {
                context.context = this.getHasOwnProperty('l', ast.name) + '?l:s';
                context.name = ast.name;
                context.computed = false;
            }
            this.addEnsureSafeObject(intoId);
            return intoId;
        case AST.ThisExpression:
            return 's';
        case AST.MemberExpression:
            intoId = this.nextId();
            var left = this.recurse(ast.object, undefined, create);
            if (context) {
                context.context = left;
            }
            if (ast.computed) {
                var right = this.recurse(ast.property);
                this.addEnsureSafeMemberName(right);
                if (create) {
                    this.if_(this.not(this.computedMember(left, right)),
                        this.assign(this.computedMember(left, right), '{}'));
                }
                this.if_(left,
                    this.assign(intoId,
                        'ensureSafeObject(' + this.computedMember(left, right) + ')'));
                if (context) {
                    context.name = right;
                    context.computed = true;
                }
            } else {
                ensureSafeMemberName(ast.property.name);
                if (create) {
                    this.if_(this.not(this.nonComputedMember(left, ast.property.name)),
                        this.assign(this.nonComputedMember(left, ast.property.name), '{}'));
                }
                this.if_(left,
                    this.assign(intoId,
                        'ensureSafeObject(' + this.nonComputedMember(left, ast.property.name) + ')'));
                if (context) {
                    context.name = ast.property.name;
                    context.computed = false;
                }
            }
            return intoId;
        case AST.CallExpression:
            var callContext = {};
            var callee = this.recurse(ast.callee, callContext);
            var args = [];
            if (ast.arguments) {
                for (let arg of ast.arguments) {
                    args.push('ensureSafeObject(' + this.recurse(arg) + ')');
                }
            }
            if (callContext.name) {
                this.addEnsureSafeObject(callContext.context);
                if (callContext.computed) {
                    callee = this.computedMember(callContext.context, callContext.name);
                } else {
                    callee = this.nonComputedMember(callContext.context, callContext.name);
                }
            }
            this.addEnsureSafeFunction(callee);
            return callee + '&&ensureSafeObject(' + callee + '(' + args.join(',') + '))';//如果存在callee 就执行并返回结果
        case AST.AssignmentExpression:
            var leftContext = {};
            this.recurse(ast.left, leftContext, true);
            var leftExpr;
            if (leftContext.computed) {
                leftExpr = this.computedMember(leftContext.context, leftContext.name);
            } else {
                leftExpr = this.nonComputedMember(leftContext.context, leftContext.name);
            }
            return this.assign(leftExpr, 'ensureSafeObject(' + this.recurse(ast.right) + ')');
        case AST.UnaryExpression:
            return ast.operator +
                '(' + this.ifDefined(this.recurse(ast.argument), 0) + ')';
        case AST.BinaryExpression:
            if (ast.operator === '+' || ast.operator === '-') {
                return '(' + this.ifDefined(this.recurse(ast.left), 0) + ')' +
                    ast.operator +
                    '(' + this.ifDefined(this.recurse(ast.right), 0) + ')';
            } else {
                return '(' + this.recurse(ast.left) + ')' +
                    ast.operator +
                    '(' + this.recurse(ast.right) + ')';
            }
            break;
        case AST.LogicalExpression:
            intoId = this.nextId();
            this.state.body.push(this.assign(intoId, this.recurse(ast.left)));
            this.if_(ast.operator === '&&' ? intoId : this.not(intoId),
                this.assign(intoId, this.recurse(ast.right)));
            return intoId;
        case AST.ConditionalExpression:
            intoId = this.nextId();
            var testId = this.nextId();
            this.state.body.push(this.assign(testId,this.recurse(ast.test)));
            this.if_(testId,
                this.assign(intoId,this.recurse(ast.consequent)));
            this.if_(this.not(testId),
                this.assign(intoId,this.recurse(ast.alternate)));
            return intoId;
    }
};
ASTCompiler.prototype.ifDefined = function (value, defaultValue) {
    return 'ifDefined(' + value + ',' + this.escape(defaultValue) + ')';
};
ASTCompiler.prototype.addEnsureSafeFunction = function (expr) {
    this.state.body.push('ensureSafeFunction(' + expr + ');');
};
ASTCompiler.prototype.addEnsureSafeObject = function (expr) {
    this.state.body.push('ensureSafeObject(' + expr + ');');
};
ASTCompiler.prototype.addEnsureSafeMemberName = function (expr) {
    this.state.body.push('ensureSafeMemberName(' + expr + ');');
};
ASTCompiler.prototype.not = function (e) {
    return '!(' + e + ')';
};
ASTCompiler.prototype.getHasOwnProperty = function (object, property) {
    return object + '&&(' + this.escape(property) + ' in ' + object + ')';
};
ASTCompiler.prototype.nonComputedMember = function (left, right) {
    return '(' + left + ').' + right;
};
ASTCompiler.prototype.computedMember = function (left, right) {
    return '(' + left + ')[' + right + ']';
};
ASTCompiler.prototype.if_ = function (test, consequent) {
    this.state.body.push('if(', test, '){', consequent, '}');
};
ASTCompiler.prototype.assign = function (id, value) {
    return id + '=' + value + ';';
};
ASTCompiler.prototype.nextId = function () {
    var id = 'v' + (this.state.nextId++);
    this.state.vars.push(id);
    return id;
};
ASTCompiler.prototype.escape = function (value) {
    if (_.isString(value)) {
        return '\'' + value.replace(this.stringEscapeRegex, this.stringEscapeFn) + '\'';
    } else if (value === null) {
        return 'null';
    } else {
        return value;
    }
};
ASTCompiler.prototype.stringEscapeRegex = /[^ a-zA-Z0-9]/g;
ASTCompiler.prototype.stringEscapeFn = function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
};

function ensureSafeMemberName(name) {
    if (name === 'constructor' || name === '__proto__' ||
        name === '__defineGetter__' || name === '__defineSetter__' ||
        name === '__lookupGetter__' || name === '__lookupSetter__') {
        throw 'Attempting to access a disallowed field in Angular expressions!';
    }
}

function ensureSafeFunction(obj) {
    if (obj) {
        if (obj.constructor === obj) {
            throw 'Referencing Function in Angular expressions is disallowed!';
        } else if (obj === CALL || obj === APPLY || obj === BIND) {
            throw 'Referencing call, apply, or bind in Angular expressions ' +
            'is disallowed!';
        }
    }
    return obj;
}

function ensureSafeObject(obj) {
    if (obj) {
        //要判断一个对象是什么是很难的 例如 判断是否window 如果有iframe的情况 window===window不能排除对象是否window
        //这些对象在不同浏览器里表现也可能不一样
        //所以 我们不要关注这个对象是什么 而是关注对象能做什么(duck typing 鸭辨模型)
        if (obj.document && obj.location && obj.alert && obj.setInterval) {
            throw 'Referencing window in Angular expressions is disallowed!';
        } else if (obj.children &&
            (obj.nodeName || (obj.prop && obj.attr && obj.find))) {
            throw 'Referencing DOM nodes in Angular expressions is disallowed!';
        } else if (obj.constructor === obj) {//function的constructor指向自己
            throw 'Referencing Function in Angular expressions is disallowed!';
        } else if (obj.getOwnPropertyNames || obj.getOwnPropertyDescriptor) {
            throw 'Referencing Object in Angular expressions is disallowed!';
        }
    }
    return obj;
}

function ifDefined(value, defaultValue) {
    if (typeof value === 'undefined') {
        return defaultValue;
    }
    return value;
}