#import <Foundation/Foundation.h>

@interface ChatStore : NSObject

+ (NSDictionary *)load;
+ (void)save:(NSDictionary *)data;
+ (void)clear;
+ (NSString *)storePath;

@end
