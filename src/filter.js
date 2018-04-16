/* jshint globalstrict: true */
'use strict';

var filters = {};

function register(name, factory) {

    if(_.isObject(name)){
        for(let filterName in name){
            let filter = name[filterName]();
            filters[filterName] = filter;
        }
    }else{
        let filter = factory();
        filters[name] = filter;
        return filter;
    }
}

function filter(name) {
    return filters[name];
}