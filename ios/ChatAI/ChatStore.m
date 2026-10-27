#import "ChatStore.h"

static NSString *const kStoreFileName = @"store.json";
static const NSUInteger kMaxMessages = 200;

@implementation ChatStore

+ (NSString *)storePath {
    NSArray *paths = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES);
    NSString *base = paths.count > 0 ? paths[0] : NSTemporaryDirectory();
    NSString *dir = [base stringByAppendingPathComponent:@"ChatAI"];
    [[NSFileManager defaultManager] createDirectoryAtPath:dir
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:NULL];
    return [dir stringByAppendingPathComponent:kStoreFileName];
}

+ (NSDictionary *)load {
    NSString *path = [self storePath];
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (!data) {
        return @{ @"messages": @[] };
    }
    NSError *err = nil;
    id obj = [NSJSONSerialization JSONObjectWithData:data options:0 error:&err];
    if (![obj isKindOfClass:[NSDictionary class]]) {
        NSLog(@"[ChatAI] store parse failed: %@", err);
        return @{ @"messages": @[] };
    }
    NSMutableDictionary *result = [obj mutableCopy];
    id messages = result[@"messages"];
    if (![messages isKindOfClass:[NSArray class]]) {
        result[@"messages"] = @[];
    }
    return result;
}

+ (void)save:(NSDictionary *)data {
    if (![data isKindOfClass:[NSDictionary class]]) {
        return;
    }
    NSMutableDictionary *cleaned = [data mutableCopy];
    id messages = cleaned[@"messages"];
    if ([messages isKindOfClass:[NSArray class]] && [messages count] > kMaxMessages) {
        NSRange range = NSMakeRange([messages count] - kMaxMessages, kMaxMessages);
        cleaned[@"messages"] = [messages subarrayWithRange:range];
    }
    cleaned[@"updatedAt"] = @([[NSDate date] timeIntervalSince1970]);
    NSError *err = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:cleaned options:0 error:&err];
    if (!json) {
        NSLog(@"[ChatAI] store serialize failed: %@", err);
        return;
    }
    NSString *path = [self storePath];
    [json writeToFile:path atomically:YES];
}

+ (void)clear {
    [[NSFileManager defaultManager] removeItemAtPath:[self storePath] error:NULL];
}

@end
