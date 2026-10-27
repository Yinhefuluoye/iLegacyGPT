#import <Foundation/Foundation.h>

typedef void (^AIDeltaBlock)(NSString *text);
typedef void (^AIDoneBlock)(NSDictionary *usage);
typedef void (^AIErrorBlock)(NSString *message, NSInteger code);

@interface AIService : NSObject

- (NSString *)startChatWithConfig:(NSDictionary *)config
                        requestId:(NSString *)requestId
                         messages:(NSArray *)messages
                            image:(NSDictionary *)image
                         thinking:(NSDictionary *)thinking
                          onDelta:(AIDeltaBlock)onDelta
                      onReasoning:(AIDeltaBlock)onReasoning
                           onDone:(AIDoneBlock)onDone
                          onError:(AIErrorBlock)onError;

- (void)stopRequest:(NSString *)requestId;
- (BOOL)hasRequest:(NSString *)requestId;

- (void)fetchModelsWithConfig:(NSDictionary *)config
                   completion:(void (^)(NSArray *models, id raw, NSString *errorMessage))completion;

@end
