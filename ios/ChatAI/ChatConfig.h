#import <Foundation/Foundation.h>

@interface ChatConfig : NSObject

+ (NSDictionary *)defaults;
+ (NSDictionary *)load;
+ (void)save:(NSDictionary *)config;
+ (NSString *)normalizedBaseURL:(NSDictionary *)config;
+ (NSInteger)portFromConfig:(NSDictionary *)config;
+ (NSString *)modelFromConfig:(NSDictionary *)config;
+ (NSString *)apiKeyFromConfig:(NSDictionary *)config;
+ (BOOL)thinkingEnabled:(NSDictionary *)config;

@end
