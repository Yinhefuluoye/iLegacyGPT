#import "AIService.h"
#import "ChatConfig.h"
#import <UIKit/UIKit.h>

#pragma mark - Stream state

@interface AIStreamState : NSObject
@property (nonatomic, copy) NSString *requestId;
@property (nonatomic, strong) NSMutableData *lineBuffer;
@property (nonatomic, strong) NSMutableString *pendingText;
@property (nonatomic, strong) NSMutableString *pendingReasoning;
@property (nonatomic, strong) NSMutableData *body;
@property (nonatomic, assign) NSInteger statusCode;
@property (nonatomic, assign) BOOL isEventStream;
@property (nonatomic, assign) BOOL finished;
@property (nonatomic, assign) BOOL stopped;
@property (nonatomic, assign) BOOL flushScheduled;
@property (nonatomic, strong) NSDictionary *usage;
@property (nonatomic, strong) NSMutableArray *toolCalls; /* {id,name,arguments} by index */
@property (nonatomic, copy) AIDeltaBlock onDelta;
@property (nonatomic, copy) AIDeltaBlock onReasoning;
@property (nonatomic, copy) AIDoneBlock onDone;
@property (nonatomic, copy) AIErrorBlock onError;
@property (nonatomic, strong) NSURLSessionDataTask *task;
@end

@implementation AIStreamState
@end

#pragma mark - Helpers

static NSString *Trimmed(NSString *s) {
    if (![s isKindOfClass:[NSString class]]) {
        return @"";
    }
    return [s stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
}

static BOOL BaseHasVersionSuffix(NSString *base) {
    NSArray *parts = [base componentsSeparatedByString:@"/"];
    for (NSInteger i = (NSInteger)parts.count - 1; i >= 0; i--) {
        NSString *p = parts[i];
        if (p.length == 0) {
            continue;
        }
        if ([p hasPrefix:@"v"] && p.length >= 2 && p.length <= 10) {
            NSString *rest = [p substringFromIndex:1];
            NSString *digits = [rest stringByTrimmingCharactersInSet:[NSCharacterSet decimalDigitCharacterSet]];
            if (digits.length == 0 || [rest hasPrefix:@"beta"]) {
                return YES;
            }
        }
        return NO;
    }
    return NO;
}

static NSArray *CandidateURLs(NSString *base, NSString *suffix) {
    NSMutableArray *candidates = [NSMutableArray array];
    NSString *trimmed = Trimmed(base);
    if (trimmed.length == 0) {
        trimmed = @"https://api.deepseek.com/v1";
    }
    while ([trimmed hasSuffix:@"/"]) {
        trimmed = [trimmed substringToIndex:trimmed.length - 1];
    }
    NSString *first = [trimmed stringByAppendingString:suffix];
    [candidates addObject:first];
    if (![suffix hasPrefix:@"/v1"] && !BaseHasVersionSuffix(trimmed)) {
        NSString *second = [[trimmed stringByAppendingString:@"/v1"] stringByAppendingString:suffix];
        if (![candidates containsObject:second]) {
            [candidates addObject:second];
        }
    }
    return candidates;
}

// Thinking parameters come from the web bridge as already-typed JSON: booleans
// and numbers arrive as NSNumber (`enable_thinking: false`, `thinking_budget:
// 4096`), so they must be passed through verbatim. Strings keep the legacy
// textual form ("true" / "4096" / ...). Dropping NSNumber here silently
// disabled every non-string thinking parameter.
static id ConvertScalarValue(id value) {
    if ([value isKindOfClass:[NSNumber class]]) {
        return value;
    }
    if (![value isKindOfClass:[NSString class]]) {
        return nil;
    }
    NSString *trim = Trimmed((NSString *)value);
    if (trim.length == 0) {
        return nil;
    }
    NSString *lower = [trim lowercaseString];
    if ([lower isEqualToString:@"true"]) {
        return @YES;
    }
    if ([lower isEqualToString:@"false"]) {
        return @NO;
    }
    if ([lower isEqualToString:@"null"] || [lower isEqualToString:@"none"]) {
        return nil;
    }
    NSScanner *scanner = [NSScanner scannerWithString:trim];
    double number = 0;
    if ([scanner scanDouble:&number] && scanner.isAtEnd) {
        return @(number);
    }
    return trim;
}

// Give the model a clock. Without it "today" is guessed — often wrongly — and
// search queries then carry the wrong date.
static NSString *ClockContextString(void) {
    NSDate *now = [NSDate date];
    NSTimeZone *zone = [NSTimeZone localTimeZone];

    NSDateFormatter *iso = [[NSDateFormatter alloc] init];
    iso.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    iso.timeZone = zone;
    iso.dateFormat = @"yyyy-MM-dd'T'HH:mm:ssXXX";

    NSDateFormatter *local = [[NSDateFormatter alloc] init];
    local.locale = [NSLocale localeWithLocaleIdentifier:@"zh_CN"];
    local.timeZone = zone;
    local.dateFormat = @"yyyy年M月d日 EEEE HH:mm";

    return [NSString stringWithFormat:
        @"【当前时间】%@（%@；%@）。"
        @"凡是涉及「今天」「现在」「最新」「今年」「最近」这类相对时间的问题，都以这个时间为准；"
        @"需要联网检索时，请把具体日期或年份写进查询词，不要凭空猜测日期，也不要让用户自己核对今天几号。",
        [iso stringFromDate:now], zone.name, [local stringFromDate:now]];
}

static NSString *ErrorTextFromBody(NSData *body, NSInteger statusCode) {
    if (body.length == 0) {
        return [NSString stringWithFormat:@"请求失败（HTTP %ld）", (long)statusCode];
    }
    id obj = [NSJSONSerialization JSONObjectWithData:body options:0 error:NULL];
    if ([obj isKindOfClass:[NSDictionary class]]) {
        id err = obj[@"error"];
        if ([err isKindOfClass:[NSDictionary class]] && [err[@"message"] isKindOfClass:[NSString class]]) {
            return err[@"message"];
        }
        if ([err isKindOfClass:[NSString class]]) {
            return err;
        }
        if ([obj[@"message"] isKindOfClass:[NSString class]]) {
            return obj[@"message"];
        }
        if ([obj[@"msg"] isKindOfClass:[NSString class]]) {
            return obj[@"msg"];
        }
    }
    NSString *text = [[NSString alloc] initWithData:body encoding:NSUTF8StringEncoding];
    if (!text) {
        text = [[NSString alloc] initWithData:body encoding:NSISOLatin1StringEncoding];
    }
    if (text.length > 300) {
        text = [text substringToIndex:300];
    }
    return [NSString stringWithFormat:@"请求失败（HTTP %ld）：%@", (long)statusCode, text ?: @""];
}

#pragma mark - Web search tool

// Whether this request should advertise `tools` to the model. `noTools` is set
// on the follow-up round (after a search) so a turn can never loop forever.
static BOOL ConfigWantsTools(NSDictionary *config) {
    if (![config isKindOfClass:[NSDictionary class]]) {
        return NO;
    }
    id search = config[@"search"];
    if (![search isKindOfClass:[NSDictionary class]]) {
        return NO;
    }
    if ([search[@"noTools"] boolValue]) {
        return NO;
    }
    id mode = search[@"mode"];
    return [mode isKindOfClass:[NSString class]] && ![mode isEqualToString:@"off"];
}

static NSArray *WebSearchTools(void) {
    NSDictionary *function = @{
        @"name": @"web_search",
        @"description": [@"Search the live web for current information that you cannot know reliably "
                         @"from training data, such as news, prices, weather, schedules, sports results, "
                         @"software versions or anything happening recently. Call this whenever the answer "
                         @"depends on fresh facts. Prefer queries that surface concrete article pages "
                         @"(news posts, documentation, blog entries, release notes) rather than homepages "
                         @"or section index pages. Return 1-2 short, specific queries, most specific "
                         @"first; results come back as numbered web pages you must cite as [1], [2] "
                         @"in your answer." copy],
        @"parameters": @{
            @"type": @"object",
            @"properties": @{
                @"queries": @{
                    @"type": @"array",
                    @"items": @{ @"type": @"string" },
                    @"description": @"One or two short, specific keyword queries, most specific first."
                }
            },
            @"required": @[ @"queries" ]
        }
    };
    return @[ @{ @"type": @"function", @"function": function } ];
}

static void MergeToolCallChunk(NSMutableArray *slots, id raw) {
    if (![raw isKindOfClass:[NSDictionary class]]) {
        return;
    }
    NSInteger index = (NSInteger)slots.count;
    id rawIndex = raw[@"index"];
    if ([rawIndex respondsToSelector:@selector(integerValue)]) {
        index = [rawIndex integerValue];
    }
    if (index < 0) {
        index = 0;
    }
    while ((NSInteger)slots.count <= index) {
        [slots addObject:[@{ @"id": @"", @"name": @"", @"arguments": @"" } mutableCopy]];
    }
    NSMutableDictionary *slot = slots[(NSUInteger)index];
    id callId = raw[@"id"];
    if ([callId isKindOfClass:[NSString class]] && [callId length] > 0) {
        slot[@"id"] = callId;
    }
    id function = raw[@"function"];
    if ([function isKindOfClass:[NSDictionary class]]) {
        id name = function[@"name"];
        if ([name isKindOfClass:[NSString class]] && [name length] > 0) {
            slot[@"name"] = name;
        }
        id arguments = function[@"arguments"];
        if ([arguments isKindOfClass:[NSString class]] && [arguments length] > 0) {
            // arguments arrive as fragments; concatenate them by index
            slot[@"arguments"] = [slot[@"arguments"] stringByAppendingString:arguments];
        }
    }
}

static NSArray *QueriesFromToolCalls(NSArray *calls) {
    NSMutableArray *out = [NSMutableArray array];
    for (id item in calls) {
        if (![item isKindOfClass:[NSDictionary class]]) {
            continue;
        }
        id arguments = item[@"arguments"];
        if (![arguments isKindOfClass:[NSString class]] || [arguments length] == 0) {
            continue;
        }
        NSData *data = [arguments dataUsingEncoding:NSUTF8StringEncoding];
        id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
        if (![parsed isKindOfClass:[NSDictionary class]]) {
            continue;
        }
        // Accept the documented `queries` array first, then the singular aliases
        // models fall back to when they improvise the argument object.
        NSArray *keys = @[ @"queries", @"query", @"q", @"search_query", @"keywords" ];
        for (NSString *key in keys) {
            id value = parsed[key];
            if ([value isKindOfClass:[NSArray class]]) {
                for (id query in value) {
                    if ([query isKindOfClass:[NSString class]]) {
                        NSString *trim = Trimmed(query);
                        if (trim.length) {
                            [out addObject:trim];
                        }
                    }
                }
            } else if ([value isKindOfClass:[NSString class]]) {
                NSString *trim = Trimmed(value);
                if (trim.length) {
                    [out addObject:trim];
                }
            }
            if (out.count) {
                break;
            }
        }
    }
    return out;
}

#pragma mark - Service

@interface AIService () <NSURLSessionDataDelegate>

@property (nonatomic, strong) NSURLSession *session;
@property (nonatomic, strong) NSOperationQueue *delegateQueue;
@property (nonatomic, strong) NSMutableDictionary *states; /* @(taskIdentifier) -> AIStreamState */

@end

@implementation AIService

- (instancetype)init {
    self = [super init];
    if (self) {
        _delegateQueue = [[NSOperationQueue alloc] init];
        _delegateQueue.maxConcurrentOperationCount = 1;
        _delegateQueue.name = @"ChatAI.AIService.delegate";

        NSURLSessionConfiguration *cfg = [NSURLSessionConfiguration defaultSessionConfiguration];
        cfg.timeoutIntervalForRequest = 300;
        cfg.timeoutIntervalForResource = 900;
        cfg.HTTPShouldUsePipelining = NO;
        cfg.requestCachePolicy = NSURLRequestReloadIgnoringLocalCacheData;
        _session = [NSURLSession sessionWithConfiguration:cfg delegate:self delegateQueue:_delegateQueue];
        _states = [NSMutableDictionary dictionary];

        [[NSNotificationCenter defaultCenter] addObserver:self
                                                 selector:@selector(handleMemoryWarning:)
                                                     name:UIApplicationDidReceiveMemoryWarningNotification
                                                   object:nil];
    }
    return self;
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [_session invalidateAndCancel];
}

- (void)handleMemoryWarning:(NSNotification *)note {
    [self.session flushWithCompletionHandler:^{}];
}

- (BOOL)hasRequest:(NSString *)requestId {
    for (AIStreamState *state in self.states.allValues) {
        if ([state.requestId isEqualToString:requestId] && !state.finished) {
            return YES;
        }
    }
    return NO;
}

#pragma mark - Models

- (void)fetchModelsWithConfig:(NSDictionary *)config
                   completion:(void (^)(NSArray *models, id raw, NSString *errorMessage))completion {
    NSString *base = [ChatConfig normalizedBaseURL:config];
    NSArray *candidates = CandidateURLs(base, @"/models");
    NSString *key = [ChatConfig apiKeyFromConfig:config];
    [self fetchModelsWithCandidates:candidates index:0 key:key lastStatus:0 completion:completion];
}

- (void)fetchModelsWithCandidates:(NSArray *)candidates
                            index:(NSUInteger)index
                              key:(NSString *)key
                       lastStatus:(NSInteger)lastStatus
                       completion:(void (^)(NSArray *models, id raw, NSString *errorMessage))completion {
    if (index >= candidates.count) {
        NSString *msg = lastStatus > 0
            ? [NSString stringWithFormat:@"获取模型失败（HTTP %ld）", (long)lastStatus]
            : @"获取模型失败，请检查 API 地址";
        dispatch_async(dispatch_get_main_queue(), ^{
            completion(nil, nil, msg);
        });
        return;
    }
    NSString *urlString = candidates[index];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:urlString]];
    request.HTTPMethod = @"GET";
    request.timeoutInterval = 30;
    [request setValue:[@"Bearer " stringByAppendingString:key] forHTTPHeaderField:@"Authorization"];
    [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
    __weak typeof(self) weakSelf = self;
    NSURLSessionDataTask *task = [self.session dataTaskWithRequest:request
                                                completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf) {
            return;
        }
        if (error) {
            [strongSelf fetchModelsWithCandidates:candidates index:index + 1 key:key lastStatus:0 completion:completion];
            return;
        }
        NSInteger status = 0;
        if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
            status = [(NSHTTPURLResponse *)response statusCode];
        }
        if (status == 404 || status == 405) {
            [strongSelf fetchModelsWithCandidates:candidates index:index + 1 key:key lastStatus:status completion:completion];
            return;
        }
        if (status < 200 || status >= 300) {
            NSString *msg = ErrorTextFromBody(data, status);
            dispatch_async(dispatch_get_main_queue(), ^{
                completion(nil, nil, msg);
            });
            return;
        }
        id obj = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
        NSMutableArray *ids = [NSMutableArray array];
        id list = nil;
        if ([obj isKindOfClass:[NSDictionary class]]) {
            list = obj[@"data"];
            if (![list isKindOfClass:[NSArray class]]) {
                list = obj[@"models"];
            }
        } else if ([obj isKindOfClass:[NSArray class]]) {
            list = obj;
        }
        if ([list isKindOfClass:[NSArray class]]) {
            for (id item in list) {
                if ([item isKindOfClass:[NSString class]]) {
                    [ids addObject:item];
                } else if ([item isKindOfClass:[NSDictionary class]]) {
                    NSString *mid = item[@"id"];
                    if (![mid isKindOfClass:[NSString class]]) {
                        mid = item[@"name"];
                    }
                    if ([mid isKindOfClass:[NSString class]] && mid.length) {
                        [ids addObject:mid];
                    }
                }
            }
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            completion(ids, obj, nil);
        });
    }];
    [task resume];
}

#pragma mark - Chat

- (NSString *)startChatWithConfig:(NSDictionary *)config
                        requestId:(NSString *)requestId
                         messages:(NSArray *)messages
                            image:(NSDictionary *)image
                         thinking:(NSDictionary *)thinking
                          onDelta:(AIDeltaBlock)onDelta
                      onReasoning:(AIDeltaBlock)onReasoning
                           onDone:(AIDoneBlock)onDone
                          onError:(AIErrorBlock)onError {
    NSString *base = [ChatConfig normalizedBaseURL:config];
    NSArray *candidates = CandidateURLs(base, @"/chat/completions");
    NSString *urlString = candidates.firstObject;
    NSString *key = [ChatConfig apiKeyFromConfig:config];
    NSString *model = [ChatConfig modelFromConfig:config];

    NSURL *url = [NSURL URLWithString:urlString];
    if (!url) {
        if (onError) {
            dispatch_async(dispatch_get_main_queue(), ^{
                onError(@"API 地址无效，请检查设置", -1);
            });
        }
        return requestId;
    }

    NSMutableArray *chatMessages = [NSMutableArray array];
    for (id item in messages) {
        if (![item isKindOfClass:[NSDictionary class]]) {
            continue;
        }
        NSString *role = item[@"role"];
        if (![role isKindOfClass:[NSString class]] || role.length == 0) {
            role = @"user";
        }
        id content = item[@"content"];
        if (![content isKindOfClass:[NSString class]]) {
            content = @"";
        }
        [chatMessages addObject:[@{ @"role": role, @"content": content } mutableCopy]];
    }

    if ([image isKindOfClass:[NSDictionary class]] && [image[@"dataBase64"] isKindOfClass:[NSString class]]) {
        NSString *b64 = image[@"dataBase64"];
        NSString *mime = image[@"mime"];
        if (![mime isKindOfClass:[NSString class]] || mime.length == 0) {
            mime = @"image/jpeg";
        }
        NSInteger lastUser = -1;
        for (NSInteger i = (NSInteger)chatMessages.count - 1; i >= 0; i--) {
            if ([chatMessages[(NSUInteger)i][@"role"] isEqualToString:@"user"]) {
                lastUser = i;
                break;
            }
        }
        if (lastUser >= 0 && b64.length > 0) {
            NSString *dataURL = [NSString stringWithFormat:@"data:%@;base64,%@", mime, b64];
            NSString *text = chatMessages[(NSUInteger)lastUser][@"content"];
            NSArray *parts = @[
                @{ @"type": @"text", @"text": (text.length ? text : @"") },
                @{ @"type": @"image_url", @"image_url": @{ @"url": dataURL } }
            ];
            chatMessages[(NSUInteger)lastUser] = [@{ @"role": @"user", @"content": parts } mutableCopy];
        }
    }

    NSString *clock = ClockContextString();
    if (clock.length) {
        [chatMessages insertObject:[@{ @"role": @"system", @"content": clock } mutableCopy] atIndex:0];
    }

    NSMutableDictionary *body = [NSMutableDictionary dictionary];
    body[@"model"] = model.length ? model : @"gpt-4o-mini";
    body[@"messages"] = chatMessages;
    body[@"stream"] = @YES;

    if (ConfigWantsTools(config) && self.toolCallHandler != nil) {
        body[@"tools"] = WebSearchTools();
        body[@"tool_choice"] = @"auto";
    }

    if ([thinking isKindOfClass:[NSDictionary class]] && [thinking[@"enabled"] boolValue]) {
        id params = thinking[@"params"];
        if ([params isKindOfClass:[NSDictionary class]]) {
            // preferred form: {params: {"reasoning_effort": "high"}}
            for (NSString *key in params) {
                if (![key isKindOfClass:[NSString class]] || key.length == 0) {
                    continue;
                }
                id value = ConvertScalarValue(params[key]);
                if (value) {
                    body[key] = value;
                }
            }
        } else {
            // legacy form: {param: "reasoning_effort", onValue: "high"}
            NSString *param = thinking[@"param"];
            if (![param isKindOfClass:[NSString class]] || param.length == 0) {
                param = @"reasoning_effort";
            }
            id value = ConvertScalarValue(thinking[@"onValue"]);
            if (value) {
                body[param] = value;
            }
        }
    }

    NSError *jsonError = nil;
    NSData *bodyData = [NSJSONSerialization dataWithJSONObject:body options:0 error:&jsonError];
    if (!bodyData) {
        if (onError) {
            dispatch_async(dispatch_get_main_queue(), ^{
                onError([NSString stringWithFormat:@"请求构造失败：%@", jsonError.localizedDescription], -2);
            });
        }
        return requestId;
    }

    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    request.timeoutInterval = 300;
    request.HTTPBody = bodyData;
    [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    [request setValue:@"text/event-stream" forHTTPHeaderField:@"Accept"];
    [request setValue:@"identity" forHTTPHeaderField:@"Accept-Encoding"];
    if (key.length) {
        [request setValue:[@"Bearer " stringByAppendingString:key] forHTTPHeaderField:@"Authorization"];
    }
    [request setValue:@"ChatAI/1.0 (iPad; iOS)" forHTTPHeaderField:@"User-Agent"];

    AIStreamState *state = [[AIStreamState alloc] init];
    state.requestId = requestId;
    state.lineBuffer = [NSMutableData data];
    state.pendingText = [NSMutableString string];
    state.pendingReasoning = [NSMutableString string];
    state.body = [NSMutableData data];
    state.toolCalls = [NSMutableArray array];
    state.onDelta = onDelta;
    state.onReasoning = onReasoning;
    state.onDone = onDone;
    state.onError = onError;

    NSURLSessionDataTask *task = [self.session dataTaskWithRequest:request];
    state.task = task;
    self.states[@(task.taskIdentifier)] = state;
    NSLog(@"[ChatAI] chat start %@ -> %@ (model=%@)", requestId, urlString, model);
    [task resume];
    return requestId;
}

- (void)stopRequest:(NSString *)requestId {
    for (NSNumber *key in self.states.allKeys) {
        AIStreamState *state = self.states[key];
        if ([state.requestId isEqualToString:requestId] && !state.finished) {
            state.stopped = YES;
            [state.task cancel];
            [self.states removeObjectForKey:key];
            NSLog(@"[ChatAI] chat stop %@", requestId);
            return;
        }
    }
}

#pragma mark - State helpers

- (AIStreamState *)stateForTask:(NSURLSessionTask *)task {
    return self.states[@(task.taskIdentifier)];
}

- (void)removeStateForTask:(NSURLSessionTask *)task {
    AIStreamState *state = [self stateForTask:task];
    if (state) {
        [self.states removeObjectForKey:@(task.taskIdentifier)];
    }
}

- (void)flushState:(AIStreamState *)state {
    if (state.pendingText.length > 0) {
        NSString *text = [state.pendingText copy];
        [state.pendingText setString:@""];
        if (state.onDelta) {
            state.onDelta(text);
        }
    }
    if (state.pendingReasoning.length > 0) {
        NSString *text = [state.pendingReasoning copy];
        [state.pendingReasoning setString:@""];
        if (state.onReasoning) {
            state.onReasoning(text);
        }
    }
}

- (void)scheduleFlush:(AIStreamState *)state {
    if (state.flushScheduled || state.finished) {
        return;
    }
    state.flushScheduled = YES;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.03 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (!strongSelf) {
            return;
        }
        [strongSelf.delegateQueue addOperationWithBlock:^{
            state.flushScheduled = NO;
            [strongSelf flushState:state];
        }];
    });
}

- (void)finishState:(AIStreamState *)state {
    if (state.finished) {
        return;
    }
    state.finished = YES;
    [self flushState:state];

    // The model asked for a tool: hand the turn back to the caller, which runs
    // the search and issues the follow-up request. No `done` here, otherwise the
    // UI would stop streaming while the answer round has not started yet.
    NSArray *queries = QueriesFromToolCalls(state.toolCalls);
    AIToolCallBlock toolHandler = self.toolCallHandler;
    if (state.toolCalls.count > 0 && toolHandler && !state.stopped) {
        // queries may be empty when the model improvised an unknown argument
        // shape; the caller falls back to the user's own words.
        NSLog(@"[ChatAI] tool_calls count=%lu queries=%@",
              (unsigned long)state.toolCalls.count, queries);
        if (toolHandler(queries)) {
            return;
        }
        NSLog(@"[ChatAI] tool_calls not handled, finishing normally");
    }

    NSDictionary *usage = state.usage;
    AIDoneBlock done = state.onDone;
    if (done) {
        done(usage);
    }
}

- (void)failState:(AIStreamState *)state message:(NSString *)message code:(NSInteger)code {
    if (state.finished) {
        return;
    }
    state.finished = YES;
    [self flushState:state];
    AIErrorBlock block = state.onError;
    if (block) {
        block(message ? message : @"未知错误", code);
    }
}

#pragma mark - SSE

- (void)extractDeltaFromObject:(NSDictionary *)obj state:(AIStreamState *)state {
    id error = obj[@"error"];
    if ([error isKindOfClass:[NSDictionary class]] || [error isKindOfClass:[NSString class]]) {
        NSString *msg = nil;
        if ([error isKindOfClass:[NSDictionary class]] && [error[@"message"] isKindOfClass:[NSString class]]) {
            msg = error[@"message"];
        } else if ([error isKindOfClass:[NSString class]]) {
            msg = error;
        }
        [self failState:state message:(msg.length ? msg : @"模型返回错误") code:-3];
        return;
    }

    id usage = obj[@"usage"];
    if ([usage isKindOfClass:[NSDictionary class]]) {
        state.usage = usage;
    }

    id choices = obj[@"choices"];
    if (![choices isKindOfClass:[NSArray class]] || [choices count] == 0) {
        return;
    }
    NSDictionary *choice = choices[0];
    if (![choice isKindOfClass:[NSDictionary class]]) {
        return;
    }
    NSDictionary *delta = choice[@"delta"];
    if (![delta isKindOfClass:[NSDictionary class]]) {
        delta = choice[@"message"];
    }
    if ([delta isKindOfClass:[NSDictionary class]]) {
        id content = delta[@"content"];
        if ([content isKindOfClass:[NSString class]] && [content length] > 0) {
            if ([delta[@"role"] isKindOfClass:[NSString class]]) {
                // ignore role-only chunks
            }
            [state.pendingText appendString:content];
            [self scheduleFlush:state];
        }
        id reasoning = delta[@"reasoning_content"];
        if (![reasoning isKindOfClass:[NSString class]]) {
            reasoning = delta[@"reasoning"];
        }
        if ([reasoning isKindOfClass:[NSString class]] && [reasoning length] > 0) {
            [state.pendingReasoning appendString:reasoning];
            [self scheduleFlush:state];
        }
        id toolCalls = delta[@"tool_calls"];
        if ([toolCalls isKindOfClass:[NSArray class]]) {
            for (id raw in toolCalls) {
                MergeToolCallChunk(state.toolCalls, raw);
            }
        }
    }
    id finish = choice[@"finish_reason"];
    if ([finish isKindOfClass:[NSString class]] && [finish length] > 0 && ![finish isEqualToString:@"null"]) {
        // wait for [DONE] or stream end; nothing to do here
    }
}

- (void)handleLine:(NSString *)line state:(AIStreamState *)state {
    if (![line isKindOfClass:[NSString class]]) {
        return;
    }
    if ([line hasSuffix:@"\r"]) {
        line = [line substringToIndex:line.length - 1];
    }
    if (line.length == 0) {
        return;
    }
    if ([line hasPrefix:@"data:"]) {
        NSString *payload = [line substringFromIndex:5];
        payload = [payload stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        if ([payload isEqualToString:@"[DONE]"]) {
            [self finishState:state];
            return;
        }
        if (payload.length == 0) {
            return;
        }
        NSError *err = nil;
        id obj = [NSJSONSerialization JSONObjectWithData:[payload dataUsingEncoding:NSUTF8StringEncoding]
                                                 options:0
                                                   error:&err];
        if ([obj isKindOfClass:[NSDictionary class]]) {
            [self extractDeltaFromObject:obj state:state];
        } else if (err) {
            NSLog(@"[ChatAI] SSE JSON parse error: %@ payload=%@", err.localizedDescription, payload);
        }
        return;
    }
    if ([line hasPrefix:@"{"]) {
        id obj = [NSJSONSerialization JSONObjectWithData:[line dataUsingEncoding:NSUTF8StringEncoding]
                                                 options:0
                                                   error:NULL];
        if ([obj isKindOfClass:[NSDictionary class]]) {
            [self extractDeltaFromObject:obj state:state];
        }
    }
}

- (void)consumeBuffer:(AIStreamState *)state {
    NSData *newline = [@"\n" dataUsingEncoding:NSUTF8StringEncoding];
    while (YES) {
        NSRange range = [state.lineBuffer rangeOfData:newline options:0 range:NSMakeRange(0, state.lineBuffer.length)];
        if (range.location == NSNotFound) {
            break;
        }
        NSData *lineData = [state.lineBuffer subdataWithRange:NSMakeRange(0, range.location)];
        [state.lineBuffer replaceBytesInRange:NSMakeRange(0, NSMaxRange(range)) withBytes:NULL length:0];
        NSString *line = [[NSString alloc] initWithData:lineData encoding:NSUTF8StringEncoding];
        if (!line) {
            line = [[NSString alloc] initWithData:lineData encoding:NSISOLatin1StringEncoding];
        }
        [self handleLine:line state:state];
        if (state.finished) {
            return;
        }
    }
}

#pragma mark - NSURLSessionDataDelegate

- (void)URLSession:(NSURLSession *)session
              dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveResponse:(NSURLResponse *)response
     completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
    AIStreamState *state = [self stateForTask:dataTask];
    if (state) {
        if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
            NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
            state.statusCode = http.statusCode;
            NSString *contentType = http.allHeaderFields[@"Content-Type"];
            if (![contentType isKindOfClass:[NSString class]]) {
                contentType = @"";
            }
            state.isEventStream = [contentType rangeOfString:@"text/event-stream"].location != NSNotFound;
            NSLog(@"[ChatAI] response status=%ld type=%@", (long)state.statusCode, contentType);
        }
    }
    completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(NSData *)data {
    AIStreamState *state = [self stateForTask:dataTask];
    if (!state || state.finished) {
        return;
    }
    if (state.statusCode >= 400) {
        [state.body appendData:data];
        return;
    }
    if (state.isEventStream) {
        [state.lineBuffer appendData:data];
        [self consumeBuffer:state];
    } else {
        [state.body appendData:data];
    }
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didCompleteWithError:(NSError *)error {
    AIStreamState *state = [self stateForTask:task];
    if (!state) {
        return;
    }
    if (state.finished) {
        [self removeStateForTask:task];
        return;
    }
    if (state.stopped) {
        [self removeStateForTask:task];
        return;
    }
    if (error) {
        if (error.code == NSURLErrorCancelled) {
            [self removeStateForTask:task];
            return;
        }
        [self failState:state message:error.localizedDescription code:error.code];
        [self removeStateForTask:task];
        return;
    }
    if (state.statusCode >= 400) {
        NSString *message = ErrorTextFromBody(state.body, state.statusCode);
        [self failState:state message:message code:state.statusCode];
        [self removeStateForTask:task];
        return;
    }
    if (state.isEventStream) {
        if (state.lineBuffer.length > 0) {
            NSString *tail = [[NSString alloc] initWithData:state.lineBuffer encoding:NSUTF8StringEncoding];
            [self handleLine:tail state:state];
        }
        [self finishState:state];
    } else {
        NSError *jsonError = nil;
        id obj = nil;
        if (state.body.length > 0) {
            obj = [NSJSONSerialization JSONObjectWithData:state.body options:0 error:&jsonError];
        }
        if ([obj isKindOfClass:[NSDictionary class]]) {
            id usage = obj[@"usage"];
            if ([usage isKindOfClass:[NSDictionary class]]) {
                state.usage = usage;
            }
            id choices = obj[@"choices"];
            if ([choices isKindOfClass:[NSArray class]] && [choices count] > 0) {
                NSDictionary *choice = choices[0];
                NSDictionary *msg = choice[@"message"];
                if (![msg isKindOfClass:[NSDictionary class]]) {
                    msg = choice[@"delta"];
                }
                id content = msg[@"content"];
                if ([content isKindOfClass:[NSString class]] && [content length]) {
                    [state.pendingText appendString:content];
                }
                id toolCalls = msg[@"tool_calls"];
                if ([toolCalls isKindOfClass:[NSArray class]]) {
                    for (id raw in toolCalls) {
                        MergeToolCallChunk(state.toolCalls, raw);
                    }
                }
            }
            [self finishState:state];
        } else {
            NSString *message = jsonError
                ? [NSString stringWithFormat:@"响应解析失败：%@", jsonError.localizedDescription]
                : @"响应为空";
            [self failState:state message:message code:-4];
        }
    }
    [self removeStateForTask:task];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didReceiveChallenge:(NSURLAuthenticationChallenge *)challenge
 completionHandler:(void (^)(NSURLSessionAuthChallengeDisposition, NSURLCredential *))completionHandler {
    completionHandler(NSURLSessionAuthChallengePerformDefaultHandling, nil);
}

@end
