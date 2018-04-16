'use strice';

const TTL = 10;

function Scope() {

    // $$在angular中表示为私有
    this.$$watchers = [];
    this.$$lastDirtyWatch = null;
    this.$$asyncQueue = [];
    this.$$applyAsyncQueue = [];
    this.$$applyAsyncId = null;
    this.$$postDigestQueue = [];
    this.$$phase = null;

    this.$$listeners = {};

    //angularjs中 并不是用数组实现
    //而是用链表 通过$$nextSibling $$prevSibling $$childHead $$childTail 进行连接Scope的关系
    //这样对堆进行添加,移除操作 更快
    this.$$children = [];

    this.$$root = this;
}

function initWatchVal() {

}

Scope.prototype.$new = function (isolated, parent) {
    var child;
    parent = parent || this;
    if (isolated) {
        child = new Scope();
        child.$$root = parent.$$root;
        child.$$asyncQueue = parent.$$asyncQueue;
        child.$$postDigestQueue = parent.$$postDigestQueue;
        child.$$applyAsyncQueue = parent.$$applyAsyncQueue;
    } else {
        child = Object.create(this);
    }

    parent.$$children.push(child);
    child.$$watchers = [];
    child.$$children = [];
    child.$parent = parent;
    child.$$listeners = {};
    return child;
};

Scope.prototype.$destroy = function () {
    this.$broadcast("$destroy");
    if (this.$parent) {
        var siblings = this.$parent.$$children;
        var index = siblings.indexOf(this);
        if (index >= 0) {
            siblings.splice(index, 1);
        }

        this.$parent = null;
    }

    this.$$watchers = null;
    this.$$listeners = {};
};

Scope.prototype.$watch = function (watchFn, listenerFn, valueEq) {
    var self = this;

    var watcher = {
        watchFn: watchFn,
        listenerFn: listenerFn || function () { },
        valueEq: !!valueEq,
        last: initWatchVal
    };

    this.$$watchers.unshift(watcher);
    this.$$root.$$lastDirtyWatch = null;

    return function () {
        var index = self.$$watchers.indexOf(watcher);
        if (index >= 0) {//如果wather已经不存在了 index为-1 则会删除列表最尾一个
            self.$$watchers.splice(index, 1);
            //如果在digest中移除了后一个watch 会导致前一个watch被执行两次 然后因为lastDirtyWatch等于自身而提前结束digest
            self.$$root.$$lastDirtyWatch = null;
        }
    };
};

Scope.prototype.$digest = function () {
    var ttl = TTL;
    var dirty;
    this.$$root.$$lastDirtyWatch = null;
    this.$beginPhase("$digest");

    if (this.$$root.$$applyAsyncId) {
        clearTimeout(this.$$root.$$applyAsyncId);
        this.$$flushApplyAsync();
    }

    do {
        while (this.$$asyncQueue.length) {//执行evalAsync加入的表达式
            try {
                let asyncTask = this.$$asyncQueue.shift();
                asyncTask.scope.$eval(asyncTask.expression);
            } catch (err) {
                console.error(err);
            }
        }
        dirty = this.$$digestOnce();
        if ((dirty || this.$$asyncQueue.length) && !(ttl--)) {
            this.$clearPhase();
            throw "10 digest iterations reached";
        }
    } while (dirty || this.$$asyncQueue.length);
    this.$clearPhase();

    while (this.$$postDigestQueue.length) {
        try {
            this.$$postDigestQueue.shift()();
        } catch (err) {
            console.error(err);
        }
    }
};

//在angular中 并没有digestOnce这个方法
//而是在digest里面嵌套循环
Scope.prototype.$$digestOnce = function () {
    var self = this;
    var dirty;
    var continueLoop = true;

    this.$$everyScope(function (scope) {
        var newValue, oldValue;
        for (let i = scope.$$watchers.length - 1; i >= 0; i--) {
            let watcher = scope.$$watchers[i];
            if (watcher) {//有可能在执行过程中被移除了
                try {
                    newValue = watcher.watchFn(scope);
                    oldValue = watcher.last;
                    if (!scope.$$areEqual(newValue, oldValue, watcher.valueEq)) {
                        self.$$root.$$lastDirtyWatch = watcher;
                        watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
                        watcher.listenerFn(newValue,
                            (oldValue === initWatchVal ? newValue : oldValue),
                            scope);

                        dirty = true;
                    } else if (self.$$root.$$lastDirtyWatch === watcher) {
                        continueLoop = false;
                        return false;
                    }
                } catch (err) {
                    console.error(err);
                }
            }

            //如果在上面执行的 watchFn 或 listenerFn中添加了watcher
            //新添加的wather会在这一轮digest中被忽略
            if (watcher != scope.$$watchers[i]) {
                let index = scope.$$watchers.indexOf(watcher);
                if (index > i) {
                    i = index;
                }
            }
        }
        return continueLoop;
    });
    return dirty;
};

//递归遍历当前scope及其子scope 
//传入函数接受参数scope
Scope.prototype.$$everyScope = function (fn) {
    if (fn(this)) {
        return this.$$children.every(function (child) {
            return child.$$everyScope(fn);
        });
    } else {
        return false;
    }
};

//TODO
//angular 有一个自己实现的 深层对比值是否相等的方法
//暂时先用 lo-Dash 提供的 isEqual 回头看看 angular 是怎么实现的
Scope.prototype.$$areEqual = function (newValue, oldValue, valueEq) {
    if (valueEq) {
        return _.isEqual(newValue, oldValue);
    } else {
        //js 中 NaN和NaN不相等
        return newValue === oldValue ||
            (typeof newValue === 'number' && typeof oldValue === 'number' &&
                isNaN(newValue) && isNaN(oldValue));
    }
};

//执行传入的表达式
//然后开始一个digest
Scope.prototype.$apply = function (expr) {
    try {
        this.$beginPhase("$apply");
        return this.$eval(expr);
    } finally {
        this.$clearPhase();

        //apply会触发根节点的digest 而不是当前scope的digest
        this.$$root.$digest();
    }
};

Scope.prototype.$eval = function (expr, locals) {
    return expr(this, locals);
};


//在本次digest中 下一轮digest之前 执行传入的表达式
Scope.prototype.$evalAsync = function (expr) {
    var self = this;

    //如果当前不是处于 digest 或 apply 阶段 开启一次digest
    if (!this.$$phase && !self.$$asyncQueue.length) {
        setTimeout(function () {
            if (self.$$asyncQueue.length) {
                self.$$root.$digest();//evalAsync会触发根节点的digest而不是当前scope的
            }
        }, 0);
    }
    this.$$asyncQueue.push({ scope: this, expression: expr });
};

//在下一次digest开始前 执行传入的表达式
//先入先出 只执行一次
Scope.prototype.$applyAsync = function (expr) {
    var self = this;
    self.$$applyAsyncQueue.push(function () {
        self.$eval(expr);
    });
    if (self.$$applyAsyncId === null) {//如果当前没有安排异步执行
        self.$$applyAsyncId = setTimeout(function () {//当前工作完成 达到将多个行为打包在一起延迟执行的效果
            self.$apply(() => { self.$$flushApplyAsync(); });
        }, 0);
    }
};

Scope.prototype.$$flushApplyAsync = function () {
    while (this.$$applyAsyncQueue.length) {
        try {
            this.$$applyAsyncQueue.shift()();
        } catch (err) {
            console.error(err);
        }
    }
    this.$$root.$$applyAsyncId = null;
};

Scope.prototype.$beginPhase = function (phase) {
    if (this.$$phase) {
        throw this.$$phase + ' already in progress.';
    }
    this.$$phase = phase;
};

Scope.prototype.$clearPhase = function () {
    this.$$phase = null;
};

//postDigest在下一次digest结束前执行
//fn先入先出 被unshift取出 只执行一次
Scope.prototype.$$postDigest = function (fn) {
    this.$$postDigestQueue.push(fn);
};

//将多个监控值归为一组 其中一个有变化 就执行listener
Scope.prototype.$watchGroup = function (watchFns, listenerFn) {
    var self = this;
    var newValues = new Array(watchFns.length);
    var oldValues = new Array(watchFns.length);

    var firstRun = true;

    //如果这个group的watch方法列表是空的 执行一次listenerFn
    if (watchFns.length === 0) {
        var shouldCall = true;
        self.$evalAsync(function () {
            if (shouldCall) {
                listenerFn(newValues, newValues, self);
            }
        });
        //返回取消这个listener的销毁方法
        return function () {
            shouldCall = false;
        };
    }

    //标记了这一个group的listenerFn是否已经安排了执行
    var changeReactionScheduled = false;

    function watchGroupListener() {
        if (firstRun) {
            firstRun = false;
            listenerFn(newValues, newValues, self);
        } else {
            listenerFn(newValues, oldValues, self);
        }
        changeReactionScheduled = false;
    }

    let destroyFunctions = [];

    _.forEach(watchFns, function (watchFn, i) {
        let destroyFn = self.$watch(watchFn, function (newValue, oldValue) {
            newValues[i] = newValue;
            oldValues[i] = oldValue;

            if (!changeReactionScheduled) {
                changeReactionScheduled = true;
                self.$evalAsync(watchGroupListener);
            }
        });
        destroyFunctions.push(destroyFn);
    });

    return function () {
        _.forEach(destroyFunctions, function (destroyFunction) {
            destroyFunction();
        }); 
    };
};


Scope.prototype.$watchCollection = function (watchFn, listenerFn) {
    var self = this;
    var newValue;
    var oldValue;
    var changeCount = 0;
    var oldLength = 0;
    var veryOldValue;
    var trackVeryOldValue = (listenerFn.length > 1);
    var firstRun = true;
    var internalWatchFn = function (scope) {
        newValue = watchFn(scope);

        if (_.isObject(newValue)) {
            //error 如果newValue是一个普通对象 恰好有length这个属性且length为0 我们会错误判断为arrayLike
            if (_.isArrayLike(newValue)) {
                if (!_.isArray(oldValue)) {
                    changeCount++;
                    oldValue = [];
                }
                if (newValue.length !== oldValue.length) {
                    changeCount++;
                    oldValue.length = newValue.length;
                }
                _.forEach(newValue, function (newItem, i) {
                    if (!self.$$areEqual(newItem, oldValue[i], false)) {
                        changeCount++;
                        oldValue[i] = newItem;
                    }
                });
            } else {
                if (!_.isObject(oldValue) || _.isArrayLike(oldValue)) {
                    changeCount++;
                    oldValue = {};
                    oldLength = 0;
                }
                var newLength = 0;
                _.forOwn(newValue, function (newVal, key) {//lo-dash的forOwn会过滤构造器和原型链上继承回来的属性
                    newLength++;
                    if (oldValue.hasOwnProperty(key)) {
                        if (!self.$$areEqual(newVal, oldValue[key], false)) {
                            changeCount++;
                            oldValue[key] = newVal;
                        }
                    } else {
                        changeCount++;
                        oldLength++;
                        oldValue[key] = newVal;
                    }
                });

                if (oldLength > newLength) {
                    changeCount++;
                    _.forOwn(oldValue, function (oldVal, key) {
                        if (!newValue.hasOwnProperty(key)) {
                            oldLength--;
                            delete oldValue[key];
                        }
                    });
                }

            }
        } else {
            if (!self.$$areEqual(newValue, oldValue, false)) {
                changeCount++;
            }
            oldValue = newValue;
        }
        return changeCount;
    };
    var internalListenerFn = function () {
        if (firstRun) {
            listenerFn(newValue, newValue, self);
            firstRun = false;
        } else {
            listenerFn(newValue, veryOldValue, self);
        }
        if (trackVeryOldValue) {
            veryOldValue = _.clone(newValue);
        }
    };
    return this.$watch(internalWatchFn, internalListenerFn);
};

Scope.prototype.$on = function (eventName, listener) {

    if (!this.$$listeners[eventName]) {
        this.$$listeners[eventName] = [listener];
    } else {
        this.$$listeners[eventName].push(listener);
    }

    var self = this;

    return function () {
        var index = self.$$listeners[eventName].indexOf(listener);
        if (index >= 0) {
            //如果在遍历listener的时候移除 会影响遍历 所以先标识为空,以示可删除
            self.$$listeners[eventName][index] = null;
        }
    };

};

Scope.prototype.$emit = function (eventName) {
    var propagationStopped = false;
    var event = {
        name: eventName,
        targetScope : this,
        currentScope : this,
        stopPropagation : function(){
            propagationStopped = true;
        },
        defaultPrevented : false,
        preventDefault : function(){
            this.defaultPrevented = true;
        }
    };
    
    var additionalsArgs = [];
    for (let i = 1; i < arguments.length; i++) {
        additionalsArgs.push(arguments[i]);
    }    
    var listenerArgs = [event].concat(additionalsArgs);    

    var scope = this;
    do {
        event.currentScope = scope;
        scope.$$fireEventOnScope(eventName,listenerArgs);
        scope = scope.$parent;
    } while (scope && !propagationStopped);

    event.currentScope = null;

    return event;
};

Scope.prototype.$broadcast = function (eventName) {
    
    var event = {
        name: eventName,
        targetScope : this,
        currentScope : this,
        defaultPrevented : false,
        preventDefault : function(){
            this.defaultPrevented = true;
        }
    };
    
    var additionalsArgs = [];
    for (let i = 1; i < arguments.length; i++) {
        additionalsArgs.push(arguments[i]);
    }    
    var listenerArgs = [event].concat(additionalsArgs);

    this.$$everyScope(function(scope){
        event.currentScope = scope;
        scope.$$fireEventOnScope(eventName,listenerArgs);
        return true;
    });

    event.currentScope = null;

    return event;
};

Scope.prototype.$$fireEventOnScope = function (eventName,listenerArgs) {
    var listeners = this.$$listeners[eventName] || [];

    var i = 0;
    while (i < listeners.length) {
        if (listeners[i] === null) {
            listeners.splice(i, 1);
        } else {
            try {
                listeners[i].apply(null, listenerArgs);
            } catch (err) {
                console.error(err);
            }
            i++;
        }
    }
    return event;
};