#import "ChatConfig.h"

static NSString *const kChatConfigKey = @"chatai.config.v1";

@implementation ChatConfig

+ (NSDictionary *)defaults {
    return @{
        @"provider": @"DeepSeek",
        @"baseUrl": @"https://api.deepseek.com/v1",
        @"port": @443,
        @"apiKey": @"",
        @"model": @"deepseek-chat",
        @"models": @[],
        @"thinking": @{
            @"enabled": @NO,
            @"param": @"reasoning_effort",
            @"onValue": @"high",
            @"offValue": @""
        },
        @"fontSize": @17,
        @"search": @{
            @"url": @"",
            @"key": @"",
            @"header": @"Authorization",
            @"prefix": @"Bearer ",
            @"body": @"{\"query\":\"{{query}}\",\"num_results\":{{num}}}",
            @"num": @5
        }
    };
}

+ (NSDictionary *)load {
    NSDictionary *defaults = [self defaults];
    NSDictionary *stored = [[NSUserDefaults standardUserDefaults] dictionaryForKey:kChatConfigKey];
    if (![stored isKindOfClass:[NSDictionary class]]) {
        return defaults;
    }
    NSMutableDictionary *merged = [defaults mutableCopy];
    [stored enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
        if ([key isEqual:@"thinking"] && [obj isKindOfClass:[NSDictionary class]]) {
            NSMutableDictionary *thinking = [defaults[@"thinking"] mutableCopy];
            [thinking addEntriesFromDictionary:obj];
            merged[@"thinking"] = thinking;
        } else {
            merged[key] = obj;
        }
    }];
    return merged;
}

+ (void)save:(NSDictionary *)config {
    if (![config isKindOfClass:[NSDictionary class]]) {
        return;
    }
    NSDictionary *defaults = [self defaults];
    NSMutableDictionary *cleaned = [NSMutableDictionary dictionary];
    [defaults enumerateKeysAndObjectsUsingBlock:^(id key, id obj, BOOL *stop) {
        id value = config[key];
        if (value == nil || [value isKindOfClass:[NSNull class]]) {
            cleaned[key] = obj;
        } else {
            cleaned[key] = value;
        }
    }];
    [[NSUserDefaults standardUserDefaults] setObject:cleaned forKey:kChatConfigKey];
    [[NSUserDefaults standardUserDefaults] synchronize];
}

+ (NSString *)normalizedBaseURL:(NSDictionary *)config {
    NSString *base = config[@"baseUrl"];
    if (![base isKindOfClass:[NSString class]]) {
        base = @"";
    }
    base = [base stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (base.length == 0) {
        base = @"https://api.deepseek.com/v1";
    }
    if (![base hasPrefix:@"http://"] && ![base hasPrefix:@"https://"]) {
        base = [@"https://" stringByAppendingString:base];
    }
    while ([base hasSuffix:@"/"]) {
        base = [base substringToIndex:base.length - 1];
    }
    NSInteger port = [self portFromConfig:config];
    NSURLComponents *comps = [NSURLComponents componentsWithString:base];
    if (comps && comps.port == nil && port > 0 && port != 443 && port != 80
        && [comps.scheme isEqualToString:@"https"]) {
        comps.port = @(port);
        NSString *rebuilt = [comps string];
        if (rebuilt.length) {
            base = rebuilt;
        }
    } else if (comps && comps.port == nil && port > 0 && port != 443 && port != 80
               && [comps.scheme isEqualToString:@"http"]) {
        comps.port = @(port);
        NSString *rebuilt = [comps string];
        if (rebuilt.length) {
            base = rebuilt;
        }
    }
    return base;
}

+ (NSInteger)portFromConfig:(NSDictionary *)config {
    id port = config[@"port"];
    if ([port respondsToSelector:@selector(integerValue)]) {
        return [port integerValue];
    }
    return 443;
}

+ (NSString *)modelFromConfig:(NSDictionary *)config {
    id model = config[@"model"];
    return [model isKindOfClass:[NSString class]] ? model : @"";
}

+ (NSString *)apiKeyFromConfig:(NSDictionary *)config {
    id key = config[@"apiKey"];
    return [key isKindOfClass:[NSString class]] ? key : @"";
}

+ (BOOL)thinkingEnabled:(NSDictionary *)config {
    id thinking = config[@"thinking"];
    if (![thinking isKindOfClass:[NSDictionary class]]) {
        return NO;
    }
    return [thinking[@"enabled"] boolValue];
}

@end
