#import <Foundation/Foundation.h>

typedef void (^AIDeltaBlock)(NSString *text);
typedef void (^AIDoneBlock)(NSDictionary *usage);
typedef void (^AIErrorBlock)(NSString *message, NSInteger code);

// Called when the model emits `tool_calls` (function calling). Return YES when
// the caller takes over the turn (it runs the tool and re-issues the chat with
// the results); the service then emits no `done` for this round. Return NO to
// let the normal completion path run.
typedef BOOL (^AIToolCallBlock)(NSArray *queries);

@interface AIService : NSObject

/// Set this to enable real function calling for `web_search`. When nil, no
/// `tools` are sent and the service stays a pure chat-completions client.
@property (nonatomic, copy) AIToolCallBlock toolCallHandler;

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
